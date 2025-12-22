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
        let val = item[key];
        
        if (val === undefined || val === null) return;
        val = Number(val);
        
        // --- FILTRO DE CALIDAD ---
        // Si el valor es exactamente 0, lo consideramos error de lectura y lo saltamos.
        // (A menos que tu sensor realmente mida 0 absoluto, lo cual es raro en agricultura)
        if (isNaN(val) || val === 0) return; 

        const tsNum = new Date(item.timestamp).getTime();
        if (isNaN(tsNum)) return;

        const bucket = Math.floor(tsNum / intervalMs) * intervalMs;
        
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
            value: calculateMedian(grouped[ts]), 
            originalCount: grouped[ts].length 
        };
    });
};