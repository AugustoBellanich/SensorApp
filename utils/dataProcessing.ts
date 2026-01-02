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

// --- RELLENO DE HUECOS (MODO UNIR SIEMPRE) ---
export const fillTimeGaps = (
  data: any[], 
  intervalMs: number, 
  start: Date, 
  end: Date
): any[] => {
    if (!data || data.length === 0) return [];

    const filledData: any[] = [];
    const dataMap = new Map();
    const timestamps: number[] = [];

    // 1. Indexar datos
    data.forEach(item => {
        const bucket = Math.floor(item.timestamp / intervalMs) * intervalMs;
        dataMap.set(bucket, item);
        timestamps.push(bucket);
    });

    if (timestamps.length === 0) return [];

    // 2. Definir límites basados en DATOS REALES (Evita líneas al inicio/fin vacíos)
    const firstRealTs = Math.min(...timestamps);
    const lastRealTs = Math.max(...timestamps);

    let currentTs = firstRealTs;
    
    // Estado para interpolación
    let lastValidValue = dataMap.get(currentTs).value;
    let lastValidTs = currentTs; 

    while (currentTs <= lastRealTs) {
        if (dataMap.has(currentTs)) {
            // CASO A: DATO REAL
            const realItem = dataMap.get(currentTs);
            lastValidValue = realItem.value;
            lastValidTs = currentTs;

            filledData.push({
                ...realItem,
                timestamp: currentTs,
                hideDataPoint: false,
            });
        } else {
            // CASO B: HUECO (Siempre interpolamos, nunca cortamos)
            
            // Buscar siguiente dato
            let nextValidValue = lastValidValue;
            let nextValidTs = currentTs;
            let foundNext = false;
            let lookAheadTs = currentTs + intervalMs;
            
            while(lookAheadTs <= lastRealTs && !foundNext) {
                if (dataMap.has(lookAheadTs)) {
                    nextValidValue = dataMap.get(lookAheadTs).value;
                    nextValidTs = lookAheadTs;
                    foundNext = true;
                }
                lookAheadTs += intervalMs;
            }

            let calculatedValue = lastValidValue;
            
            // Si encontramos un futuro, hacemos una línea recta hacia él
            if (foundNext) {
                const totalDuration = nextValidTs - lastValidTs;
                const elapsed = currentTs - lastValidTs;
                const factor = elapsed / totalDuration;
                calculatedValue = lastValidValue + (nextValidValue - lastValidValue) * factor;
            }

            filledData.push({
                timestamp: currentTs,
                value: calculatedValue,
                label: '', 
                hideDataPoint: true, // Punto invisible para que parezca una línea continua
                stripHeight: 0,
                dataPointRadius: 0,
            });
        }
        currentTs += intervalMs;
    }

    return filledData;
};

// --- PARSER DE FECHAS SEGURO (SOLUCIÓN A FECHAS EXCEL Y DB) ---
const parseSensorTimestamp = (dateStr: string): number | null => {
    try {
        const clean = dateStr.replace(/["']/g, '').trim();
        // Detectar si es ISO o formato custom
        if (clean.includes('T')) return new Date(clean).getTime();

        const [datePart, timePart] = clean.split(' ');
        if (!datePart || !timePart) return null;

        const dateSeps = datePart.includes('-') ? datePart.split('-') : datePart.split('/');
        const timeSeps = timePart.split(':');

        if (dateSeps.length < 3 || timeSeps.length < 2) return null;

        let year = parseInt(dateSeps[0]);
        if (year < 100) year += 2000; // Fix año 2 digitos
        const month = parseInt(dateSeps[1]) - 1; 
        const day = parseInt(dateSeps[2]);
        
        const hour = parseInt(timeSeps[0]);
        const min = parseInt(timeSeps[1]);
        const sec = timeSeps[2] ? parseInt(timeSeps[2]) : 0;

        return new Date(year, month, day, hour, min, sec).getTime();
    } catch {
        return null;
    }
};

// --- PARSER CSV CENTRALIZADO ---
export const parseSensorCSV = (fileContent: string, sensorType: string): any[] => {
    const cleanText = fileContent
        .replace(/SIZE=\d+/g, '')
        .replace(/EOF/g, '')
        .replace(/META:.*?\n/g, '')
        .replace(/\0/g, '')
        .replace(/\r\n/g, '\n');

    const lines = cleanText.split('\n');
    const results: any[] = [];
    const isB01 = sensorType === 'B01';
    const seen = new Set<number>();

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length < 10 || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(',');
        if (parts.length < 4) continue;

        const ts = parseSensorTimestamp(parts[0]);
        if (!ts || isNaN(ts)) continue;
        
        if (seen.has(ts)) continue; 
        seen.add(ts);

        const item: any = { timestamp: ts }; 

        if (isB01) {
            item.soil_temp = parseFloat(parts[1]) || 0;
            item.e1_mv = parseFloat(parts[2]) || 0;
            item.e2_mv = parseFloat(parts[3]) || 0;
            item.e3_mv = parseFloat(parts[4]) || 0;
            item.battery_mv = (parseFloat(parts[5]) || 0) * 1000;
        } else {
            item.air_temp = parseFloat(parts[1]) || 0;
            item.humidity = parseFloat(parts[2]) || 0;
            item.battery_mv = (parseFloat(parts[3]) || 0) * 1000;
        }
        results.push(item);
    }
    return results.sort((a, b) => a.timestamp - b.timestamp);
};

// --- FORMATO EXCEL 24H CORRECTO ---
export const formatForExcel = (ts: number | string | Date): string => {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    // Forzamos formato DD/MM/YYYY HH:mm (24 horas)
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};