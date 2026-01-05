import { supabase } from '../lib/supabase';
import { db } from './DatabaseInit';
import { SensorEntity } from './types';

// =====================================================================
// HELPER: LIMPIEZA DE ID
// =====================================================================
// Quitamos "SEN-", espacios y forzamos MAYÚSCULAS para consistencia (b01 = B01)
const cleanSensorId = (id: string) => id.replace(/^SEN-/i, "").trim().toUpperCase();

// =====================================================================
// 1. VINCULACIÓN INTELIGENTE (CLAIM / LINK)
// =====================================================================
export const linkNewSensor = async (sensor: SensorEntity): Promise<{ 
    success: boolean; 
    status: 'OWNER' | 'EDITOR_CONFIRMED' | 'LOCAL_ONLY' | 'OFFLINE'; 
    message: string 
}> => {
  const cleanId = cleanSensorId(sensor.id);
  const now = new Date().toISOString();

  try {
    // A. GUARDADO LOCAL (Prioridad Offline)
    // Guardamos primero en SQLite para asegurar que el usuario vea el sensor
    await db.runAsync(
      `INSERT OR IGNORE INTO sensors (
          id, alias, type, location, activity, lat, lng, config_json, last_sync, is_synced, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        cleanId, sensor.alias, sensor.type, sensor.location, sensor.activity || '',
        sensor.lat || 0, sensor.lng || 0, sensor.config_json, now, now
      ]
    );

    // B. CHECK NUBE (Usuario autenticado)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: true, status: 'OFFLINE', message: "Guardado local. Inicia sesión para vincular completamente." };
    }

    // C. ¿YA TENGO PERMISO? (Recuperación)
    // Verificamos si ya existe una relación en la nube (ej: ya eras dueño o te invitaron)
    const { data: existingPerm } = await supabase
        .from('sensor_permissions')
        .select('role')
        .eq('device_id', cleanId)
        .eq('user_id', user.id)
        .maybeSingle(); // "maybeSingle" evita errores si no existe fila

    if (existingPerm) {
        // --- CASO 1: YA ERES COLABORADOR/DUEÑO ---
        // Actualizamos localmente para habilitar la subida de datos
        await db.runAsync('UPDATE sensors SET is_synced = 1 WHERE id = ?', [cleanId]);
        
        // Guardamos el rol en la config local
        const config = { role: existingPerm.role };
        await db.runAsync('UPDATE sensors SET config_json = ? WHERE id = ?', [JSON.stringify(config), cleanId]);

        return { 
            success: true, 
            status: 'EDITOR_CONFIRMED', 
            message: `Sensor recuperado. Tu rol es: ${existingPerm.role}.` 
        };
    }

    // D. INTENTO DE CONQUISTA (CLAIM OWNER)
    // --- CASO 2: SENSOR NUEVO O HUÉRFANO ---
    const { error } = await supabase
      .from('sensor_permissions')
      .insert({
        user_id: user.id,
        device_id: cleanId,
        role: 'owner', // Intentamos registrarnos como DUEÑO
        // alias: sensor.alias // (Opcional si tu tabla permisos tiene columna alias)
      });

    if (error) {
      console.log("⚠️ No se pudo reclamar propiedad:", error.code, error.message);
      
      // Códigos de error comunes:
      // 23505: Violación de unicidad (Ya existe)
      // 42501: RLS (Políticas de seguridad impiden insertar porque alguien más es dueño)
      
      return { 
          success: true, 
          status: 'LOCAL_ONLY', 
          message: "El sensor ya pertenece a otro usuario. Se guardó en modo local." 
      };
    }

    // E. ÉXITO: SOY EL NUEVO OWNER
    await db.runAsync('UPDATE sensors SET is_synced = 1 WHERE id = ?', [cleanId]);
    
    // Guardamos rol local
    const ownerConfig = { role: 'owner' };
    await db.runAsync('UPDATE sensors SET config_json = ? WHERE id = ?', [JSON.stringify(ownerConfig), cleanId]);

    // Aseguramos que el dispositivo exista en la tabla maestra 'devices'
    await supabase.from('devices').upsert({ 
        id: cleanId, 
        type: sensor.type,
        alias: sensor.alias, 
        last_sync: now 
    });

    return { 
        success: true, 
        status: 'OWNER', 
        message: "¡Sensor vinculado! Eres el propietario." 
    };

  } catch (e: any) {
    console.error("Error linkNewSensor:", e);
    return { success: false, status: 'OFFLINE', message: "Error interno: " + e.message };
  }
};

// =====================================================================
// 2. DESVINCULAR (UNLINK) - LÓGICA DE LIMPIEZA
// =====================================================================
export const unlinkSensor = async (sensorId: string): Promise<{ success: boolean; error?: string }> => {
  const cleanId = cleanSensorId(sensorId);

  try {
    console.log(`[UNLINK] Iniciando desvinculación para: ${cleanId}`);

    // 1. BORRAR DE LA NUBE (Solo el permiso)
    // Esto NO borra el sensor ni las lecturas históricas de la nube.
    // Solo borra la fila en 'sensor_permissions' que dice que TÚ eres el dueño/viewer.
    // Al borrar esto, si eras el dueño, el sensor queda "libre" para el siguiente.
    
    const { error: cloudError, count } = await supabase
      .from('sensor_permissions')
      .delete({ count: 'exact' }) // Solicitamos confirmación de cuántas filas se borraron
      .eq('device_id', cleanId);
      // Nota: RLS añade automáticamente "AND user_id = tu_uid"

    if (cloudError) {
        console.warn("⚠️ Error desvinculando de nube (posiblemente offline):", cloudError.message);
        // Continuamos para no impedir borrarlo del teléfono
    } else {
        if (count && count > 0) {
            console.log("☁️ Permiso eliminado en la nube. Sensor liberado.");
        } else {
            console.log("☁️ No se encontró permiso en nube para borrar (o ya estaba borrado).");
        }
    }

    // 2. BORRAR LOCALMENTE (Limpieza completa del teléfono)
    // SQLite: Borramos todo rastro del sensor en ESTE dispositivo.
    await db.runAsync('DELETE FROM readings_b01 WHERE sensor_id = ?', [cleanId]);
    await db.runAsync('DELETE FROM readings_c01 WHERE sensor_id = ?', [cleanId]);
    await db.runAsync('DELETE FROM device_electrodes WHERE sensor_id = ?', [cleanId]);
    await db.runAsync('DELETE FROM sensors WHERE id = ?', [cleanId]);

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
export const inviteCollaborator = async (sensorId: string, email: string, role: 'editor' | 'viewer') => {
    const cleanId = cleanSensorId(sensorId);
    
    const { error } = await supabase.rpc('add_collaborator', {
        target_email: email,
        target_device_id: cleanId,
        target_role: role
    });

    if (error) throw error;
    return true;
};

// =====================================================================
// 4. FUNCIONES CRUD ESTÁNDAR
// =====================================================================

export const getAllSensors = async (): Promise<SensorEntity[]> => {
  try {
    return await db.getAllAsync<SensorEntity>('SELECT * FROM sensors');
  } catch {
    return [];
  }
};

export const getSensorById = async (id: string): Promise<SensorEntity | null> => {
  try {
    return await db.getFirstAsync<SensorEntity>('SELECT * FROM sensors WHERE id = ?', [cleanSensorId(id)]);
  } catch {
    return null;
  }
};

// Función interna para actualizaciones (ej: rename local)
// Ya no se usa para crear sensores nuevos (para eso está linkNewSensor)
export const updateSensorLocal = async (sensor: SensorEntity) => {
    const cleanId = cleanSensorId(sensor.id);
    const now = new Date().toISOString();
    try {
        await db.runAsync(
            `UPDATE sensors SET alias = ?, location = ?, config_json = ?, updated_at = ? WHERE id = ?`,
            [sensor.alias, sensor.location, sensor.config_json, now, cleanId]
        );
    } catch (e) { console.error(e); }
};

// Mantenemos saveSensor por compatibilidad si alguna otra parte lo usa,
// pero internamente lo dirigimos a lógica segura
export const saveSensor = async (sensor: SensorEntity, isFromCloud: boolean = false) => {
    // Es preferible usar linkNewSensor para nuevos, esto es solo fallback para updates
    const cleanId = cleanSensorId(sensor.id);
    const now = new Date().toISOString();
    const syncStatus = isFromCloud ? 1 : 0; 

    try {
        // Solo Update
         await db.runAsync(
            `UPDATE sensors SET
                alias = ?, type = ?, location = ?, activity = ?, lat = ?, lng = ?,
                config_json = ?, last_sync = ?, is_synced = ?, updated_at = ?
             WHERE id = ?`,
            [
              sensor.alias, sensor.type, sensor.location, sensor.activity || '',
              sensor.lat || 0, sensor.lng || 0, sensor.config_json, sensor.last_sync || now,
              syncStatus, sensor.updated_at || now, cleanId
            ]
          );
          
          // Si no existía (filas afectadas = 0), intentamos insertar
          // pero idealmente debería venir de linkNewSensor
          const check = await db.getFirstAsync('SELECT id FROM sensors WHERE id = ?', [cleanId]);
          if (!check) {
              await db.runAsync(
                `INSERT INTO sensors (
                    id, alias, type, location, activity, lat, lng, config_json, last_sync, is_synced, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  cleanId, sensor.alias, sensor.type, sensor.location, sensor.activity || '',
                  sensor.lat || 0, sensor.lng || 0, sensor.config_json, now, syncStatus, now
                ]
              );
          }

    } catch (e) { console.error(e); }
};

export const getSensorsPendingSync = async (): Promise<SensorEntity[]> => {
    return await db.getAllAsync<SensorEntity>(`SELECT * FROM sensors WHERE is_synced = 0`);
};

export const markSensorSynced = async (id: string) => {
    try {
        await db.runAsync(`UPDATE sensors SET is_synced = 1 WHERE id = ?`, [cleanSensorId(id)]);
    } catch (error) { console.error(error); }
};

export const countSensors = async (): Promise<number> => {
    try {
        const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sensors');
        return result?.count || 0;
    } catch { return 0; }
};