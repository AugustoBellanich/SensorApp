import { CalibrationPoint, ElectrodeEntity } from "../database/types";

/*
 * ============================================================
 * ESTADO HÍDRICO POR ELECTRODO (PMP / CC / SAT)
 * ------------------------------------------------------------
 * Portado de sensor-web (src/lib/soilReferences.ts). Reusa
 * electrode.points_json (string) tal como ya lo hace
 * utils/referenceLines.ts para las líneas del gráfico — acá en
 * cambio calculamos la posición relativa del valor ACTUAL dentro
 * del rango PMP-SAT, para dibujar la barra al pie de cada tarjeta.
 * ============================================================
 */

export type SoilVariable = "hv" | "hg" | "mv";

export interface ElectrodeReferences {
  pmp: number;
  cc: number;
  sat: number;
}

const findPoint = (
  points: CalibrationPoint[],
  type: string,
): CalibrationPoint | undefined =>
  points.find((p) => (p?.type || "").toUpperCase() === type);

/** Extrae PMP/CC/SAT del points_json de un electrodo para una variable dada. */
export const getElectrodeReferences = (
  electrode: ElectrodeEntity | null | undefined,
  variable: SoilVariable,
): ElectrodeReferences | null => {
  if (!electrode || !electrode.points_json) return null;

  let points: CalibrationPoint[];
  try {
    points = JSON.parse(electrode.points_json);
  } catch {
    return null;
  }
  if (!Array.isArray(points)) return null;

  const pmpPoint = findPoint(points, "PMP");
  const ccPoint = findPoint(points, "CC");
  const satPoint = findPoint(points, "SAT");
  if (!pmpPoint || !ccPoint || !satPoint) return null;

  const pmp = pmpPoint[variable];
  const cc = ccPoint[variable];
  const sat = satPoint[variable];

  if (
    typeof pmp !== "number" ||
    typeof cc !== "number" ||
    typeof sat !== "number" ||
    !Number.isFinite(pmp) ||
    !Number.isFinite(cc) ||
    !Number.isFinite(sat) ||
    sat === pmp
  ) {
    return null;
  }

  return { pmp, cc, sat };
};

export interface WaterStatus {
  /** Posición normalizada del valor actual dentro de PMP(0) -> SAT(1). */
  fraction: number;
  /** Posición (0-1) del punto CC dentro del rango PMP-SAT. */
  ccFraction: number;
  /** % de agua útil disponible: 0% = PMP, 100% = CC. */
  availableWaterPercent: number;
  zone: "stress" | "available" | "excess";
  label: string;
  textColor: string;
  barColor: string;
}

export const computeWaterStatus = (
  value: number | null | undefined,
  refs: ElectrodeReferences,
): WaterStatus | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const { pmp, cc, sat } = refs;

  const fraction = (value - pmp) / (sat - pmp);
  const ccFraction = (cc - pmp) / (sat - pmp);
  const availableWaterPercent =
    cc !== pmp ? ((value - pmp) / (cc - pmp)) * 100 : NaN;

  // La escala puede venir "al derecho" (hv/hg) o invertida (mv). Se
  // compara contra los valores reales de cada punto, no un orden fijo.
  const increasing = sat > pmp;
  const belowPmp = increasing ? value < pmp : value > pmp;
  const aboveSat = increasing ? value > sat : value < sat;
  const aboveCc = increasing ? value > cc : value < cc;

  if (belowPmp) {
    return {
      fraction,
      ccFraction,
      availableWaterPercent,
      zone: "stress",
      label: "Estrés hídrico",
      textColor: "#DC2626",
      barColor: "#EF4444",
    };
  }

  if (aboveSat) {
    return {
      fraction,
      ccFraction,
      availableWaterPercent,
      zone: "excess",
      label: "Sobre saturación",
      textColor: "#4F46E5",
      barColor: "#6366F1",
    };
  }

  if (aboveCc) {
    return {
      fraction,
      ccFraction,
      availableWaterPercent,
      zone: "excess",
      label: "Exceso hídrico",
      textColor: "#2563EB",
      barColor: "#3B82F6",
    };
  }

  return {
    fraction,
    ccFraction,
    availableWaterPercent,
    zone: "available",
    label: "Agua disponible",
    textColor: "#059669",
    barColor: "#10B981",
  };
};
