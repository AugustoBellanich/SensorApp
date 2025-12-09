// Estructura de un punto de dato parseado
export interface SensorDataPoint {
  timestamp: Date; // Para ordenar y graficar X
  label: string;   // "10:30" o "Lunes"
  tSoil: number;
  m1: number;      // mV crudo Electrodo 1
  m2: number;      // mV crudo Electrodo 2
  m3: number;      // mV crudo Electrodo 3
  vbat: number;
}

// Opciones de Filtro
export type TimeRange = '12h' | '1D' | '7D' | '1M' | '1A';
export type UnitType = 'mV' | 'Vol' | 'Grav';