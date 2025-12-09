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
  // Ahora TypeScript no se quejará porque existen en la interfaz
  const { id, alias, type, location, activity, lat, lng, config_json, last_sync } = sensor;
  
  try {
    // IMPORTANTE: Asegúrate que la query coincida con los parámetros
    await db.runAsync(
      `INSERT OR REPLACE INTO sensors (id, alias, type, location, activity, lat, lng, config_json, last_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id, 
        alias, 
        type, 
        location, 
        activity || null, // Si es undefined, guardamos null
        lat || null, 
        lng || null, 
        config_json, 
        last_sync || null
      ]
    );
    console.log(`[DB] Sensor guardado: ${id}`);
  } catch (error) { // Solución al warning de ESLint: usar la variable
    console.error("Error guardando sensor:", error);
  }
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