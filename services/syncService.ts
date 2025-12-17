import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  getSensorsPendingSync,
  markSensorSynced,
  saveSensor,
} from "../database/SensorRepository";
import { SensorEntity } from "../database/types";
import { supabase } from "../lib/supabase";

const LAST_PULL_KEY = "LAST_SYNC_TIMESTAMP";

export const syncService = {
  // 1. VERIFICAR CONEXIÓN
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return (state.isConnected && state.isInternetReachable) || false;
  },

  // RESETEAR SYNC
  async resetSyncDate() {
      await AsyncStorage.removeItem(LAST_PULL_KEY);
      console.log("🔄 Fecha de sync reseteada.");
  },

  // 2. PUSH (SUBIDA): SQLite -> Supabase
  async pushChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 Iniciando PUSH...");

    const pendingSensors = await getSensorsPendingSync();

    for (const sensor of pendingSensors) {
      // A. Protección: ¿Existe ya en la nube? (Tabla 'devices')
      const { data: cloudDevice } = await supabase
        .from("devices") 
        .select("*")
        .eq("id", sensor.id)
        .single();

      if (cloudDevice) {
        // CONFLICTO: Ya existe en la nube. La nube gana.
        console.log(`⚠️ Conflicto: Sensor ${sensor.id} ya existe. Priorizando nube.`);

        // Mapeo Nube -> Local
        const localSensorUpdated: SensorEntity = {
          id: cloudDevice.id,
          alias: cloudDevice.alias, 
          type: cloudDevice.type,
          location: cloudDevice.name_farm, // Mapeo: name_farm -> location
          activity: cloudDevice.activity,
          lat: cloudDevice.lat,
          lng: cloudDevice.lng,
          config_json: JSON.stringify(cloudDevice.config), // Mapeo: config (json) -> string
          is_synced: 1, 
          updated_at: cloudDevice.created_at, // Usamos created_at por defecto si no hay updated_at
          last_sync: new Date().toISOString()
        };

        await saveSensor(localSensorUpdated, true);
      } else {
        // NO EXISTE: Es nuevo, lo subimos.
        console.log(`📤 Subiendo nuevo dispositivo: ${sensor.id}`);

        // Mapeo Local -> Nube
        const { error } = await supabase.from("devices").insert({
          id: sensor.id,
          alias: sensor.alias,
          type: sensor.type,
          name_farm: sensor.location,      // Mapeo: location -> name_farm
          activity: sensor.activity,
          lat: sensor.lat,
          lng: sensor.lng,
          config: JSON.parse(sensor.config_json || "{}"), // Mapeo: string -> jsonb
          // Supabase pone created_at automático
        });

        if (!error) {
          await markSensorSynced(sensor.id);
        } else {
          console.error(`❌ Error subiendo ${sensor.id}:`, error);
        }
      }
    }
  },

  // 3. PULL (BAJADA): Supabase -> SQLite
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 Iniciando PULL...");

    const lastSync = (await AsyncStorage.getItem(LAST_PULL_KEY)) || "1970-01-01T00:00:00Z";
    const now = new Date().toISOString();

    // Traer dispositivos creados recientemente
    // NOTA: Tu tabla 'devices' no tiene 'updated_at', solo 'created_at'.
    // Usamos 'created_at' para traer nuevos. Si editas un nombre en la nube, 
    // no se bajará hasta que agregues una columna 'updated_at' en Supabase.
    const { data: remoteDevices, error } = await supabase
      .from("devices")
      .select("*")
      .gt("created_at", lastSync);

    if (error) {
      console.error("❌ Error bajando devices:", error);
      return;
    }

    if (remoteDevices && remoteDevices.length > 0) {
      for (const remote of remoteDevices) {
        // Mapeo Nube -> Local
        const localSensor: SensorEntity = {
          id: remote.id,
          alias: remote.alias,
          type: remote.type,
          location: remote.name_farm, // Mapeo
          activity: remote.activity,
          lat: remote.lat,
          lng: remote.lng,
          config_json: JSON.stringify(remote.config), // Mapeo
          is_synced: 1, // Viene de la nube
          updated_at: remote.created_at,
          last_sync: now
        };

        await saveSensor(localSensor, true);
      }
      console.log(`⬇️ Descargados ${remoteDevices.length} dispositivos.`);
    }

    await AsyncStorage.setItem(LAST_PULL_KEY, now);
  },

  // 4. ORQUESTADOR
  async syncAll() {
    if (!(await this.isOnline())) {
      console.log("📴 Modo Offline.");
      return;
    }
    try {
      await this.pushChanges(); 
      await this.pullChanges(); 
      console.log("✨ Sincronización completa.");
    } catch (error) {
      console.error("Error en SyncAll:", error);
    }
  },
};