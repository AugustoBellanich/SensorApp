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

/**
 * Genera un array de segmentos lineales de calibración (MV -> %Vol).
 * @param points - Puntos de calibración (con MV y HV ya como números válidos).
 * @returns Array de LinearSegment (m, b, minMv, maxMv).
 */
export const generateCalibrationEquations = (points: CalibrationPoint[]): LinearSegment[] => {
    
    // 1. FILTRAR Y PREPARAR
    // Aseguramos que solo usamos puntos con valores positivos y numéricos válidos
    const validPoints = points
        .filter(p => 
            p.mv !== undefined && p.mv !== null && !isNaN(p.mv) && p.mv > 0 &&
            p.hv !== undefined && p.hv !== null && !isNaN(p.hv) && p.hv > 0
        );

    if (validPoints.length < 2) {
        console.log("Advertencia: Se requieren al menos 2 puntos válidos para generar la curva.");
        return [];
    }

    // 2. ORDENAR por MV (Voltaje Crudo), de menor a mayor
    // Esto es crucial para crear segmentos ordenados [min, max]
    validPoints.sort((a, b) => a.mv - b.mv);

    const segments: LinearSegment[] = [];

    // 3. GENERAR SEGMENTOS
    for (let i = 0; i < validPoints.length - 1; i++) {
        const point1 = validPoints[i];
        const point2 = validPoints[i + 1];

        const equation = calculateLinearEquation(point1.mv, point1.hv, point2.mv, point2.hv);

        if (equation) {
            segments.push({
                minMv: point1.mv,
                maxMv: point2.mv,
                m: parseFloat(equation.m.toFixed(5)), // Redondeo para evitar flotantes infinitos
                b: parseFloat(equation.b.toFixed(5))
            });
        }
    }

    return segments;
};

/**
 * (Opcional) Calcula la humedad dado un voltaje usando los segmentos generados.
 * Útil para pruebas en caliente o validación.
 */
export const calculateMoistureFromSegments = (mv: number, segments: LinearSegment[]): number => {
    if (!segments || segments.length === 0) return 0;

    // 1. Buscar si cae dentro de un segmento conocido
    const match = segments.find(s => mv >= s.minMv && mv <= s.maxMv);
    if (match) return (match.m * mv) + match.b;

    // 2. Extrapolación / Topes
    // Si es menor al mínimo, usamos el primer segmento con tope
    if (mv < segments[0].minMv) {
        const s = segments[0];
        const val = (s.m * mv) + s.b;
        return Math.max(0, Math.min(100, val));
    }
    // Si es mayor al máximo, usamos el último segmento con tope
    if (mv > segments[segments.length - 1].maxMv) {
        const s = segments[segments.length - 1];
        const val = (s.m * mv) + s.b;
        return Math.max(0, Math.min(100, val));
    }

    return 0;
};