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
    deleteSensor,
    getAllSensors,
    getSensorsPendingSync,
    markSensorSynced,
    saveSensor,
} from "../database/SensorRepository";

// --- TIPOS Y LIB ---
import { ElectrodeEntity, ReadingB01, ReadingC01, SensorEntity } from "../database/types";
import { supabase } from "../lib/supabase";

const LAST_PULL_KEY = "LAST_SYNC_TIMESTAMP";

// VARIABLE DE BLOQUEO (SEMÁFORO)
let isSyncing = false;

export const syncService = {
  // Verificación de conexión
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return (state.isConnected && state.isInternetReachable) || false;
  },

  // ==============================================================================
  // 1. PUSH (SUBIDA: Local -> Nube) 
  // ==============================================================================
  async pushChanges() {
    console.log("🔄 [SYNC] Iniciando subida de datos...");
    
    if (!(await this.isOnline())) {
        console.log("⚠️ [SYNC] Sin conexión. Se intentará más tarde.");
        return;
    }

    // A. SUBIR SENSORES PENDIENTES
    try {
        const pendingSensors = await getSensorsPendingSync();
        if (pendingSensors.length > 0) {
            console.log(`📤 [SYNC] Subiendo ${pendingSensors.length} sensores...`);
            for (const sensor of pendingSensors) {
                const cleanId = sensor.id.replace("SEN-", ""); 
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

    // B. SUBIR ELECTRODOS PENDIENTES
    try {
        const pendingElectrodes = await db.getAllAsync<ElectrodeEntity>(
            "SELECT * FROM device_electrodes WHERE is_synced = 0"
        );
        if (pendingElectrodes.length > 0) {
            console.log(`📤 [SYNC] Subiendo ${pendingElectrodes.length} calibraciones...`);
            const electrodesPayload = pendingElectrodes.map(elec => ({
                id: elec.id,
                device_id: elec.sensor_id.replace("SEN-", ""),
                electrode_index: elec.electrode_index,
                depth: elec.depth,
                texture: elec.texture,
                density: elec.density,
                points_json: JSON.parse(elec.points_json || "[]"), 
                equations_json: JSON.parse(elec.equations_json || "[]"),
                updated_at: new Date().toISOString()
            }));
            const { error } = await supabase.from("device_electrodes").upsert(electrodesPayload);
            if (error) {
                console.error("❌ [SYNC] Error electrodos:", error.message);
            } else {
                for (const elec of pendingElectrodes) await markElectrodeSynced(elec.id);
                console.log(`✅ [SYNC] Electrodos subidos.`);
            }
        }
    } catch (e) { console.error("❌ [SYNC] Error electrodos:", e); }
  },

  // ==============================================================================
  // 2. PULL (BAJADA: Nube -> Local)
  // ==============================================================================
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 [SYNC] Iniciando PULL completo...");

    try {
        // A. Bajar Dispositivos
        const { data: remoteDevices, error: devErr } = await supabase.from("devices").select("*");
        if (devErr) throw devErr;
        if (!remoteDevices) return;

        const allowedIds = remoteDevices.map((d) => d.id);
        const now = new Date().toISOString();

        for (const remote of remoteDevices) {
            const localSensorId = remote.id; 

            // 1. Guardar Sensor Local
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

            // 2. Bajar Electrodos
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
            console.log(`⬇️ [SYNC] Bajando último dato para ${remote.id} (${remote.type})...`);
            
            if (remote.type === 'B01') {
                const { data: readings } = await supabase
                    .from('readings_b01')
                    .select('*')
                    .eq('sensor_id', remote.id) 
                    .order('timestamp', { ascending: false })
                    .limit(1);

                if (readings && readings.length > 0) {
                    const mappedReadings = readings.map(r => ({
                        ...r,
                        sensor_id: localSensorId, 
                        is_synced: 1
                    }));
                    await insertReadingsB01(mappedReadings as ReadingB01[]);
                    console.log(`   ✅ Último B01 guardado: ${readings[0].timestamp}`);
                }
            } else if (remote.type === 'C01') {
                const { data: readings } = await supabase
                    .from('readings_c01')
                    .select('*')
                    .eq('sensor_id', remote.id)
                    .order('timestamp', { ascending: false })
                    .limit(1);

                if (readings && readings.length > 0) {
                    const mappedReadings = readings.map(r => ({
                        ...r,
                        sensor_id: localSensorId,
                        is_synced: 1
                    }));
                    await insertReadingsC01(mappedReadings as ReadingC01[]);
                    console.log(`   ✅ Último C01 guardado: ${readings[0].timestamp}`);
                }
            }
        }

        // C. Limpieza
        const allLocal = await getAllSensors();
        for (const local of allLocal) {
            if (local.is_synced === 1 && !allowedIds.includes(local.id)) {
                await deleteSensor(local.id);
            }
        }

        await AsyncStorage.setItem(LAST_PULL_KEY, now);
        
    } catch (error: any) {
        console.error("❌ [SYNC] Error en Pull:", error.message);
    }
  },

  // 3. SYNC ALL (CON SEMÁFORO PARA EVITAR DOBLE EJECUCIÓN)
  async syncAll() {
    if (isSyncing) {
        console.log("⏳ [SYNC] Sincronización ya en curso. Ignorando llamada duplicada.");
        return;
    }

    try {
      isSyncing = true; // BLOQUEAR
      await this.pushChanges();
      await this.pullChanges();
      console.log("✨ [SYNC] Sincronización Global Finalizada");
    } catch (e) {
      console.error("❌ [SYNC] Error crítico en syncAll:", e);
    } finally {
      isSyncing = false; // LIBERAR SIEMPRE
    }
  },
};