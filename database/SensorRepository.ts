import { db } from './DatabaseInit';
import { SensorEntity } from './types';

// =====================================================================
// OBTENER TODOS LOS SENSORES
// =====================================================================
export const getAllSensors = async (): Promise<SensorEntity[]> => {
  try {
    return await db.getAllAsync<SensorEntity>('SELECT * FROM sensors');
  } catch (error) {
    console.error("Error obteniendo sensores:", error);
    return [];
  }
};

// =====================================================================
// OBTENER SENSOR POR ID
// =====================================================================
export const getSensorById = async (id: string): Promise<SensorEntity | null> => {
  try {
    // Usamos trim() para asegurar que buscamos el ID limpio
    return await db.getFirstAsync<SensorEntity>('SELECT * FROM sensors WHERE id = ?', [id.trim()]);
  } catch (error) {
    return null;
  }
};

// =====================================================================
// GUARDAR SENSOR (UPSERT SEGURO)
// =====================================================================
// Esta función es crítica. Reemplaza el uso de INSERT OR REPLACE
// para evitar que se borren las lecturas en cascada.
export const saveSensor = async (sensor: SensorEntity, isFromCloud: boolean = false) => {
  try {
    const now = new Date().toISOString();
    const syncStatus = isFromCloud ? 1 : 0; 
    const validUpdatedAt = sensor.updated_at || now;
    
    // Limpieza fundamental del ID
    const cleanId = sensor.id.trim();

    // 1. Intentamos INSERTAR (si no existe)
    // Usamos INSERT OR IGNORE: Si el ID ya existe, SQLite ignora esta línea y no hace nada.
    // Esto evita borrar la fila y mantiene vivas las relaciones (lecturas).
    await db.runAsync(
      `INSERT OR IGNORE INTO sensors (
          id, alias, type, location, activity, lat, lng, config_json, last_sync, 
          is_synced, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanId,
        sensor.alias,
        sensor.type,
        sensor.location,
        sensor.activity || '',
        sensor.lat || 0,
        sensor.lng || 0,
        sensor.config_json,
        sensor.last_sync || now,
        syncStatus, 
        validUpdatedAt
      ]
    );

    // 2. Ejecutamos UPDATE para actualizar los datos (si ya existía o se acaba de crear)
    // Esto asegura que si bajamos cambios de la nube (ej: cambio de alias), se reflejen.
    await db.runAsync(
      `UPDATE sensors SET
          alias = ?,
          type = ?,
          location = ?,
          activity = ?,
          lat = ?,
          lng = ?,
          config_json = ?,
          last_sync = ?,
          is_synced = ?,
          updated_at = ?
       WHERE id = ?`,
      [
        sensor.alias,
        sensor.type,
        sensor.location,
        sensor.activity || '',
        sensor.lat || 0,
        sensor.lng || 0,
        sensor.config_json,
        sensor.last_sync || now,
        syncStatus, 
        validUpdatedAt,
        cleanId // WHERE id = cleanId
      ]
    );
    
    console.log(`✅ [DB] Sensor ${cleanId} guardado de forma segura (Lecturas preservadas).`);

  } catch (error) {
    console.error(`Error guardando sensor ${sensor.id}:`, error);
  }
};

// =====================================================================
// ELIMINAR SENSOR
// =====================================================================
export const deleteSensor = async (id: string): Promise<void> => {
    try {
        await db.runAsync('DELETE FROM sensors WHERE id = ?', [id.trim()]);
        console.log(`🗑️ Sensor ${id} eliminado localmente.`);
    } catch (error) {
        console.error(`Error eliminando sensor ${id}:`, error);
    }
};

// =====================================================================
// OBTENER PENDIENTES DE SUBIDA
// =====================================================================
export const getSensorsPendingSync = async (): Promise<SensorEntity[]> => {
    return await db.getAllAsync<SensorEntity>(
        `SELECT * FROM sensors WHERE is_synced = 0`
    );
};

// =====================================================================
// MARCAR COMO SINCRONIZADO
// =====================================================================
export const markSensorSynced = async (id: string) => {
    try {
        await db.runAsync(
            `UPDATE sensors SET is_synced = 1 WHERE id = ?`, 
            [id.trim()]
        );
    } catch (error) {
        console.error(`Error marcando synced ${id}:`, error);
    }
};

// =====================================================================
// ACTUALIZAR SENSOR (Wrapper)
// =====================================================================
export const updateSensor = async (sensor: SensorEntity) => {
    // Reutilizamos saveSensor porque ya maneja la lógica segura de UPDATE
    return saveSensor(sensor, false);
};

// =====================================================================
// CONTAR SENSORES
// =====================================================================
export const countSensors = async (): Promise<number> => {
    try {
        const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sensors');
        return result?.count || 0;
    } catch (_) {
        return 0;
    }
};