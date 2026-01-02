import { db } from './DatabaseInit';
import { ReadingB01, ReadingC01 } from './types';

// =====================================================================
// INSERCIONES OPTIMIZADAS (UPSERT BATCH)
// =====================================================================

// --- B01 SUELO ---
export const insertReadingsB01 = async (readings: ReadingB01[]): Promise<number> => {
  if (readings.length === 0) return 0;
  
  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        // CORRECCIÓN CLAVE: Respetamos el estado de sincronización que trae el dato
        // Si viene de SD será 0. Si viene de Nube será 1.
        const syncStatus = (r.is_synced !== undefined) ? r.is_synced : 0;

        await db.runAsync(
          `INSERT OR REPLACE INTO readings_b01 (
              sensor_id, timestamp, soil_temp, 
              e1_mv, e1_hv, e1_hg, 
              e2_mv, e2_hv, e2_hg, 
              e3_mv, e3_hv, e3_hg, 
              battery_mv, is_synced, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.sensor_id.trim(), // <--- BLINDAJE: Quitamos espacios
            r.timestamp, r.soil_temp,
            r.e1_mv, r.e1_hv || 0, r.e1_hg || 0,
            r.e2_mv, r.e2_hv || 0, r.e2_hg || 0,
            r.e3_mv, r.e3_hv || 0, r.e3_hg || 0,
            r.battery_mv, 
            syncStatus, // <--- CAMBIO IMPORTANTE: NO SIEMPRE 1
            new Date().toISOString()
          ]
        );
      }
    });
    console.log(`[DB] B01: Insertados/Actualizados ${readings.length} registros.`);
    return readings.length;
  } catch (e) {
    console.error("❌ Error CRÍTICO insertando batch B01:", e);
    throw e;
  }
};

// --- C01 CLIMA ---
export const insertReadingsC01 = async (readings: ReadingC01[]): Promise<number> => {
  if (readings.length === 0) return 0;

  try {
    await db.withTransactionAsync(async () => {
      for (const r of readings) {
        const syncStatus = (r.is_synced !== undefined) ? r.is_synced : 0;

        await db.runAsync(
          `INSERT OR REPLACE INTO readings_c01 (
              sensor_id, timestamp, air_temp, humidity, battery_mv, is_synced, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            r.sensor_id.trim(), // <--- BLINDAJE
            r.timestamp, r.air_temp, r.humidity, r.battery_mv, 
            syncStatus, new Date().toISOString()
          ]
        );
      }
    });
    console.log(`[DB] C01: Insertados/Actualizados ${readings.length} registros.`);
    return readings.length;
  } catch (e) {
    console.error("❌ Error CRÍTICO insertando batch C01:", e);
    throw e;
  }
};

// =====================================================================
// HELPER: Borrar Rango
// =====================================================================
export const deleteReadingsRange = async (sensorId: string, type: string, start: Date, end: Date) => {
  // BLINDAJE: Normalizamos el tipo (da igual si mandas 'b01' o 'B01')
  const safeType = type.toUpperCase().trim();
  const table = safeType === 'B01' ? 'readings_b01' : 'readings_c01';
  
  const s = start.toISOString();
  const e = end.toISOString();
  
  console.log(`[DB DELETE] Borrando ${table} para ${sensorId} (${s} -> ${e})`);

  const result = await db.runAsync(
    `DELETE FROM ${table} WHERE sensor_id = ? AND timestamp >= ? AND timestamp <= ?`,
    [sensorId.trim(), s, e]
  );
  return result.changes;
};

// =====================================================================
// CONSULTAS DE LECTURA (Blindadas y con Logs)
// =====================================================================

export const getReadingsInRange = async (sensorId: string, type: string, start: Date, end: Date): Promise<any[]> => {
    try {
        // BLINDAJE TOTAL DE TIPO Y ID
        const safeType = type.toUpperCase().trim();
        const safeId = sensorId.trim();
        const tableName = safeType === 'B01' ? 'readings_b01' : 'readings_c01';
        
        const startStr = start.toISOString();
        const endStr = end.toISOString();

        // LOG CHIVATO INTERNO
        console.log(`[DB QUERY] Tabla: ${tableName} | ID: '${safeId}' | Rango: ${startStr} a ${endStr}`);

        // Usamos una consulta simple pero efectiva
        const results = await db.getAllAsync(
            `SELECT * FROM ${tableName} 
             WHERE sensor_id = ? AND timestamp >= ? AND timestamp <= ? 
             ORDER BY timestamp ASC`,
            [safeId, startStr, endStr]
        );
        
        console.log(`[DB RESULT] Encontrados: ${results.length}`);
        return results;

    } catch (e) {
        console.error(`❌ Error query rango ${sensorId}:`, e);
        return [];
    }
};

export const getLastReadingB01 = async (sensorId: string): Promise<ReadingB01 | null> => {
  const result = await db.getFirstAsync('SELECT * FROM readings_b01 WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1', [sensorId.trim()]);
  return result as ReadingB01 | null;
};

export const getLastReadingC01 = async (sensorId: string): Promise<ReadingC01 | null> => {
  const result = await db.getFirstAsync('SELECT * FROM readings_c01 WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1', [sensorId.trim()]);
  return result as ReadingC01 | null;
};