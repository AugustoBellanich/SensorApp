// app/utils/dataProcessing.ts

export const calculateMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    
    // Ordenamos de menor a mayor
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
};

/**
 * Reduce la cantidad de puntos agrupándolos por intervalo de tiempo.
 * @param data Array de datos crudos
 * @param key La propiedad a leer (ej: 'soil_temp', 'v1')
 * @param intervalMs El tamaño de la ventana de tiempo en ms (ej: 3600000 para 1h)
 */
export const downsampleData = (data: any[], key: string, intervalMs: number): any[] => {
    if (!data || data.length === 0) return [];

    const grouped: Record<number, number[]> = {};
    const timestamps: number[] = [];

    data.forEach(item => {
        let val = item[key];
        
        // Validación numérica estricta
        if (val === undefined || val === null || val === "") return;
        val = Number(val);
        if (isNaN(val)) return;

        // FILTRO DE CALIDAD: Ignoramos 0 absoluto si no es lógico (opcional)
        // if (val === 0) return; 

        const tsRaw = new Date(item.timestamp).getTime();
        if (isNaN(tsRaw)) return;

        // "Redondeamos" el tiempo al inicio del intervalo (Bucket)
        // Ej: 14:15, 14:30, 14:45 -> Todos caen en la cubeta de las 14:00
        const bucket = Math.floor(tsRaw / intervalMs) * intervalMs;
        
        if (!grouped[bucket]) {
            grouped[bucket] = [];
            timestamps.push(bucket);
        }
        grouped[bucket].push(val);
    });

    // Ordenamos cronológicamente
    timestamps.sort((a, b) => a - b);

    // Generamos el array reducido
    return timestamps.map(ts => {
        return {
            timestamp: ts, // Usamos el inicio del intervalo como marca de tiempo
            value: calculateMedian(grouped[ts]), // El valor es la MEDIANA de ese periodo
            originalCount: grouped[ts].length // (Debug) Cuántos puntos reales formaron este punto
        };
    });
};

// --- RELLENO DE HUECOS (MODO UNIR SIEMPRE) ---
// Rellena huecos de tiempo vacíos para que la gráfica no corte la línea
export const fillTimeGaps = (
    data: any[], 
    intervalMs: number, 
    startDate: Date, 
    endDate: Date
): any[] => {
    if (!data || data.length === 0) return [];

    const filledData: any[] = [];
    const dataMap = new Map();
    
    data.forEach(item => dataMap.set(item.timestamp, item));

    const startTs = Math.floor(startDate.getTime() / intervalMs) * intervalMs;
    const endTs = Math.floor(endDate.getTime() / intervalMs) * intervalMs;

    let currentTs = startTs;
    // Buscamos el primer dato real para no inventar línea al principio
    const firstReal = data[0].timestamp; 
    
    // Si el rango empieza antes del primer dato, avanzamos hasta el primer dato
    if (currentTs < firstReal) currentTs = firstReal;

    while (currentTs <= endTs) {
        if (dataMap.has(currentTs)) {
            // DATO REAL
            filledData.push({
                ...dataMap.get(currentTs),
                hideDataPoint: false
            });
        } else {
            // HUECO: Interpolación visual (opcional) o punto oculto
            // Aquí repetimos el último valor conocido pero lo marcamos como oculto
            // para mantener la continuidad de la línea sin poner un punto falso.
            const lastItem = filledData[filledData.length - 1];
            if (lastItem) {
                filledData.push({
                    timestamp: currentTs,
                    value: lastItem.value, // Mantenemos valor visualmente
                    label: "",
                    hideDataPoint: true,   // Ocultamos el punto
                    isInterpolated: true
                });
            }
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