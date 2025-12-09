// database/types.ts

export interface SensorEntity {
  id: string;
  alias: string;
  type: 'B01' | 'C01';
  location: string;
  activity?: string;    // <--- Agregamos esto (opcional con ?)
  lat?: number;         // <--- Agregamos esto (opcional)
  lng?: number;         // <--- Agregamos esto (opcional)
  config_json: string;
  last_sync?: string;
}

// ... (El resto de interfaces ReadingB01, SensorConfigB01, etc. quedan igual)
export interface ReadingB01 {
  id?: number;
  sensor_id: string;
  timestamp: string;
  soil_temp: number;
  e1_mv: number; e1_hv: number; e1_hg: number;
  e2_mv: number; e2_hv: number; e2_hg: number;
  e3_mv: number; e3_hv: number; e3_hg: number;
  battery_mv: number;
}

export interface ReadingC01 {
  id?: number;
  sensor_id: string;
  timestamp: string;
  air_temp: number;
  humidity: number;
  battery_mv: number;
}