// app/utils/dataProcessing.ts

export const calculateMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    
    // Ordenar numéricamente para encontrar el centro
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
};

export const downsampleData = (data: any[], key: string, intervalMs: number): any[] => {
    if (!data || data.length === 0) return [];

    const grouped: Record<number, number[]> = {};
    const timestamps: number[] = [];

    data.forEach(item => {
        // 1. OBTENER VALOR
        let val = item[key];
        
        // Si el valor no existe o es nulo, saltamos
        if (val === undefined || val === null) return;
        
        // Asegurar que es número
        val = Number(val);
        if (isNaN(val)) return;

        // 2. CORRECCIÓN CRÍTICA: TIMESTAMP DE STRING A NUMBER
        // SQLite devuelve "2025-12-21T...", esto no se puede dividir.
        const tsNum = new Date(item.timestamp).getTime();
        
        if (isNaN(tsNum)) return; // Si la fecha es inválida, saltar

        // 3. AGRUPAR EN CUBETAS (BUCKETS)
        const bucket = Math.floor(tsNum / intervalMs) * intervalMs;
        
        if (!grouped[bucket]) {
            grouped[bucket] = [];
            timestamps.push(bucket);
        }
        grouped[bucket].push(val);
    });

    // Ordenar cronológicamente
    timestamps.sort((a, b) => a - b);

    // Generar array final
    return timestamps.map(ts => {
        const medianValue = calculateMedian(grouped[ts]);
        return {
            timestamp: ts, // Devolvemos número (epoch), el gráfico lo entenderá
            value: medianValue, 
            originalCount: grouped[ts].length 
        };
    });
};