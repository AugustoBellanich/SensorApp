import { supabase } from "../lib/supabase";
import { db } from "./DatabaseInit";
import { SensorEntity } from "./types";

// =====================================================================
// HELPER: LIMPIEZA DE ID
// =====================================================================
// Quitamos "SEN-", espacios y forzamos MAYÚSCULAS para consistencia (b01 = B01)
const cleanSensorId = (id: string) =>
  id.replace(/^SEN-/i, "").trim().toUpperCase();

// =====================================================================
// 1. VINCULACIÓN INTELIGENTE (CLAIM / LINK)
// =====================================================================
export const linkNewSensor = async (
  sensor: SensorEntity
): Promise<{
  success: boolean;
  status: "OWNER" | "EDITOR_CONFIRMED" | "LOCAL_ONLY" | "OFFLINE";
  message: string;
}> => {
  const cleanId = cleanSensorId(sensor.id);
  const now = new Date().toISOString();

  try {
    // A. GUARDADO LOCAL (Prioridad Offline)
    // Guardamos primero en SQLite para asegurar que el usuario vea el sensor inmediatamente
    await db.runAsync(
      `INSERT OR IGNORE INTO sensors (
          id, alias, type, location, activity, lat, lng, config_json, last_sync, is_synced, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        cleanId,
        sensor.alias,
        sensor.type,
        sensor.location,
        sensor.activity || "",
        sensor.lat || 0,
        sensor.lng || 0,
        sensor.config_json,
        now,
        now,
      ]
    );

    // B. CHECK NUBE (Usuario autenticado)
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // Si no hay internet/usuario, guardamos como Viewer local por defecto
      const localConfig = { role: "viewer" };
      await db.runAsync("UPDATE sensors SET config_json = ? WHERE id = ?", [
        JSON.stringify(localConfig),
        cleanId,
      ]);
      return {
        success: true,
        status: "OFFLINE",
        message: "Guardado local. Inicia sesión para vincular completamente.",
      };
    }

    // C. ¿YA TENGO PERMISO? (Recuperación)
    // Verificamos si YO (mi usuario) ya tengo un rol asignado en la nube
    const { data: existingPerm } = await supabase
      .from("sensor_permissions")
      .select("role")
      .eq("device_id", cleanId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingPerm) {
      // --- CASO 1: YA SOY COLABORADOR/DUEÑO ---
      // Restauro mi rol en la base de datos local y habilito la sincronización
      await db.runAsync("UPDATE sensors SET is_synced = 1 WHERE id = ?", [
        cleanId,
      ]);

      const config = { role: existingPerm.role };
      await db.runAsync("UPDATE sensors SET config_json = ? WHERE id = ?", [
        JSON.stringify(config),
        cleanId,
      ]);

      return {
        success: true,
        status: "EDITOR_CONFIRMED",
        message: `Sensor recuperado. Tu rol es: ${existingPerm.role}.`,
      };
    }

    // =====================================================================
    // D. VERIFICAR PROPIEDAD GLOBAL (RPC)
    // =====================================================================
    const { data: isClaimed } = await supabase.rpc("is_device_claimed", {
      target_id: cleanId,
    });

    if (isClaimed) {
      // --- CASO 2: EL SENSOR YA TIENE DUEÑO ---
      console.log(
        `🔒 El sensor ${cleanId} ya tiene dueño. Registrando como VIEWER en nube...`
      );

      // 1. Intentamos registrarnos como VIEWER en la nube
      const { error: viewerError } = await supabase
        .from("sensor_permissions")
        .insert({
          user_id: user.id,
          device_id: cleanId,
          role: "viewer", // Rol explícito de espectador
        });

      if (viewerError) {
        // Si falla (ej: ya estaba registrado o error de red), solo logueamos
        // No bloqueamos porque igual queremos permitir el acceso local
        console.warn(
          "⚠️ No se pudo registrar viewer en nube (probablemente ya existe):",
          viewerError.message
        );
      } else {
        console.log("✅ Registrado como Viewer en la nube.");
      }

      // 2. Guardamos configuración LOCAL
      const viewerConfig = { role: "viewer" };

      // IMPORTANTE: is_synced en 1 para que, si en el futuro nos promueven a editor,
      // el syncService pueda bajar los cambios. Pero por ahora, como viewer,
      // nuestras lecturas locales NO se subirán (syncService filtra por rol).
      await db.runAsync(
        "UPDATE sensors SET config_json = ?, is_synced = 1 WHERE id = ?",
        [JSON.stringify(viewerConfig), cleanId]
      );

      return {
        success: true,
        status: "LOCAL_ONLY", // Mantenemos este status para que la UI muestre "Modo Visor"
        message: "Este sensor tiene dueño. Te hemos agregado como espectador.",
      };
    }

    // E. INTENTO DE CONQUISTA (NO TIENE DUEÑO -> SOY OWNER)
    // --- CASO 3: SENSOR NUEVO / LIBRE ---
    const { error } = await supabase.from("sensor_permissions").insert({
      user_id: user.id,
      device_id: cleanId,
      role: "owner",
    });

    if (error) {
      console.log("⚠️ Fallo al reclamar propiedad:", error.message);
      return {
        success: true,
        status: "LOCAL_ONLY",
        message:
          "No se pudo registrar la propiedad en la nube. Se guardó en modo local.",
      };
    }

    // ÉXITO: SOY EL NUEVO OWNER
    await db.runAsync("UPDATE sensors SET is_synced = 1 WHERE id = ?", [
      cleanId,
    ]);

    const ownerConfig = { role: "owner" };
    await db.runAsync("UPDATE sensors SET config_json = ? WHERE id = ?", [
      JSON.stringify(ownerConfig),
      cleanId,
    ]);

    // Registramos el dispositivo en la tabla maestra 'devices'
    await supabase.from("devices").upsert({
      id: cleanId,
      type: sensor.type,
      alias: sensor.alias,
      last_sync: now,
    });

    return {
      success: true,
      status: "OWNER",
      message: "¡Sensor vinculado! Eres el propietario.",
    };
  } catch (e: any) {
    console.error("Error linkNewSensor:", e);
    return {
      success: false,
      status: "OFFLINE",
      message: "Error interno: " + e.message,
    };
  }
};

// =====================================================================
// 2. DESVINCULAR (UNLINK) - LÓGICA DE LIMPIEZA
// =====================================================================
export const unlinkSensor = async (
  sensorId: string
): Promise<{ success: boolean; error?: string }> => {
  const cleanId = cleanSensorId(sensorId);

  try {
    console.log(`[UNLINK] Iniciando desvinculación para: ${cleanId}`);

    // 1. BORRAR DE LA NUBE (Solo el permiso)
    const { error: cloudError, count } = await supabase
      .from("sensor_permissions")
      .delete({ count: "exact" })
      .eq("device_id", cleanId);

    if (cloudError) {
      console.warn(
        "⚠️ Error desvinculando de nube (posiblemente offline):",
        cloudError.message
      );
    } else {
      if (count && count > 0) console.log("☁️ Permiso eliminado en la nube.");
    }

    // 2. BORRAR LOCALMENTE
    await db.runAsync("DELETE FROM readings_b01 WHERE sensor_id = ?", [
      cleanId,
    ]);
    await db.runAsync("DELETE FROM readings_c01 WHERE sensor_id = ?", [
      cleanId,
    ]);
    await db.runAsync("DELETE FROM device_electrodes WHERE sensor_id = ?", [
      cleanId,
    ]);
    await db.runAsync("DELETE FROM sensors WHERE id = ?", [cleanId]);

    console.log(`🗑️ Datos locales del sensor ${cleanId} eliminados.`);
    return { success: true };
  } catch (error: any) {
    console.error("Error fatal en unlinkSensor:", error);
    return { success: false, error: error.message };
  }
};

// =====================================================================
// 3. INVITAR COLABORADORES
// =====================================================================
export const inviteCollaborator = async (
  sensorId: string,
  email: string,
  role: "editor" | "viewer"
) => {
  const cleanId = cleanSensorId(sensorId);

  const { error } = await supabase.rpc("add_collaborator", {
    target_email: email,
    target_device_id: cleanId,
    target_role: role,
  });

  if (error) throw error;
  return true;
};

// =====================================================================
// 4. FUNCIONES CRUD ESTÁNDAR
// =====================================================================

export const getAllSensors = async (): Promise<SensorEntity[]> => {
  try {
    return await db.getAllAsync<SensorEntity>("SELECT * FROM sensors");
  } catch {
    return [];
  }
};

export const getSensorById = async (
  id: string
): Promise<SensorEntity | null> => {
  try {
    return await db.getFirstAsync<SensorEntity>(
      "SELECT * FROM sensors WHERE id = ?",
      [cleanSensorId(id)]
    );
  } catch {
    return null;
  }
};

export const updateSensorLocal = async (sensor: SensorEntity) => {
  const cleanId = cleanSensorId(sensor.id);
  const now = new Date().toISOString();
  
  console.log(`[DB] Actualizando localmente ${cleanId} y marcando para subir...`);

  try {
    // CORRECCIÓN: Agregados lat, lng, activity y SOBRE TODO is_synced = 0
    await db.runAsync(
      `UPDATE sensors SET 
          alias = ?, 
          location = ?, 
          activity = ?, 
          lat = ?, 
          lng = ?, 
          config_json = ?, 
          is_synced = 0, 
          updated_at = ? 
       WHERE id = ?`,
      [
        sensor.alias, 
        sensor.location, 
        sensor.activity || "", 
        sensor.lat || 0, 
        sensor.lng || 0, 
        sensor.config_json, 
        now, 
        cleanId
      ]
    );
  } catch (e) {
    console.error("[DB] Error en updateSensorLocal:", e);
    throw e;
  }
};

export const saveSensor = async (
  sensor: SensorEntity,
  isFromCloud: boolean = false
) => {
  const cleanId = cleanSensorId(sensor.id);
  const now = new Date().toISOString();
  const syncStatus = isFromCloud ? 1 : 0;

  try {
    await db.runAsync(
      `UPDATE sensors SET
                alias = ?, type = ?, location = ?, activity = ?, lat = ?, lng = ?,
                config_json = ?, last_sync = ?, is_synced = ?, updated_at = ?
             WHERE id = ?`,
      [
        sensor.alias,
        sensor.type,
        sensor.location,
        sensor.activity || "",
        sensor.lat || 0,
        sensor.lng || 0,
        sensor.config_json,
        sensor.last_sync || now,
        syncStatus,
        sensor.updated_at || now,
        cleanId,
      ]
    );

    const check = await db.getFirstAsync(
      "SELECT id FROM sensors WHERE id = ?",
      [cleanId]
    );
    if (!check) {
      await db.runAsync(
        `INSERT INTO sensors (
                    id, alias, type, location, activity, lat, lng, config_json, last_sync, is_synced, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanId,
          sensor.alias,
          sensor.type,
          sensor.location,
          sensor.activity || "",
          sensor.lat || 0,
          sensor.lng || 0,
          sensor.config_json,
          now,
          syncStatus,
          now,
        ]
      );
    }
  } catch (e) {
    console.error(e);
  }
};

export const getSensorsPendingSync = async (): Promise<SensorEntity[]> => {
  return await db.getAllAsync<SensorEntity>(
    `SELECT * FROM sensors WHERE is_synced = 0`
  );
};

export const markSensorSynced = async (id: string) => {
  try {
    await db.runAsync(`UPDATE sensors SET is_synced = 1 WHERE id = ?`, [
      cleanSensorId(id),
    ]);
  } catch (error) {
    console.error(error);
  }
};

export const countSensors = async (): Promise<number> => {
  try {
    const result = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM sensors"
    );
    return result?.count || 0;
  } catch {
    return 0;
  }
};
