import { db } from './DatabaseInit';
import { ReadingB01, ReadingC01 } from './types';

// --- B01 SUELO ---

// INSERTAR UN LOTE DE DATOS B01 (Muy optimizado para sincronización)
export const insertReadingsB01 = async (readings: ReadingB01[]) => {
  if (readings.length === 0) return;
  
  try {
    // Construimos una query gigante o usamos una transacción
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        await db.runAsync(
          `INSERT INTO readings_b01 (sensor_id, timestamp, soil_temp, e1_mv, e1_hv, e1_hg, e2_mv, e2_hv, e2_hg, e3_mv, e3_hv, e3_hg, battery_mv)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.sensor_id, r.timestamp, r.soil_temp,
            r.e1_mv, r.e1_hv, r.e1_hg,
            r.e2_mv, r.e2_hv, r.e2_hg,
            r.e3_mv, r.e3_hv, r.e3_hg,
            r.battery_mv
          ]
        );
      }
    });
    console.log(`[DB] Insertadas ${readings.length} lecturas B01`);
  } catch (e) {
    console.error("Error insertando batch B01", e);
  }
};

// OBTENER HISTORIAL B01 (Para Gráficos)
// timeRange podría ser: '12h', '7D', etc. Aquí lo manejamos con fechas string
export const getReadingsB01 = async (sensorId: string, startDate: string): Promise<ReadingB01[]> => {
  try {
    const result = await db.getAllAsync<ReadingB01>(
      `SELECT * FROM readings_b01 WHERE sensor_id = ? AND timestamp >= ? ORDER BY timestamp ASC`,
      [sensorId, startDate]
    );
    return result;
  } catch (e) {
    return [];
  }
};


// --- C01 CLIMA ---

export const insertReadingsC01 = async (readings: ReadingC01[]) => {
  if (readings.length === 0) return;

  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        await db.runAsync(
          `INSERT INTO readings_c01 (sensor_id, timestamp, air_temp, humidity, battery_mv)
           VALUES (?, ?, ?, ?, ?)`,
          [r.sensor_id, r.timestamp, r.air_temp, r.humidity, r.battery_mv]
        );
      }
    });
    console.log(`[DB] Insertadas ${readings.length} lecturas C01`);
  } catch (e) {
    console.error("Error insertando batch C01", e);
  }
};

export const getReadingsC01 = async (sensorId: string, startDate: string): Promise<ReadingC01[]> => {
  try {
    const result = await db.getAllAsync<ReadingC01>(
      `SELECT * FROM readings_c01 WHERE sensor_id = ? AND timestamp >= ? ORDER BY timestamp ASC`,
      [sensorId, startDate]
    );
    return result;
  } catch (e) {
    return [];
  }
};