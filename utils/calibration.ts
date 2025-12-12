// utils/calibration.ts (CORREGIDO)

import { CalibrationPoint, LinearSegment } from "../database/types";

/**
 * Calcula la ecuación lineal (y = mx + b) entre dos puntos.
 * Fórmulas: m = (y2 - y1) / (x2 - x1); b = y1 - m * x1
 * @param x1 - MV del punto 1
 * @param y1 - HV (%Vol) del punto 1
 * @param x2 - MV del punto 2
 * @param y2 - HV (%Vol) del punto 2
 * @returns {m, b} o null si son iguales.
 */
function calculateLinearEquation(x1: number, y1: number, x2: number, y2: number): { m: number, b: number } | null {
    // Evitar división por cero (si los MV son iguales)
    if (x1 === x2) {
        return null;
    }
    
    // m = Pendiente
    const m = (y2 - y1) / (x2 - x1);
    
    // b = Intercepto
    const b = y1 - m * x1;
    
    return { m, b };
}

// Para comprender la lógica de segmentación lineal, imagina la curva de calibración del suelo.
// Cada punto (PMP, CC, SAT, Extra) define un nodo en la curva.
// La App calcula la línea recta (segmento) entre cada nodo adyacente.


/**
 * Genera un array de segmentos lineales de calibración (MV -> %Vol).
 * @param points - Puntos de calibración (con MV y HV ya como números válidos).
 * @returns Array de LinearSegment (m, b, minMv, maxMv).
 */
export const generateCalibrationEquations = (points: CalibrationPoint[]): LinearSegment[] => {
    
    // 1. FILTRAR Y PREPARAR (Ahora solo filtramos, no parseamos)
    const validPoints = points
        .map(p => ({
            mv: p.mv, // Ya es un number
            hv: p.hv, // Ya es un number
            id: p.id
        }))
        // Filtramos puntos donde los valores sean cero (los no ingresados)
        .filter(p => p.mv > 0 && p.hv > 0 && !isNaN(p.mv) && !isNaN(p.hv)); 

    if (validPoints.length < 2) {
        console.warn("Se requieren al menos 2 puntos válidos (MV y HV > 0) para generar la curva.");
        return [];
    }

    // 2. ORDENAR por MV (Voltaje Crudo), de menor a mayor
    validPoints.sort((a, b) => a.mv - b.mv);

    const segments: LinearSegment[] = [];

    // 3. GENERAR SEGMENTOS
    for (let i = 0; i < validPoints.length - 1; i++) {
        const point1 = validPoints[i];
        const point2 = validPoints[i + 1];

        const equation = calculateLinearEquation(point1.mv, point1.hv, point2.mv, point2.hv);

        if (equation) {
            segments.push({
                m: parseFloat(equation.m.toFixed(5)),
                b: parseFloat(equation.b.toFixed(5)),
                minMv: point1.mv,
                maxMv: point2.mv,
            });
        }
    }

    console.log(`Curva generada con ${segments.length} segmentos.`);
    return segments;
};