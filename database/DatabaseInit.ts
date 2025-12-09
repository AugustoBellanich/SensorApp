import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('agrosense.db');

export const initDatabase = async () => {
  try {
    // 1. Tabla de SENSORES
    // Agregamos 'activity'
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sensors (
        id TEXT PRIMARY KEY NOT NULL,
        alias TEXT,
        type TEXT NOT NULL,
        location TEXT,
        activity TEXT, 
        lat REAL,
        lng REAL,
        config_json TEXT, 
        last_sync TEXT
      );
    `);

    // 2. Tabla de LECTURAS B01
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS readings_b01 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        soil_temp REAL,
        e1_mv REAL, e1_hv REAL, e1_hg REAL,
        e2_mv REAL, e2_hv REAL, e2_hg REAL,
        e3_mv REAL, e3_hv REAL, e3_hg REAL,
        battery_mv REAL,
        FOREIGN KEY (sensor_id) REFERENCES sensors (id)
      );
      CREATE INDEX IF NOT EXISTS idx_b01_sensor_time ON readings_b01 (sensor_id, timestamp);
    `);

    // 3. Tabla de LECTURAS C01
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS readings_c01 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        air_temp REAL,
        humidity REAL,
        battery_mv REAL,
        FOREIGN KEY (sensor_id) REFERENCES sensors (id)
      );
    `);

    console.log("[DB] Tablas sincronizadas correctamente.");
  } catch (error) {
    console.error("[DB] Error fatal iniciando BD:", error);
  }
};