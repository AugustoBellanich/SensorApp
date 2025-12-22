import { db } from './DatabaseInit';
import { ReadingB01, ReadingC01 } from './types';

// =====================================================================
// INSERCIONES INTELIGENTES (Update if Exists)
// =====================================================================

// --- B01 SUELO ---
export const insertReadingsB01 = async (readings: ReadingB01[]): Promise<number> => {
  if (readings.length === 0) return 0;
  
  let processedCount = 0;

  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        // 1. Verificar si existe
        const existingRecord = await db.getFirstAsync<{ id: number }>(
          'SELECT id FROM readings_b01 WHERE sensor_id = ? AND timestamp = ?', 
          [r.sensor_id, r.timestamp]
        );

        if (existingRecord) {
          // 2A. SI EXISTE -> ACTUALIZAMOS (Sobrescribir basura vieja)
          await db.runAsync(
            `UPDATE readings_b01 SET 
                soil_temp = ?, 
                e1_mv = ?, e1_hv = ?, e1_hg = ?,
                e2_mv = ?, e2_hv = ?, e2_hg = ?,
                e3_mv = ?, e3_hv = ?, e3_hg = ?,
                battery_mv = ?, is_synced = ?, updated_at = ?
             WHERE id = ?`,
            [
              r.soil_temp,
              r.e1_mv, r.e1_hv || 0, r.e1_hg || 0,
              r.e2_mv, r.e2_hv || 0, r.e2_hg || 0,
              r.e3_mv, r.e3_hv || 0, r.e3_hg || 0,
              r.battery_mv, 
              1, // is_synced
              new Date().toISOString(), // updated_at
              existingRecord.id // WHERE id
            ]
          );
        } else {
          // 2B. NO EXISTE -> INSERTAMOS
          await db.runAsync(
            `INSERT INTO readings_b01 (
                sensor_id, timestamp, soil_temp, 
                e1_mv, e1_hv, e1_hg, 
                e2_mv, e2_hv, e2_hg, 
                e3_mv, e3_hv, e3_hg, 
                battery_mv, is_synced, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.sensor_id, r.timestamp, r.soil_temp,
              r.e1_mv, r.e1_hv || 0, r.e1_hg || 0,
              r.e2_mv, r.e2_hv || 0, r.e2_hg || 0,
              r.e3_mv, r.e3_hv || 0, r.e3_hg || 0,
              r.battery_mv, 
              1, 
              new Date().toISOString()
            ]
          );
        }
        processedCount++;
      }
    });
    console.log(`[DB] B01: Procesados/Actualizados ${processedCount} registros.`);
    return processedCount;
  } catch (e) {
    console.error("Error insertando/actualizando batch B01", e);
    throw e;
  }
};

// --- C01 CLIMA ---
export const insertReadingsC01 = async (readings: ReadingC01[]): Promise<number> => {
  if (readings.length === 0) return 0;

  let processedCount = 0;

  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        const existingRecord = await db.getFirstAsync<{ id: number }>(
          'SELECT id FROM readings_c01 WHERE sensor_id = ? AND timestamp = ?',
          [r.sensor_id, r.timestamp]
        );

        if (existingRecord) {
           // ACTUALIZAR
           await db.runAsync(
            `UPDATE readings_c01 SET 
                air_temp = ?, humidity = ?, battery_mv = ?, 
                is_synced = ?, updated_at = ?
             WHERE id = ?`,
            [
                r.air_temp, r.humidity, r.battery_mv, 
                1, new Date().toISOString(), 
                existingRecord.id
            ]
           );
        } else {
           // INSERTAR
           await db.runAsync(
            `INSERT INTO readings_c01 (
                sensor_id, timestamp, air_temp, humidity, battery_mv, is_synced, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                r.sensor_id, r.timestamp, r.air_temp, r.humidity, r.battery_mv, 
                1, new Date().toISOString()
            ]
          );
        }
        processedCount++;
      }
    });
    console.log(`[DB] C01: Procesados/Actualizados ${processedCount} registros.`);
    return processedCount;
  } catch (e) {
    console.error("Error insertando/actualizando batch C01", e);
    throw e;
  }
};

// =====================================================================
// HELPER: Borrar Rango (Para el botón de basura)
// =====================================================================
export const deleteReadingsRange = async (sensorId: string, type: 'B01' | 'C01', start: Date, end: Date) => {
  const table = type === 'B01' ? 'readings_b01' : 'readings_c01';
  // IMPORTANTE: Convertir fechas al formato exacto que usas en el INSERT (ISO Local cortado)
  // Si usas toLocalISOString en el insert, úsalo aquí también. Si usas ISO estándar, usa ISO estándar.
  // Para asegurar consistencia, usamos strings simples de ISO si tu DB los guarda así.
  
  // Helper local rápido para coincidir con tu formato de guardado
  const toLocalLike = (d: Date) => {
      const tzOffset = d.getTimezoneOffset() * 60000;
      const local = new Date(d.getTime() - tzOffset);
      return local.toISOString().slice(0, -1);
  };

  const s = toLocalLike(start); 
  const e = toLocalLike(end);
  
  console.log(`[DB DELETE] Borrando ${table} desde ${s} hasta ${e}`);

  const result = await db.runAsync(
    `DELETE FROM ${table} WHERE sensor_id = ? AND timestamp >= ? AND timestamp <= ?`,
    [sensorId, s, e]
  );
  return result.changes;
};

// =====================================================================
// CONSULTAS DE LECTURA (Sin cambios, solo para referencia)
// =====================================================================

// Helper de formato fecha para consultas
const toLocalISOStringQuery = (date: Date) => {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localTime = new Date(date.getTime() - tzOffset);
  return localTime.toISOString().slice(0, -1);
};

export const getReadingsInRange = async (sensorId: string, type: 'B01' | 'C01', start: Date, end: Date): Promise<any[]> => {
    try {
        const tableName = type === 'B01' ? 'readings_b01' : 'readings_c01';
        const startStr = toLocalISOStringQuery(start);
        const endStr = toLocalISOStringQuery(end);

        return await db.getAllAsync(
            `SELECT * FROM ${tableName} 
             WHERE sensor_id = ? AND timestamp >= ? AND timestamp <= ? 
             ORDER BY timestamp ASC`,
            [sensorId, startStr, endStr]
        );
    } catch (e) {
        console.error(`Error query rango ${sensorId}`, e);
        return [];
    }
};

export const getLastReadingB01 = async (sensorId: string): Promise<ReadingB01 | null> => {
  const result = await db.getFirstAsync('SELECT * FROM readings_b01 WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1', [sensorId]);
  return result as ReadingB01 | null;
};

export const getLastReadingC01 = async (sensorId: string): Promise<ReadingC01 | null> => {
  const result = await db.getFirstAsync('SELECT * FROM readings_c01 WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1', [sensorId]);
  return result as ReadingC01 | null;
};