import { db } from './DatabaseInit';
import { SensorEntity } from './types';

// OBTENER TODOS LOS SENSORES
export const getAllSensors = async (): Promise<SensorEntity[]> => {
  try {
    const result = await db.getAllAsync<SensorEntity>('SELECT * FROM sensors');
    return result;
  } catch (error) { // Cambiamos 'e' por 'error' y lo usamos
    console.error("Error obteniendo sensores:", error);
    return [];
  }
};

// OBTENER UN SENSOR POR ID
export const getSensorById = async (id: string): Promise<SensorEntity | null> => {
  try {
    const result = await db.getFirstAsync<SensorEntity>('SELECT * FROM sensors WHERE id = ?', [id]);
    return result;
  } catch (error) {
    console.warn("Sensor no encontrado o error:", error);
    return null;
  }
};

// INSERTAR O ACTUALIZAR SENSOR (Upsert)
export const saveSensor = async (sensor: SensorEntity) => {
  const now = new Date().toISOString();
  
  // Forzamos is_synced = 0 porque acabamos de modificarlo localmente 
  // y necesita subir a la nube.
  await db.runAsync(
    `INSERT OR REPLACE INTO sensors (
        id, alias, type, location, activity, lat, lng, config_json, last_sync, 
        is_synced, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
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
      now // updated_at
    ]
  );
};

// ACTUALIZAR SOLO LA CONFIGURACIÓN
export const updateSensorConfig = async (id: string, configJson: string) => {
  try {
    await db.runAsync('UPDATE sensors SET config_json = ? WHERE id = ?', [configJson, id]);
    console.log(`[DB] Configuración actualizada para ${id}`);
  } catch (error) {
    console.error("Error actualizando config:", error);
  }
};

export const getSensorsPendingSync = async (): Promise<SensorEntity[]> => {
    return await db.getAllAsync<SensorEntity>(
        `SELECT * FROM sensors WHERE is_synced = 0`
    );
};

export const markSensorSynced = async (id: string) => {
    await db.runAsync(
        `UPDATE sensors SET is_synced = 1 WHERE id = ?`, 
        [id]
    );
};