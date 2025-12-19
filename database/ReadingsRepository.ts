import { db } from './DatabaseInit';
import { ReadingB01, ReadingC01 } from './types';

// --- B01 SUELO (Inserción Inteligente) ---
export const insertReadingsB01 = async (readings: ReadingB01[]): Promise<number> => {
  if (readings.length === 0) return 0;
  
  let addedCount = 0;

  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        // 1. VERIFICAR EXISTENCIA: Buscamos si ya existe este sensor + fecha
        const exists = await db.getFirstAsync(
          'SELECT id FROM readings_b01 WHERE sensor_id = ? AND timestamp = ?', 
          [r.sensor_id, r.timestamp]
        );

        // 2. SOLO INSERTAR SI NO EXISTE
        if (!exists) {
          await db.runAsync(
            `INSERT INTO readings_b01 (sensor_id, timestamp, soil_temp, e1_mv, e1_hv, e1_hg, e2_mv, e2_hv, e2_hg, e3_mv, e3_hv, e3_hg, battery_mv, is_synced, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.sensor_id, r.timestamp, r.soil_temp,
              r.e1_mv, r.e1_hv || 0, r.e1_hg || 0,
              r.e2_mv, r.e2_hv || 0, r.e2_hg || 0,
              r.e3_mv, r.e3_hv || 0, r.e3_hg || 0,
              r.battery_mv, 0, new Date().toISOString()
            ]
          );
          addedCount++;
        }
      }
    });
    console.log(`[DB] B01: Procesados ${readings.length}, Nuevos agregados: ${addedCount}`);
    return addedCount;
  } catch (e) {
    console.error("Error insertando batch B01", e);
    throw e;
  }
};

// --- C01 CLIMA (Inserción Inteligente) ---
export const insertReadingsC01 = async (readings: ReadingC01[]): Promise<number> => {
  if (readings.length === 0) return 0;

  let addedCount = 0;

  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        const exists = await db.getFirstAsync(
          'SELECT id FROM readings_c01 WHERE sensor_id = ? AND timestamp = ?',
          [r.sensor_id, r.timestamp]
        );

        if (!exists) {
          await db.runAsync(
            `INSERT INTO readings_c01 (sensor_id, timestamp, air_temp, humidity, battery_mv, is_synced)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [r.sensor_id, r.timestamp, r.air_temp, r.humidity, r.battery_mv, 0]
          );
          addedCount++;
        }
      }
    });
    console.log(`[DB] C01: Procesados ${readings.length}, Nuevos agregados: ${addedCount}`);
    return addedCount;
  } catch (e) {
    console.error("Error insertando batch C01", e);
    throw e;
  }
};