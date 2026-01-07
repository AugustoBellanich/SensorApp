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
    getSensorById,
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

// ==============================================================================
// HELPER: ROL LOCAL FIRST
// ==============================================================================
const getUserRole = async (deviceId: string): Promise<'owner' | 'editor' | 'viewer' | null> => {
    try {
        const cleanId = deviceId.replace("SEN-", "").trim();
        // 1. Intento Local (Prioridad para permitir subidas offline-first)
        const localSensor = await getSensorById(cleanId);
        if (localSensor && localSensor.config_json) {
            try {
                const config = JSON.parse(localSensor.config_json);
                if (config.role) return config.role;
            } catch {}
        }

        // 2. Intento Nube (Fallback)
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        const { data } = await supabase
            .from('sensor_permissions')
            .select('role')
            .eq('device_id', cleanId)
            .eq('user_id', user.id)
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
  // 1. PUSH (SUBIDA: Local -> Nube)
  // ==============================================================================
  async pushChanges() {
    console.log("🔄 [SYNC] Iniciando subida de datos...");
    
    const online = await this.isOnline();
    console.log(`🌐 Estado de red: ${online ? 'ONLINE' : 'OFFLINE'}`);

    if (!online) {
        console.log("⚠️ [SYNC] Abortando por falta de conexión.");
        return;
    }

    // A. SUBIR SENSORES (METADATA)
    try {
        const pendingSensors = await getSensorsPendingSync();
        if (pendingSensors.length > 0) {
            console.log(`📤 [SYNC] Verificando ${pendingSensors.length} sensores pendientes...`);
            for (const sensor of pendingSensors) {
                const cleanId = sensor.id.replace("SEN-", "").trim(); 
                
                const role = await getUserRole(cleanId);
                
                // Solo subimos cambios de config si somos dueños o editores
                if (role !== 'owner' && role !== 'editor') {
                    console.log(`🔒 [SYNC] Rol '${role}' en ${cleanId}. Solo marco synced local.`);
                    await markSensorSynced(sensor.id); 
                    continue; 
                }

                console.log(`🚀 [SYNC] Subiendo ${cleanId}...`);

                // 1. Inferencia de Tipo (Evita error 400 Not Null)
                let finalType = sensor.type;
                if (!finalType) {
                    if (cleanId.startsWith("B01")) finalType = "B01";
                    else if (cleanId.startsWith("C01")) finalType = "C01";
                    else if (cleanId.startsWith("N01")) finalType = "N01";
                    else finalType = "UNKNOWN" as any;
                }

                // 2. Conversión Numérica Segura
                const latNum = parseFloat(sensor.lat as any) || 0;
                const lngNum = parseFloat(sensor.lng as any) || 0;

                const { error } = await supabase.from("devices").upsert({
                    id: cleanId,
                    alias: sensor.alias,
                    type: finalType,
                    name_farm: sensor.location,
                    activity: sensor.activity,
                    lat: latNum,
                    lng: lngNum,
                    config: JSON.parse(sensor.config_json || "{}"),
                    last_sync: new Date().toISOString(),
                });

                if (error) console.error(`❌ [SYNC] Error sensor ${cleanId}:`, error.message);
                else {
                    console.log(`✅ [SYNC] ${cleanId} subido OK.`);
                    await markSensorSynced(sensor.id);
                }
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error sensores:", e); }

    // B. SUBIR ELECTRODOS
    try {
        const pendingElectrodes = await db.getAllAsync<ElectrodeEntity>(
            "SELECT * FROM device_electrodes WHERE is_synced = 0"
        );
        if (pendingElectrodes.length > 0) {
            const uniqueSensors = [...new Set(pendingElectrodes.map(e => e.sensor_id))];

            for (const rawSensorId of uniqueSensors) {
                const cleanId = rawSensorId.replace("SEN-", "").trim();
                const role = await getUserRole(cleanId);
                
                if (role !== 'owner' && role !== 'editor') continue;

                const electrodesBatch = pendingElectrodes.filter(e => e.sensor_id === rawSensorId);
                
                // Mapeo sensor_id -> device_id
                const payload = electrodesBatch.map(elec => ({
                    id: elec.id,
                    device_id: cleanId, // <--- MAPEO CORRECTO
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
                } else {
                    console.error("❌ [SYNC] Error subiendo electrodos:", error.message);
                }
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error electrodos:", e); }

    // C. SUBIR LECTURAS B01
    try {
        const pendingReadings = await db.getAllAsync<ReadingB01>(
            "SELECT * FROM readings_b01 WHERE is_synced = 0 LIMIT 50"
        );
        
        if (pendingReadings.length > 0) {
            const sensorsInBatch = [...new Set(pendingReadings.map(r => r.sensor_id))];

            for (const rawSensorId of sensorsInBatch) {
                const cleanId = rawSensorId.replace("SEN-", "").trim();
                const role = await getUserRole(cleanId);
                if (!role || role === 'viewer') continue; 

                const batch = pendingReadings.filter(r => r.sensor_id === rawSensorId);
                
                const payload = batch.map(r => ({
                    device_id: cleanId, // <--- MAPEO CORRECTO
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
                } else {
                    console.error("❌ [SYNC] Error B01:", error.message);
                }
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error lecturas B01:", e); }

    // D. SUBIR LECTURAS C01
    try {
        const pendingReadings = await db.getAllAsync<ReadingC01>(
            "SELECT * FROM readings_c01 WHERE is_synced = 0 LIMIT 50"
        );
        
        if (pendingReadings.length > 0) {
            const sensorsInBatch = [...new Set(pendingReadings.map(r => r.sensor_id))];

            for (const rawSensorId of sensorsInBatch) {
                const cleanId = rawSensorId.replace("SEN-", "").trim();
                const role = await getUserRole(cleanId);
                if (!role || role === 'viewer') continue;

                const batch = pendingReadings.filter(r => r.sensor_id === rawSensorId);
                const payload = batch.map(r => ({
                    device_id: cleanId, // <--- MAPEO CORRECTO
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
                } else {
                    console.error("❌ [SYNC] Error C01:", error.message);
                }
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error lecturas C01:", e); }
  },
  
  // ==============================================================================
  // 2. PULL (BAJADA: Nube -> Local) - PROTEGIDO CONTRA SOBRESCRITURA
  // ==============================================================================
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 [SYNC] Iniciando PULL completo...");

    try {
        const { data: myPermissions, error: permError } = await supabase
            .from('sensor_permissions')
            .select('role, device_id, devices (*)');
        
        if (permError) { console.error("❌ [SYNC] Error bajando permisos:", permError.message); return; }
        if (!myPermissions || myPermissions.length === 0) return; 

        const now = new Date().toISOString();

        for (const item of myPermissions) {
            const remote: any = item.devices; 
            if (!remote) continue;

            const localSensorId = remote.id.trim();
            
            // 🛡️ PROTECCIÓN DE SOBRESCRITURA
            // Antes de bajar datos, vemos si hay cambios locales pendientes.
            const existingLocal = await getSensorById(localSensorId);
            
            // Si existe localmente Y tiene cambios pendientes (is_synced = 0)
            // IGNORAMOS la actualización de metadata de la nube.
            if (existingLocal && existingLocal.is_synced === 0) {
                 console.log(`🛡️ [SYNC] Saltando bajada de metadata para ${localSensorId}: Hay cambios locales pendientes.`);
            } else {
                // Si está sincronizado, bajamos lo nuevo de la nube
                const myRole = item.role;
                let configObj = {};
                try { configObj = remote.config || {}; } catch {}
                const localConfig = { ...configObj, role: myRole };

                const localSensor: SensorEntity = {
                    id: localSensorId,
                    alias: remote.alias,
                    type: remote.type as any,
                    location: remote.name_farm,
                    activity: remote.activity,
                    lat: remote.lat,
                    lng: remote.lng,
                    config_json: JSON.stringify(localConfig),
                    is_synced: 1, // Viene de la nube, está synced
                    updated_at: remote.created_at || now,
                };
                await saveSensor(localSensor, true);
            }

            // B. Descargar Electrodos (Mapeo Inverso)
            const { data: remoteElecs } = await supabase
                .from("device_electrodes")
                .select("*")
                .eq("device_id", remote.id);

            if (remoteElecs) {
                for (const re of remoteElecs) {
                    const localElec: ElectrodeEntity = {
                        id: re.id,
                        sensor_id: re.device_id, // <--- MAPEO: device_id (nube) -> sensor_id (local)
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
            
            // C. Descargar ÚLTIMA LECTURA
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
                        sensor_id: r.device_id, // <--- MAPEO
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
                        sensor_id: r.device_id, // <--- MAPEO
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
        
        // ORDEN CRÍTICO: Primero subimos (Push), luego bajamos (Pull)
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