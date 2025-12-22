import { CalibrationPoint, ElectrodeEntity } from '../database/types';

// Usamos colores suaves pero distinguibles (Pastel o Grisáceos)
// Si prefieres todos grises, cambia todos a '#B0B0B0'
const COLORS = {
  SAT: '#4FC3F7', // Azul Claro (Saturación)
  CC:  '#81C784', // Verde Suave (Capacidad de Campo)
  PMP: '#E57373', // Rojo Suave (Punto de Marchitez)
};

export interface ChartReferenceLine {
  value: number;
  label: string;
  color: string;
}

export const getAgronomicLines = (
  electrode: ElectrodeEntity | null | undefined, 
  unit: string
): ChartReferenceLine[] => {
  // 1. Validaciones
  if (!electrode || !electrode.points_json || unit === 'mV') return [];

  // 2. Parsear el JSON (Tu JSON viene como string dentro de la columna)
  let points: CalibrationPoint[] = [];
  try {
    // El JSON que me mostraste es un string: "[{...}, {...}]"
    // Al hacer JSON.parse obtenemos el array de objetos real.
    points = JSON.parse(electrode.points_json);
  } catch (e) {
    console.warn("Error parseando puntos agro:", e);
    return [];
  }

  if (!Array.isArray(points)) return [];

  const lines: ChartReferenceLine[] = [];
  const density = electrode.density && electrode.density > 0 ? electrode.density : 1.3;

  // 3. Helper de valor
  const getValue = (p: CalibrationPoint): number => {
    if (unit === '% Hv') return p.hv;
    if (unit === '% Hg') {
        return (p.hg && p.hg > 0) ? p.hg : (p.hv / density);
    }
    return 0;
  };

  // 4. Buscar puntos (Tu JSON usa "type": "CC", etc.)
  const sat = points.find(p => p.type === 'SAT');
  const cc = points.find(p => p.type === 'CC');
  const pmp = points.find(p => p.type === 'PMP');

  // Importante: Verificamos que el valor sea > 0 para graficarlo
  if (sat) {
      const v = getValue(sat);
      if (v > 0) lines.push({ value: v, label: 'SAT', color: COLORS.SAT });
  }
  if (cc) {
      const v = getValue(cc);
      if (v > 0) lines.push({ value: v, label: 'CC', color: COLORS.CC });
  }
  if (pmp) {
      const v = getValue(pmp);
      if (v > 0) lines.push({ value: v, label: 'PMP', color: COLORS.PMP });
  }

  return lines;
};