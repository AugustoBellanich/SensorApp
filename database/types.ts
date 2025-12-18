// types.ts

export interface SyncableEntity {
  is_synced: number;
  updated_at: string;
  deleted_at?: string | null;
}

export interface SensorEntity extends SyncableEntity {
  id: string;
  alias: string;
  type: 'B01' | 'C01' | 'N01';
  location: string;
  activity?: string;
  lat?: number;
  lng?: number;
  config_json: string; 
  last_sync?: string;
}

export interface ReadingB01 extends SyncableEntity {
  id?: number;
  sensor_id: string;
  timestamp: string;
  soil_temp: number;
  e1_mv: number; e1_hv: number; e1_hg: number;
  e2_mv: number; e2_hv: number; e2_hg: number;
  e3_mv: number; e3_hv: number; e3_hg: number;
  battery_mv: number;
}

// --- Tipos de Calibración ---

export interface CalibrationPoint {
  id: string;
  type: 'PMP' | 'CC' | 'SAT' | 'EXTRA';
  labelShort: string;
  description: string;
  hv: number;
  hg: number;
  mv: number;
  isFixed: boolean;
}

export interface LinearSegment {
  m: number;
  b: number;
  minMv: number;
  maxMv: number;
}

// --- AGREGAR ESTA INTERFAZ QUE FALTABA ---
// Esta define la estructura del objeto dentro de config_json -> calibration -> electrodes[]
export interface ElectrodeCalibration {
    depth: number;
    texture: string;
    density: number;
    points: CalibrationPoint[];
    equations: LinearSegment[];
}

// Esta es tu entidad para la tabla SQL (si decides migrar a tabla relacional luego)
export interface ElectrodeEntity extends SyncableEntity {
  id: string; 
  sensor_id: string;
  electrode_index: number;
  depth: number;
  texture: string;
  density: number;
  points_json: string;    
  equations_json: string; 
}