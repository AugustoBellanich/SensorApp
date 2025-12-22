import { db } from './DatabaseInit';
import { ReadingB01, ReadingC01 } from './types';

// =====================================================================
// HELPER: FECHA LOCAL (Para coincidir con lo guardado en SDDataScreen)
// =====================================================================
const toLocalISOString = (date: Date) => {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localTime = new Date(date.getTime() - tzOffset);
  return localTime.toISOString().slice(0, -1); // Formato: YYYY-MM-DDTHH:mm:ss.sss
};

// =====================================================================
// INSERCIONES (B01 y C01)
// =====================================================================

// --- B01 SUELO ---
export const insertReadingsB01 = async (readings: ReadingB01[]): Promise<number> => {
  if (readings.length === 0) return 0;
  
  let addedCount = 0;

  try {
    await db.withTransactionAsync(async () => {
      // --- LOG DE DEBUG PARA VER EL PRIMER DATO QUE LLEGA ---
      if (readings.length > 0) {
          const sample = readings[0];
          console.log("================== [DB DEBUG INSERT] ==================");
          console.log(`timestamp: ${sample.timestamp}`);
          console.log(`E1 -> mV: ${sample.e1_mv}, Hv: ${sample.e1_hv}, Hg: ${sample.e1_hg}`);
          console.log(`E2 -> mV: ${sample.e2_mv}, Hv: ${sample.e2_hv}, Hg: ${sample.e2_hg}`);
          console.log(`E3 -> mV: ${sample.e3_mv}, Hv: ${sample.e3_hv}, Hg: ${sample.e3_hg}`);
          console.log("=======================================================");
      }
      // ------------------------------------------------------

      for (const r of readings) {
        const exists = await db.getFirstAsync(
          'SELECT id FROM readings_b01 WHERE sensor_id = ? AND timestamp = ?', 
          [r.sensor_id, r.timestamp]
        );

        if (!exists) {
          await db.runAsync(
            `INSERT INTO readings_b01 (
                sensor_id, timestamp, soil_temp, 
                e1_mv, e1_hv, e1_hg, 
                e2_mv, e2_hv, e2_hg, 
                e3_mv, e3_hv, e3_hg, 
                battery_mv, is_synced
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.sensor_id, r.timestamp, r.soil_temp,
              // AQUÍ ESTÁ EL MAPEO CRÍTICO. REVISA QUE NO ESTÉ CRUZADO
              r.e1_mv, r.e1_hv || 0, r.e1_hg || 0,
              r.e2_mv, r.e2_hv || 0, r.e2_hg || 0,
              r.e3_mv, r.e3_hv || 0, r.e3_hg || 0,
              r.battery_mv, 
              1 
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

// --- C01 CLIMA ---
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
            [
                r.sensor_id, r.timestamp, r.air_temp, r.humidity, r.battery_mv, 
                1 
            ]
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

// =====================================================================
// CONSULTAS: ÚLTIMA LECTURA
// =====================================================================

export const getLastReadingB01 = async (sensorId: string): Promise<ReadingB01 | null> => {
  const result = await db.getFirstAsync(
    'SELECT * FROM readings_b01 WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1',
    [sensorId]
  );
  return result as ReadingB01 | null;
};

export const getLastReadingC01 = async (sensorId: string): Promise<ReadingC01 | null> => {
  const result = await db.getFirstAsync(
    'SELECT * FROM readings_c01 WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1',
    [sensorId]
  );
  return result as ReadingC01 | null;
};

// =====================================================================
// CONSULTAS: RANGO DE FECHAS (CRÍTICO PARA GRÁFICAS)
// =====================================================================
export const getReadingsInRange = async (
    sensorId: string, 
    type: 'B01' | 'C01', 
    start: Date, 
    end: Date
): Promise<any[]> => {
    try {
        const tableName = type === 'B01' ? 'readings_b01' : 'readings_c01';
        
        // CORRECCIÓN IMPORTANTE:
        // Usamos toLocalISOString para que coincida con el formato guardado en SDDataScreen
        const startStr = toLocalISOString(start);
        const endStr = toLocalISOString(end);

        console.log(`[DB QUERY] Buscando en ${tableName} | ID: ${sensorId}`);
        console.log(`[DB QUERY] Rango Local: ${startStr} a ${endStr}`);

        const results = await db.getAllAsync(
            `SELECT * FROM ${tableName} 
             WHERE sensor_id = ? 
             AND timestamp >= ? 
             AND timestamp <= ? 
             ORDER BY timestamp ASC`,
            [sensorId, startStr, endStr]
        );

        console.log(`[DB RESULT] Encontrados: ${results.length} registros`);
        return results;
    } catch (e) {
        console.error(`Error obteniendo rango para ${sensorId} (${type})`, e);
        return [];
    }
};

// =====================================================================
// HERRAMIENTA DE DEPURACIÓN (Útil si sigue saliendo "Sin Datos")
// =====================================================================
export const debugGetAllReadings = async (type: 'B01' | 'C01') => {
    const tableName = type === 'B01' ? 'readings_b01' : 'readings_c01';
    try {
        const count = await db.getFirstAsync(`SELECT COUNT(*) as total FROM ${tableName}`);
        // Muestra los primeros 5 para ver el formato exacto del timestamp
        const sample = await db.getAllAsync(`SELECT sensor_id, timestamp FROM ${tableName} LIMIT 5`);
        
        console.log(`[DEBUG DB] Total filas en ${tableName}:`, count);
        console.log(`[DEBUG DB] Muestra de formatos:`, JSON.stringify(sample, null, 2));
    } catch (e) {
        console.error("Error debug DB", e);
    }
};