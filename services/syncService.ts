import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  deleteSensor,
  getAllSensors,
  getSensorsPendingSync,
  markSensorSynced,
  saveSensor,
} from "../database/SensorRepository";
import { SensorEntity } from "../database/types";
import { supabase } from "../lib/supabase";

const LAST_PULL_KEY = "LAST_SYNC_TIMESTAMP";

export const syncService = {
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return (state.isConnected && state.isInternetReachable) || false;
  },

  async resetSyncDate() {
      await AsyncStorage.removeItem(LAST_PULL_KEY);
  },

  // 2. PUSH (SUBIDA)
  async pushChanges() {
  if (!(await this.isOnline())) return;
  const pendingSensors = await getSensorsPendingSync();

  for (const sensor of pendingSensors) {
    const cleanId = sensor.id.replace("SEN-", "");

    console.log(`📤 Sincronizando metadatos de ${cleanId}...`);

    const { error } = await supabase.from("devices").upsert({
      id: cleanId,
      alias: sensor.alias,
      type: sensor.type,
      name_farm: sensor.location, 
      activity: sensor.activity,
      lat: sensor.lat,
      lng: sensor.lng,
      config: JSON.parse(sensor.config_json || "{}"),
      // CAMBIO AQUÍ: Usamos el nombre real de tu columna en Supabase
      last_sync: new Date().toISOString(), 
    });

    if (!error) {
      await markSensorSynced(sensor.id);
      console.log(`✅ ${cleanId} sincronizado con éxito.`);
    } else {
      // Si el error persiste, esto nos dirá qué columna falta
      console.error(`❌ Error sincronizando ${cleanId}:`, error.message);
    }
  }
},

  // 3. PULL (BAJADA Y LIMPIEZA)
  async pullChanges() {
    if (!(await this.isOnline())) return;
    console.log("🔄 Iniciando PULL...");

    // A. Traer permitidos
    const { data: remoteDevices, error } = await supabase
      .from("devices")
      .select("*");

    if (error) {
      console.error("❌ Error bajando devices:", error);
      return;
    }
    if (!remoteDevices) return;

    const allowedIds = remoteDevices.map(d => d.id);
    const now = new Date().toISOString();

    // B. Actualizar locales
    console.log(`⬇️ Sincronizando ${remoteDevices.length} sensores permitidos...`);
    for (const remote of remoteDevices) {
        const localSensor: SensorEntity = {
          id: remote.id,
          alias: remote.alias,
          type: remote.type,
          location: remote.name_farm, 
          activity: remote.activity,
          lat: remote.lat,
          lng: remote.lng,
          config_json: JSON.stringify(remote.config), 
          is_synced: 1, 
          updated_at: remote.created_at,
          last_sync: now
        };
        await saveSensor(localSensor, true);
    }

    // C. LIMPIEZA DE INTRUSOS
    const allLocalSensors = await getAllSensors();

    for (const local of allLocalSensors) {
        const cleanLocalId = local.id.replace("SEN-", "");
        
        // Si ya intentamos subirlo (is_synced=1) Y no está en la lista de permitidos
        if (local.is_synced === 1 && !allowedIds.includes(cleanLocalId)) {
            console.log(`🚫 Eliminando sensor no autorizado: ${local.id}`);
            await deleteSensor(local.id);
        }
    }

    await AsyncStorage.setItem(LAST_PULL_KEY, now);
    console.log("✅ PULL finalizado.");
  },

  async syncAll() {
    if (!(await this.isOnline())) return;
    try {
      await this.pushChanges(); // 1. Intenta subir (y detecta si es ajeno)
      await this.pullChanges(); // 2. Descarga permitidos y borra ajenos
      console.log("✨ Sincronización completa.");
    } catch (error) {
      console.error("Error en SyncAll:", error);
    }
  },
};