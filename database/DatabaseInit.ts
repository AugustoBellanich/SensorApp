import * as SQLite from 'expo-sqlite';

// Abrir la base de datos de forma síncrona (nueva API de Expo SDK 50+)
export const db = SQLite.openDatabaseSync('agrosense.db');

export const initDatabase = async () => {
  try {
    // OPCIONAL: Descomenta esto si necesitas reiniciar la DB durante desarrollo
    // await db.execAsync('DROP TABLE IF EXISTS sensors');
    // await db.execAsync('DROP TABLE IF EXISTS readings_b01');
    // await db.execAsync('DROP TABLE IF EXISTS readings_c01');

    // 1. Tabla de SENSORES
    // Mapeo: 
    // local 'location' -> nube 'name_farm'
    // local 'config_json' -> nube 'config' (jsonb)
    // local 'is_synced', 'updated_at', 'deleted_at' -> Gestión offline
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
        last_sync TEXT,
        
        -- Columnas de Sincronización
        is_synced INTEGER DEFAULT 0, -- 0: No subido, 1: Subido
        updated_at TEXT,             -- Fecha de última modificación local
        deleted_at TEXT              -- Fecha de borrado (si aplica)
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
        
        -- Sync
        is_synced INTEGER DEFAULT 0,
        
        FOREIGN KEY (sensor_id) REFERENCES sensors (id)
      );
      CREATE INDEX IF NOT EXISTS idx_b01_sensor_time ON readings_b01 (sensor_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_b01_synced ON readings_b01 (is_synced);
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
        
        -- Sync
        is_synced INTEGER DEFAULT 0,

        FOREIGN KEY (sensor_id) REFERENCES sensors (id)
      );
      CREATE INDEX IF NOT EXISTS idx_c01_synced ON readings_c01 (is_synced);
    `);

    console.log("[DB] Tablas inicializadas con soporte Offline-First.");
  } catch (error) {
    console.error("[DB] Error fatal iniciando BD:", error);
  }
};