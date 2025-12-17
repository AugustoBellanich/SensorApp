import { db } from './DatabaseInit';
import { SensorEntity } from './types';

// OBTENER TODOS
export const getAllSensors = async (): Promise<SensorEntity[]> => {
  try {
    return await db.getAllAsync<SensorEntity>('SELECT * FROM sensors');
  } catch (error) {
    console.error("Error obteniendo sensores:", error);
    return [];
  }
};

// OBTENER POR ID
export const getSensorById = async (id: string): Promise<SensorEntity | null> => {
  try {
    return await db.getFirstAsync<SensorEntity>('SELECT * FROM sensors WHERE id = ?', [id]);
  } catch (error) {
    return null;
  }
};

// INSERTAR O ACTUALIZAR (UPSERT)
// isFromCloud = true -> is_synced = 1 (Viene del servidor)
// isFromCloud = false -> is_synced = 0 (Edición local pendiente)
export const saveSensor = async (sensor: SensorEntity, isFromCloud: boolean = false) => {
  try {
    const now = new Date().toISOString();
    const syncStatus = isFromCloud ? 1 : 0; 

    // CORRECCIÓN CLAVE: 
    // Si bajamos datos de la nube (SyncService), 'sensor.updated_at' trae la fecha del servidor.
    // Debemos usar esa fecha, no 'now', para mantener coherencia.
    const validUpdatedAt = sensor.updated_at || now;

    await db.runAsync(
      `INSERT OR REPLACE INTO sensors (
          id, alias, type, location, activity, lat, lng, config_json, last_sync, 
          is_synced, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        sensor.id,
        sensor.alias,
        sensor.type,
        sensor.location,
        sensor.activity || '',
        sensor.lat || 0,
        sensor.lng || 0,
        sensor.config_json,
        sensor.last_sync || now, // Last sync siempre es 'now' si es bajada, o mantenemos el previo
        syncStatus, 
        validUpdatedAt // <--- Usamos la fecha correcta
      ]
    );
  } catch (error) {
    console.error(`Error guardando sensor ${sensor.id}:`, error);
  }
};

// ELIMINAR SENSOR (NUEVO - Requerido para SyncService)
export const deleteSensor = async (id: string): Promise<void> => {
    try {
        // Al borrar el sensor, el ON DELETE CASCADE de SQLite borrará sus lecturas
        await db.runAsync('DELETE FROM sensors WHERE id = ?', [id]);
        console.log(`🗑️ Sensor ${id} eliminado localmente.`);
    } catch (error) {
        console.error(`Error eliminando sensor ${id}:`, error);
    }
};

// OBTENER PENDIENTES
export const getSensorsPendingSync = async (): Promise<SensorEntity[]> => {
    return await db.getAllAsync<SensorEntity>(
        `SELECT * FROM sensors WHERE is_synced = 0`
    );
};

// MARCAR COMO SUBIDO
export const markSensorSynced = async (id: string) => {
    try {
        await db.runAsync(
            `UPDATE sensors SET is_synced = 1 WHERE id = ?`, 
            [id]
        );
    } catch (error) {
        console.error(`Error marcando synced ${id}:`, error);
    }
};

// CONTAR SENSORES
export const countSensors = async (): Promise<number> => {
    try {
        const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sensors');
        return result?.count || 0;
    } catch (_) {
        return 0;
    }
};