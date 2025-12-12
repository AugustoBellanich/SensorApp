// database/types.ts (VERSIÓN FINAL Y LIMPIA)

// --- INTERFAZ BASE PARA SINCRONIZACIÓN ---
export interface SyncableEntity {
  is_synced: number;    // 0 = Pendiente de subir, 1 = Sincronizado
  updated_at: string;   // ISO Date para resolver conflictos
  deleted_at?: string | null; // Soft Delete
}

// --- ENTIDADES PRINCIPALES ---

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

export interface ReadingC01 extends SyncableEntity {
  id?: number;
  sensor_id: string;
  timestamp: string;
  air_temp: number;
  humidity: number;
  battery_mv: number;
}

// --- TIPOS DE CALIBRACIÓN (NUMÉRICOS - PARA DB Y LÓGICA) ---

export interface CalibrationPoint { // Renombrado a CalibrationPoint (ahora es numérico)
  id: string;
  type: 'PMP' | 'CC' | 'SAT' | 'EXTRA';
  labelShort: string; 
  description: string; 
  hv: number;     // Humedad Volumétrica (NUMBER)
  hg: number;     // Humedad Gravimétrica (NUMBER)
  mv: number;     // Voltaje Crudo (NUMBER)
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
    points: CalibrationPoint[]; // Usa el tipo numérico estandarizado
    equations: LinearSegment[]; 
}

export interface SensorConfigB01 {
    calibration?: {
        electrodes: ElectrodeCalibration[];
    };
    // ... otros campos de config hardware
}