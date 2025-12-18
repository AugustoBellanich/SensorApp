import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  deleteSensor,
  getAllSensors,
  getSensorsPendingSync,
  markSensorSynced,
  saveSensor,
} from "../database/SensorRepository";
// Importamos las funciones que crearemos en ElectrodeRepository
import {
  getElectrodesBySensor,
  markElectrodeSynced,
  saveElectrode
} from "../database/ElectrodeRepository";
import { ElectrodeEntity, SensorEntity } from "../database/types";
import { supabase } from "../lib/supabase";

const LAST_PULL_KEY = "LAST_SYNC_TIMESTAMP";

export const syncService = {
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return (state.isConnected && state.isInternetReachable) || false;
  },

  // --- PUSH (SUBIDA) ---
  async pushChanges() {
    if (!(await this.isOnline())) return;
    const pendingSensors = await getSensorsPendingSync();

    for (const sensor of pendingSensors) {
      const cleanId = sensor.id.replace("SEN-", "");
      console.log(`📤 Sincronizando dispositivo ${cleanId}...`);

      // 1. Upsert al dispositivo
      const { error: devError } = await supabase.from("devices").upsert({
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

      if (devError) {
        console.error(`❌ Error en device ${cleanId}:`, devError.message);
        continue;
      }

      // 2. Sincronizar Electrodos de este dispositivo
      const electrodes = await getElectrodesBySensor(sensor.id);
      for (const elec of electrodes) {
        const { error: elecError } = await supabase.from("device_electrodes").upsert({
          id: elec.id,
          device_id: cleanId,
          electrode_index: elec.electrode_index,
          depth: elec.depth,
          texture: elec.texture,
          density: elec.density,
          points_json: JSON.parse(elec.points_json || "[]"),
          equations_json: JSON.parse(elec.equations_json || "[]"),
          updated_at: new Date().toISOString(),
        });

        if (!elecError) {
          await markElectrodeSynced(elec.id);
        } else {
          console.error(`❌ Error en electrodo ${elec.id}:`, elecError.message);
        }
      }

      await markSensorSynced(sensor.id);
      console.log(`✅ ${cleanId} y sus electrodos sincronizados.`);
    }
  },

  // --- PULL (BAJADA) ---
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 Iniciando PULL completo...");

    // A. Bajar dispositivos permitidos
    const { data: remoteDevices, error: devErr } = await supabase.from("devices").select("*");
    if (devErr || !remoteDevices) return;

    const allowedIds = remoteDevices.map((d) => d.id);
    const now = new Date().toISOString();

    for (const remote of remoteDevices) {
      // Guardar Sensor localmente
      const localSensor: SensorEntity = {
        id: remote.id,
        alias: remote.alias,
        type: remote.type as any,
        location: remote.name_farm,
        activity: remote.activity,
        lat: remote.lat,
        lng: remote.lng,
        config_json: JSON.stringify(remote.config),
        is_synced: 1,
        updated_at: remote.created_at,
      };
      await saveSensor(localSensor, true);

      // B. Bajar Electrodos de este dispositivo
      const { data: remoteElecs, error: elecErr } = await supabase
        .from("device_electrodes")
        .select("*")
        .eq("device_id", remote.id);

      if (!elecErr && remoteElecs) {
        for (const re of remoteElecs) {
          const localElec: ElectrodeEntity = {
            id: re.id,
            sensor_id: re.device_id,
            electrode_index: re.electrode_index,
            depth: re.depth,
            texture: re.texture,
            density: re.density,
            points_json: JSON.stringify(re.points_json),
            equations_json: JSON.stringify(re.equations_json),
            is_synced: 1,
            updated_at: re.updated_at,
          };
          await saveElectrode(localElec);
        }
      }
    }

    // C. Limpieza (Opcional: borrar locales que no están en la nube y ya se habían sincronizado)
    const allLocal = await getAllSensors();
    for (const local of allLocal) {
      if (local.is_synced === 1 && !allowedIds.includes(local.id)) {
        await deleteSensor(local.id);
      }
    }

    await AsyncStorage.setItem(LAST_PULL_KEY, now);
  },

  async syncAll() {
    try {
      await this.pushChanges();
      await this.pullChanges();
      console.log("✨ Sincronización Global Finalizada");
    } catch (e) {
      console.error("Error en syncAll:", e);
    }
  },
};