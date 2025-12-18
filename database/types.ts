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
  config_json: string; // Úsalo solo para Config de Hardware (ej: intervalos)
  last_sync?: string;
}

// Mantenlo para las pantallas de Gráficos e Historial
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

// Mantenlo para el Dashboard y Cálculos matemáticos
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

// Esta es tu NUEVA ENTIDAD MAESTRA para calibraciones
export interface ElectrodeEntity extends SyncableEntity {
  id: string; 
  sensor_id: string;
  electrode_index: number;
  depth: number;
  texture: string;
  density: number;
  points_json: string;    // Aquí guardas el array de CalibrationPoint[]
  equations_json: string; // Aquí guardas el array de LinearSegment[]
}