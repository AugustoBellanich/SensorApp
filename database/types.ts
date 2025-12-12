// --- INTERFAZ BASE PARA SINCRONIZACIÓN ---
export interface SyncableEntity {
  is_synced: number;    // 0 = Pendiente de subir, 1 = Sincronizado
  updated_at: string;   // ISO Date para resolver conflictos
  deleted_at?: string | null; // Soft Delete: si tiene fecha, está borrado lógicamente
}

// --- ENTIDADES ---

export interface SensorEntity extends SyncableEntity {
  id: string;          // UUID o MAC
  alias: string;
  type: 'B01' | 'C01' | 'N01';
  location: string;    // En Supabase se llama 'name_farm'
  activity?: string;   
  lat?: number;        
  lng?: number;        
  config_json: string; // En Supabase es columna 'config' (jsonb)
  last_sync?: string;  // Fecha de la última vez que el sensor habló con la app
}

// Para las lecturas, generalmente solo necesitamos saber si subieron o no.
// No suelen editarse ni borrarse, así que updated_at/deleted_at son opcionales.
export interface ReadingB01 {
  id?: number;          // ID Local (SQLite autoincrement)
  sensor_id: string;
  timestamp: string;
  soil_temp: number;
  // Electrodos
  e1_mv: number; e1_hv: number; e1_hg: number;
  e2_mv: number; e2_hv: number; e2_hg: number;
  e3_mv: number; e3_hv: number; e3_hg: number;
  battery_mv: number;
  // Sync flags
  is_synced: number;    
}

export interface ReadingC01 {
  id?: number;
  sensor_id: string;
  timestamp: string;
  air_temp: number;
  humidity: number;
  battery_mv: number;
  // Sync flags
  is_synced: number;
}

// --- TIPOS DE CALIBRACIÓN (Reutilizamos lo que definimos antes) ---
export interface CalibrationPoint {
  id: string;
  type: 'PMP' | 'CC' | 'SAT' | 'EXTRA';
  labelShort: string; 
  description: string; 
  hv: string;    
  hg: string;    
  mv: string;    
  isFixed: boolean; 
}

export interface LinearSegment {
    m: number; 
    b: number; 
    minMv: number;
    maxMv: number;
}

export interface ElectrodeCalibration {
    depth: number;
    texture: string;
    density: number;
    points: CalibrationPoint[]; 
    equations: LinearSegment[]; 
}

export interface SensorConfigB01 {
    calibration?: {
        electrodes: ElectrodeCalibration[];
    };
    // ... otros campos de config hardware
}