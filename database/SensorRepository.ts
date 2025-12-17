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
  const now = new Date().toISOString();
  const syncStatus = isFromCloud ? 1 : 0; 

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
      sensor.last_sync || now,
      syncStatus, 
      now 
    ]
  );
};

// OBTENER PENDIENTES
export const getSensorsPendingSync = async (): Promise<SensorEntity[]> => {
    return await db.getAllAsync<SensorEntity>(
        `SELECT * FROM sensors WHERE is_synced = 0`
    );
};

// MARCAR COMO SUBIDO
export const markSensorSynced = async (id: string) => {
    await db.runAsync(
        `UPDATE sensors SET is_synced = 1 WHERE id = ?`, 
        [id]
    );
};