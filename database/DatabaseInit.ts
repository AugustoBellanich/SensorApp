import * as SQLite from "expo-sqlite";

// Abrir la base de datos de forma síncrona
// AL CAMBIAR EL NOMBRE A V4, FORZAMOS UNA DB NUEVA Y LIMPIA CON LA NUEVA ESTRUCTURA
export const db = SQLite.openDatabaseSync("agrosense_V4.db");

export const initDatabase = async () => {
  try {
    // 0. Configuración de integridad
    // SQLite requiere activar manualmente las Foreign Keys en cada conexión
    await db.execAsync("PRAGMA foreign_keys = ON;");

    // ---------------------------------------------------------
    // ZONA DE PELIGRO: Descomentar solo si necesitas borrar tablas manualmente en el futuro
    // ---------------------------------------------------------
    // await db.execAsync('DROP TABLE IF EXISTS device_electrodes');
    // await db.execAsync('DROP TABLE IF EXISTS readings_b01');
    // await db.execAsync('DROP TABLE IF EXISTS readings_c01');
    // await db.execAsync('DROP TABLE IF EXISTS sensors');
    // ---------------------------------------------------------

    // 1. Tabla de SENSORES
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

    // 2. Tabla de LECTURAS B01 (Suelo) - CORREGIDA CON updated_at
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
        updated_at TEXT,  -- <--- AGREGADO (Para que funcione el UPSERT)
        
        FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE
      );
      
      -- Índices para búsqueda rápida y sincronización eficiente
      CREATE INDEX IF NOT EXISTS idx_b01_sensor_time ON readings_b01 (sensor_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_b01_synced ON readings_b01 (is_synced);
    `);

    // 3. Tabla de LECTURAS C01 (Clima) - CORREGIDA CON updated_at
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
        updated_at TEXT, -- <--- AGREGADO

        FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_c01_synced ON readings_c01 (is_synced);
    `);

    // 4. Tabla de CALIBRACIÓN DE ELECTRODOS
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS device_electrodes (
        id TEXT PRIMARY KEY NOT NULL,     -- Formato: sensorId_E1 (ej: B01-001_E1)
        sensor_id TEXT NOT NULL,
        electrode_index INTEGER NOT NULL, -- 1, 2, 3
        depth REAL,                       -- Profundidad
        texture TEXT,                     -- Tipo de suelo
        density REAL,                     -- Densidad aparente
        
        -- Calibración
        points_json TEXT,                 -- Puntos PMP, CC, SAT (para edición)
        equations_json TEXT,              -- Segmentos m, b (para cálculo rápido)
        
        -- Sincronización
        is_synced INTEGER DEFAULT 0,
        updated_at TEXT,
        
        FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE
      );
    `);

    console.log("[DB] Inicialización completada. Sistema listo (V4).");
  } catch (error) {
    console.error("[DB] ❌ Error fatal iniciando BD:", error);
  }
};