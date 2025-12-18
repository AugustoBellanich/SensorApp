import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

// --- REPOSITORIOS Y DB ---
import { db } from "../database/DatabaseInit";
import {
    markElectrodeSynced,
    saveElectrode
} from "../database/ElectrodeRepository";
import {
    deleteSensor,
    getAllSensors,
    getSensorsPendingSync,
    markSensorSynced,
    saveSensor,
} from "../database/SensorRepository";

// --- TIPOS Y LIB ---
import { ElectrodeEntity, SensorEntity } from "../database/types";
import { supabase } from "../lib/supabase";

const LAST_PULL_KEY = "LAST_SYNC_TIMESTAMP";

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

    // ---------------------------------------------------------
    // A. SUBIR SENSORES PENDIENTES (Tabla: devices)
    // ---------------------------------------------------------
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

                if (error) {
                    console.error(`❌ [SYNC] Error subiendo sensor ${cleanId}:`, error.message);
                } else {
                    await markSensorSynced(sensor.id);
                }
            }
        }
    } catch (e) {
        console.error("❌ [SYNC] Error en bucle de sensores:", e);
    }

    // ---------------------------------------------------------
    // B. SUBIR ELECTRODOS PENDIENTES (Tabla: device_electrodes)
    // ---------------------------------------------------------
    try {
        // Consultamos directamente a SQLite los electrodos marcados como no sincronizados
        const pendingElectrodes = await db.getAllAsync<ElectrodeEntity>(
            "SELECT * FROM device_electrodes WHERE is_synced = 0"
        );

        if (pendingElectrodes.length > 0) {
            console.log(`📤 [SYNC] Subiendo ${pendingElectrodes.length} calibraciones...`);

            // Mapeamos los datos locales al formato de Supabase
            // IMPORTANTE: SQLite guarda JSON como string, Supabase lo quiere como Objeto JSONB
            const electrodesPayload = pendingElectrodes.map(elec => ({
                id: elec.id,
                device_id: elec.sensor_id.replace("SEN-", ""), // Traducción: sensor_id -> device_id
                electrode_index: elec.electrode_index,
                depth: elec.depth,
                texture: elec.texture,
                density: elec.density,
                points_json: JSON.parse(elec.points_json || "[]"), 
                equations_json: JSON.parse(elec.equations_json || "[]"),
                updated_at: new Date().toISOString()
            }));

            // Upsert masivo a Supabase (Más eficiente que un bucle for)
            const { error } = await supabase
                .from("device_electrodes")
                .upsert(electrodesPayload);

            if (error) {
                console.error("❌ [SYNC] Error Supabase al subir electrodos:", error.message);
            } else {
                // Si todo sale bien, marcamos como synced en local uno por uno
                for (const elec of pendingElectrodes) {
                    await markElectrodeSynced(elec.id);
                }
                console.log(`✅ [SYNC] ${pendingElectrodes.length} electrodos sincronizados correctamente.`);
            }
        }
    } catch (e) {
        console.error("❌ [SYNC] Error consultando/subiendo electrodos:", e);
    }
  },

  // ==============================================================================
  // 2. PULL (BAJADA: Nube -> Local)
  // ==============================================================================
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 [SYNC] Iniciando PULL completo...");

    try {
        // A. Bajar dispositivos (Devices -> sensors)
        const { data: remoteDevices, error: devErr } = await supabase.from("devices").select("*");
        
        if (devErr) throw devErr;
        if (!remoteDevices) return;

        const allowedIds = remoteDevices.map((d) => d.id);
        const now = new Date().toISOString();

        for (const remote of remoteDevices) {
            // 1. Guardar/Actualizar Sensor Local
            const localSensor: SensorEntity = {
                id: remote.id, // Si usas prefijo SEN- localmente, agrégalo aquí
                alias: remote.alias,
                type: remote.type as any,
                location: remote.name_farm,
                activity: remote.activity,
                lat: remote.lat,
                lng: remote.lng,
                config_json: JSON.stringify(remote.config),
                is_synced: 1, // Viene de la nube -> está limpio
                updated_at: remote.created_at || now,
            };
            await saveSensor(localSensor, true); // true = forzar update sin marcar dirty

            // 2. Bajar Electrodos de este dispositivo
            const { data: remoteElecs, error: elecErr } = await supabase
                .from("device_electrodes")
                .select("*")
                .eq("device_id", remote.id);

            if (!elecErr && remoteElecs) {
                for (const re of remoteElecs) {
                    const localElec: ElectrodeEntity = {
                        id: re.id,
                        sensor_id: re.device_id, // Si usas prefijo SEN-, ajustarlo aquí
                        electrode_index: re.electrode_index,
                        depth: re.depth,
                        texture: re.texture,
                        density: re.density,
                        // Al bajar de Supabase (Objeto) a SQLite (String), hacemos stringify
                        points_json: JSON.stringify(re.points_json),
                        equations_json: JSON.stringify(re.equations_json),
                        is_synced: 1,
                        updated_at: re.updated_at || now,
                    };
                    await saveElectrode(localElec);
                }
            }
        }

        // C. Limpieza (Borrar locales que fueron borrados en la nube)
        const allLocal = await getAllSensors();
        for (const local of allLocal) {
            const cleanLocalId = local.id.replace("SEN-", "");
            // Si está sincronizado (is_synced=1) PERO ya no existe en la lista remota -> Borrar
            if (local.is_synced === 1 && !allowedIds.includes(cleanLocalId) && !allowedIds.includes(local.id)) {
                console.log(`🗑️ [SYNC] Eliminando sensor obsoleto: ${local.id}`);
                await deleteSensor(local.id);
            }
        }

        await AsyncStorage.setItem(LAST_PULL_KEY, now);
        
    } catch (error: any) {
        console.error("❌ [SYNC] Error en Pull:", error.message);
    }
  },

  // ==============================================================================
  // 3. SYNC ALL (Orquestador)
  // ==============================================================================
  async syncAll() {
    try {
      await this.pushChanges();
      await this.pullChanges();
      console.log("✨ [SYNC] Sincronización Global Finalizada");
    } catch (e) {
      console.error("❌ [SYNC] Error crítico en syncAll:", e);
    }
  },
};