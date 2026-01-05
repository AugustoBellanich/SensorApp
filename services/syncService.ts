import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

// --- REPOSITORIOS Y DB ---
import { db } from "../database/DatabaseInit";
import {
    markElectrodeSynced,
    saveElectrode
} from "../database/ElectrodeRepository";
import { insertReadingsB01, insertReadingsC01 } from "../database/ReadingsRepository";
import {
    getSensorsPendingSync,
    markSensorSynced,
    saveSensor,
} from "../database/SensorRepository";

// --- TIPOS Y LIB ---
import { ElectrodeEntity, ReadingB01, ReadingC01, SensorEntity } from "../database/types";
import { supabase } from "../lib/supabase";

const LAST_PULL_KEY = "LAST_SYNC_TIMESTAMP";

// SEMÁFORO
let isSyncing = false;

// Helper para verificar rol antes de subir
const getUserRole = async (deviceId: string): Promise<'owner' | 'editor' | 'viewer' | null> => {
    try {
        const { data } = await supabase
            .from('sensor_permissions')
            .select('role')
            .eq('device_id', deviceId)
            .single();
        return data?.role || null;
    } catch {
        return null;
    }
};

export const syncService = {
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return (state.isConnected && state.isInternetReachable) || false;
  },

  // ==============================================================================
  // 1. PUSH (SUBIDA: Local -> Nube) - CON CHECK DE ROL
  // ==============================================================================
  async pushChanges() {
    console.log("🔄 [SYNC] Iniciando subida de datos...");
    
    if (!(await this.isOnline())) {
        console.log("⚠️ [SYNC] Sin conexión. Se intentará más tarde.");
        return;
    }

    // A. SUBIR SENSORES (Solo Owners/Editores pueden cambiar config/alias en nube)
    try {
        const pendingSensors = await getSensorsPendingSync();
        if (pendingSensors.length > 0) {
            console.log(`📤 [SYNC] Verificando ${pendingSensors.length} sensores pendientes...`);
            for (const sensor of pendingSensors) {
                const cleanId = sensor.id.replace("SEN-", "").trim(); 
                
                // CHECK DE ROL
                const role = await getUserRole(cleanId);
                if (role !== 'owner' && role !== 'editor') {
                    console.log(`🔒 [SYNC] Rol '${role}' en ${cleanId}. No se sube config.`);
                    continue; 
                }

                const { error } = await supabase.from("devices").upsert({
                    id: cleanId,
                    alias: sensor.alias,
                    type: sensor.type,
                    name_farm: sensor.location,
                    activity: sensor.activity,
                    lat: sensor.lat,
                    lng: sensor.lng,
                    config: JSON.parse(sensor.config_json || "{}"),
                    last_sync: new Date().toISOString(),
                });

                if (error) console.error(`❌ [SYNC] Error sensor ${cleanId}:`, error.message);
                else await markSensorSynced(sensor.id);
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error sensores:", e); }

    // B. SUBIR ELECTRODOS
    try {
        const pendingElectrodes = await db.getAllAsync<ElectrodeEntity>(
            "SELECT * FROM device_electrodes WHERE is_synced = 0"
        );
        // Agrupamos por sensor para no consultar rol por cada electrodo
        const uniqueSensors = [...new Set(pendingElectrodes.map(e => e.sensor_id))];

        for (const rawSensorId of uniqueSensors) {
            const cleanId = rawSensorId.replace("SEN-", "").trim();
            const role = await getUserRole(cleanId);
            
            if (role !== 'owner' && role !== 'editor') continue;

            // Filtramos electrodos de este sensor
            const electrodesBatch = pendingElectrodes.filter(e => e.sensor_id === rawSensorId);
            
            const payload = electrodesBatch.map(elec => ({
                id: elec.id,
                device_id: cleanId,
                electrode_index: elec.electrode_index,
                depth: elec.depth,
                texture: elec.texture,
                density: elec.density,
                points_json: JSON.parse(elec.points_json || "[]"), 
                equations_json: JSON.parse(elec.equations_json || "[]"),
                updated_at: new Date().toISOString()
            }));

            const { error } = await supabase.from("device_electrodes").upsert(payload);
            if (!error) {
                for (const elec of electrodesBatch) await markElectrodeSynced(elec.id);
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error electrodos:", e); }

    // C. SUBIR LECTURAS B01 (SUELO)
    try {
        const pendingReadings = await db.getAllAsync<ReadingB01>(
            "SELECT * FROM readings_b01 WHERE is_synced = 0 LIMIT 50"
        );
        
        if (pendingReadings.length > 0) {
            // Agrupar por sensor
            const sensorsInBatch = [...new Set(pendingReadings.map(r => r.sensor_id))];

            for (const rawSensorId of sensorsInBatch) {
                const cleanId = rawSensorId.replace("SEN-", "").trim();
                
                // 1. CHECK DE ROL: Si soy Viewer, NO subo.
                const role = await getUserRole(cleanId);
                if (role !== 'owner' && role !== 'editor') {
                    console.log(`🔒 [SYNC] Salteando B01 para ${cleanId} (Rol: ${role}).`);
                    continue; 
                }

                // 2. Preparar Payload solo para este sensor
                const batch = pendingReadings.filter(r => r.sensor_id === rawSensorId);
                console.log(`📤 [SYNC] Subiendo ${batch.length} lecturas B01 para ${cleanId}...`);

                const payload = batch.map(r => ({
                    device_id: cleanId,
                    sensor_id: cleanId,
                    sensor_type: 'B01',
                    timestamp: r.timestamp, 
                    soil_temp: r.soil_temp,
                    e1_mv: r.e1_mv, e2_mv: r.e2_mv, e3_mv: r.e3_mv,
                    battery_mv: r.battery_mv
                }));

                const { error } = await supabase.from('readings_b01').upsert(payload, { 
                    onConflict: 'sensor_id, timestamp', 
                    ignoreDuplicates: true 
                });
                
                if (!error) {
                    const ids = batch.map(r => r.id).join(',');
                    await db.runAsync(`UPDATE readings_b01 SET is_synced = 1 WHERE id IN (${ids})`);
                    console.log("✅ [SYNC] B01 subido.");
                } else {
                    console.error("❌ [SYNC] Error B01:", error.message);
                }
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error lecturas B01:", e); }

    // D. SUBIR LECTURAS C01 (CLIMA)
    try {
        const pendingReadings = await db.getAllAsync<ReadingC01>(
            "SELECT * FROM readings_c01 WHERE is_synced = 0 LIMIT 50"
        );
        
        if (pendingReadings.length > 0) {
            const sensorsInBatch = [...new Set(pendingReadings.map(r => r.sensor_id))];

            for (const rawSensorId of sensorsInBatch) {
                const cleanId = rawSensorId.replace("SEN-", "").trim();
                const role = await getUserRole(cleanId);
                
                if (role !== 'owner' && role !== 'editor') {
                    console.log(`🔒 [SYNC] Salteando C01 para ${cleanId} (Rol: ${role}).`);
                    continue;
                }

                const batch = pendingReadings.filter(r => r.sensor_id === rawSensorId);
                const payload = batch.map(r => ({
                    device_id: cleanId,
                    sensor_id: cleanId,
                    sensor_type: 'C01',
                    timestamp: r.timestamp,
                    air_temp: r.air_temp,
                    humidity: r.humidity,
                    battery_mv: r.battery_mv
                }));

                const { error } = await supabase.from('readings_c01').upsert(payload, {
                    onConflict: 'sensor_id, timestamp',
                    ignoreDuplicates: true
                });
                
                if (!error) {
                    const ids = batch.map(r => r.id).join(',');
                    await db.runAsync(`UPDATE readings_c01 SET is_synced = 1 WHERE id IN (${ids})`);
                    console.log("✅ [SYNC] C01 subido.");
                } else {
                    console.error("❌ [SYNC] Error C01:", error.message);
                }
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error lecturas C01:", e); }
  },
  
  // ==============================================================================
  // 2. PULL (BAJADA: Nube -> Local)
  // ==============================================================================
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 [SYNC] Iniciando PULL completo...");

    try {
        const { data: remoteDevices, error: devErr } = await supabase.from("devices").select("*");
        
        if (devErr) { console.error("❌ [SYNC] Error bajando devices:", devErr.message); return; }
        if (!remoteDevices || remoteDevices.length === 0) return; 

        const now = new Date().toISOString();

        for (const remote of remoteDevices) {
            const localSensorId = remote.id.trim();

            const localSensor: SensorEntity = {
                id: localSensorId,
                alias: remote.alias,
                type: remote.type as any,
                location: remote.name_farm,
                activity: remote.activity,
                lat: remote.lat,
                lng: remote.lng,
                config_json: JSON.stringify(remote.config),
                is_synced: 1, 
                updated_at: remote.created_at || now,
            };
            await saveSensor(localSensor, true);

            const { data: remoteElecs } = await supabase
                .from("device_electrodes")
                .select("*")
                .eq("device_id", remote.id);

            if (remoteElecs) {
                for (const re of remoteElecs) {
                    const localElec: ElectrodeEntity = {
                        id: re.id,
                        sensor_id: localSensorId,
                        electrode_index: re.electrode_index,
                        depth: re.depth,
                        texture: re.texture,
                        density: re.density,
                        points_json: JSON.stringify(re.points_json),
                        equations_json: JSON.stringify(re.equations_json),
                        is_synced: 1,
                        updated_at: re.updated_at || now,
                    };
                    await saveElectrode(localElec);
                }
            }
            
            // 3. BAJAR ÚLTIMA LECTURA
            if (remote.type === 'B01') {
                const { data: readings } = await supabase
                    .from('readings_b01')
                    .select('*')
                    .eq('device_id', remote.id) 
                    .order('timestamp', { ascending: false })
                    .limit(1);

                if (readings && readings.length > 0) {
                    const mappedReadings = readings.map(r => ({
                        ...r,
                        sensor_id: localSensorId, 
                        is_synced: 1
                    }));
                    await insertReadingsB01(mappedReadings as ReadingB01[]);
                }
            } else if (remote.type === 'C01') {
                const { data: readings } = await supabase
                    .from('readings_c01')
                    .select('*')
                    .eq('device_id', remote.id)
                    .order('timestamp', { ascending: false })
                    .limit(1);

                if (readings && readings.length > 0) {
                    const mappedReadings = readings.map(r => ({
                        ...r,
                        sensor_id: localSensorId,
                        is_synced: 1
                    }));
                    await insertReadingsC01(mappedReadings as ReadingC01[]);
                }
            }
        }

        await AsyncStorage.setItem(LAST_PULL_KEY, now);
        
    } catch (error: any) {
        console.error("❌ [SYNC] Error crítico en Pull:", error.message);
    }
  },

  // 3. SYNC ALL
  async syncAll() {
    if (isSyncing) return;
    try {
        isSyncing = true;
        await this.pushChanges();
        await this.pullChanges();
        console.log("✨ [SYNC] Sincronización Global Finalizada");
    } catch (e) {
        console.error("❌ [SYNC] Error crítico en syncAll:", e);
    } finally {
        isSyncing = false;
    }
  },
};