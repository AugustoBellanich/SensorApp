import * as SQLite from "expo-sqlite";

// Abrir la base de datos de forma síncrona (nueva API de Expo SDK 50+)
export const db = SQLite.openDatabaseSync("agrosense.db");

export const initDatabase = async () => {
  try {
    // 0. Configuración de integridad
    // SQLite requiere activar manualmente las Foreign Keys en cada conexión
    await db.execAsync("PRAGMA foreign_keys = ON;");

    // ---------------------------------------------------------
    // ZONA DE PELIGRO: Descomentar solo para REINICIAR la DB
    // ---------------------------------------------------------
    // await db.execAsync('DROP TABLE IF EXISTS readings_b01');
    // await db.execAsync('DROP TABLE IF EXISTS readings_c01');
    // await db.execAsync('DROP TABLE IF EXISTS sensors');
    // ---------------------------------------------------------

    // 1. Tabla de SENSORES
    // Estructura optimizada para "Offline-First"
    // - config_json: Guardamos el objeto complejo como texto
    // - is_synced: Bandera para saber qué subir a Supabase
    // - updated_at: Para saber qué descargar de Supabase (resolución de conflictos)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sensors (
        id TEXT PRIMARY KEY NOT NULL,
        alias TEXT,
        type TEXT NOT NULL,
        location TEXT,       -- Se mapea a 'name_farm' en la nube
        activity TEXT, 
        lat REAL,
        lng REAL,
        config_json TEXT,    -- Se mapea a JSONB en la nube
        last_sync TEXT,
        
        -- Columnas de Sincronización
        is_synced INTEGER DEFAULT 0, -- 0: Pendiente de subir, 1: Sincronizado
        updated_at TEXT,             -- ISO Date de la última edición
        deleted_at TEXT              -- Soft Delete (opcional)
      );
    `);

    // 2. Tabla de LECTURAS B01 (Suelo)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS readings_b01 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        soil_temp REAL,
        
        -- Electrodos (Raw + Calibrados)
        e1_mv REAL, e1_hv REAL, e1_hg REAL,
        e2_mv REAL, e2_hv REAL, e2_hg REAL,
        e3_mv REAL, e3_hv REAL, e3_hg REAL,
        
        battery_mv REAL,
        
        -- Sync
        is_synced INTEGER DEFAULT 0,
        
        FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE
      );
      
      -- Índices para búsqueda rápida y sincronización eficiente
      CREATE INDEX IF NOT EXISTS idx_b01_sensor_time ON readings_b01 (sensor_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_b01_synced ON readings_b01 (is_synced);
    `);

    // 3. Tabla de LECTURAS C01 (Clima)
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

        FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_c01_synced ON readings_c01 (is_synced);
    `);

    // En DatabaseInit.ts
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS device_electrodes (
        id TEXT PRIMARY KEY NOT NULL,    -- Formato: sensorId_index (ej: B01-001_1)
        sensor_id TEXT NOT NULL,
        electrode_index INTEGER NOT NULL, -- 1, 2, 3... N
        depth REAL,                      -- Profundidad de instalación
        texture TEXT,                    -- Tipo de suelo (Franco, Arcilloso...)
        density REAL,                    -- Densidad aparente (g/cm3)
        
        -- Calibración
        points_json TEXT,                -- Puntos PMP, CC, SAT (para edición)
        equations_json TEXT,             -- Segmentos m, b (para cálculo rápido)
        
        -- Sincronización
        is_synced INTEGER DEFAULT 0,
        updated_at TEXT,
        
        FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE
      );
      
      -- Índice único para evitar duplicados del mismo electrodo en el mismo sensor
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_elec_unique 
      ON device_electrodes (sensor_id, electrode_index);
    `);

    console.log("[DB] Inicialización completada. Sistema listo.");
  } catch (error) {
    console.error("[DB] ❌ Error fatal iniciando BD:", error);
  }
};
