// Estructura de un punto de dato parseado
export interface SensorDataPoint {
  timestamp: Date; // Para ordenar y graficar X
  label: string; // "10:30" o "Lunes"
  tSoil: number;
  m1: number; // mV crudo Electrodo 1
  m2: number; // mV crudo Electrodo 2
  m3: number; // mV crudo Electrodo 3
  vbat: number;
}

// Opciones de Filtro
export type TimeRange = "12h" | "1D" | "7D" | "1M" | "1A";
export type UnitType = "mV" | "Vol" | "Grav";

export interface IngestLog {
  id: string;
  device_id: string;
  received_at: string;

  request_status: string | null;
  processing_ms: number | null;

  readings_received: number | null;
  readings_inserted: number | null;
  readings_duplicate: number | null;

  sensors_count: number | null;
  sensor_ids: unknown | null;

  error_message: string | null;

  readings_min_timestamp: string | null;
  readings_max_timestamp: string | null;

  upload_delay_seconds: number | null;
  payload_bytes: number | null;
  http_status: number | null;
}
