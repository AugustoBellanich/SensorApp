// app/utils/dataProcessing.ts

// Calcula la MEDIANA (Valor central)
export const calculateMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    
    // 1. Ordenar numéricamente (Crucial)
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    // 2. Si es par, promedio de los dos centrales
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    // 3. Si es impar, el del centro
    return sorted[mid];
};

// Calcula el promedio (solo si lo necesitaras para otra cosa, pero NO lo usaremos hoy)
export const calculateAverage = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
};

// Reduce datos usando MEDIANA
export const downsampleData = (data: any[], key: string, intervalMs: number): any[] => {
    if (!data || data.length === 0) return [];

    const grouped: Record<number, number[]> = {};
    const timestamps: number[] = [];

    data.forEach(item => {
        const val = item[key];
        if (val === undefined || val === null) return;
        const bucket = Math.floor(item.timestamp / intervalMs) * intervalMs;
        if (!grouped[bucket]) {
            grouped[bucket] = [];
            timestamps.push(bucket);
        }
        grouped[bucket].push(val);
    });

    timestamps.sort((a, b) => a - b);

    return timestamps.map(ts => {
        return {
            timestamp: ts,
            value: calculateMedian(grouped[ts]), // <--- AQUÍ SE USA MEDIANA PARA EL GRÁFICO
            originalCount: grouped[ts].length 
        };
    });
};