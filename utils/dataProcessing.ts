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
export const downsampleData = (
  data: any[],
  key: string,
  intervalMs: number
): any[] => {
  if (!data || data.length === 0) return [];

  const grouped: Record<number, number[]> = {};
  const timestamps: number[] = [];

  data.forEach((item) => {
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
  return timestamps.map((ts) => {
    return {
      timestamp: ts, // Usamos el inicio del intervalo como marca de tiempo
      value: calculateMedian(grouped[ts]), // El valor es la MEDIANA de ese periodo
      originalCount: grouped[ts].length, // (Debug) Cuántos puntos reales formaron este punto
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
  // Si no hay datos, devolvemos vacío.
  if (!data || data.length === 0) return [];

  const filledData: any[] = [];
  const dataMap = new Map<number, any>();
  
  // 1. Encontrar el último timestamp REAL
  // Esto nos sirve para saber cuándo dejar de dibujar la línea plana.
  let maxRealTs = 0;
  
  data.forEach((item) => {
      dataMap.set(item.timestamp, item);
      if (item.timestamp > maxRealTs) maxRealTs = item.timestamp;
  });

  // Alineación a la grilla
  const startTs = Math.floor(startDate.getTime() / intervalMs) * intervalMs;
  // El fin teórico es lo que eligió el usuario...
  const endTs = Math.ceil(endDate.getTime() / intervalMs) * intervalMs;

  let currentTs = startTs;
  let lastKnownValue: number | null = null;
  
  // 2. MARGEN DE CORTE: 
  // Permitimos que la gráfica siga solo 1 intervalo después del último dato real.
  // Así se ve el final claramente sin esa línea larga.
  const CUTOFF_THRESHOLD = maxRealTs + intervalMs; 

  while (currentTs <= endTs) {
    
    // --- NUEVA LÓGICA DE CORTE ---
    // Si ya pasamos el último dato real y superamos el margen, CORTAMOS.
    // Esto evita que la gráfica dibuje una línea plana hasta el futuro.
    if (lastKnownValue !== null && currentTs > CUTOFF_THRESHOLD) {
        break; 
    }

    if (dataMap.has(currentTs)) {
      // --- DATO REAL ---
      const item = dataMap.get(currentTs);
      filledData.push({
        ...item,
        hideDataPoint: false,
        isInterpolated: false,
      });
      lastKnownValue = Number(item.value);
    } else {
      // --- HUECO ---
      if (lastKnownValue !== null) {
        filledData.push({
          timestamp: currentTs,
          value: lastKnownValue, // Mantiene valor anterior
          label: "",
          hideDataPoint: true,
          dataPointRadius: 0,
          stripHeight: 0,
          isInterpolated: true,
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
    const clean = dateStr.replace(/["']/g, "").trim();
    // Detectar si es ISO o formato custom
    if (clean.includes("T")) return new Date(clean).getTime();

    const [datePart, timePart] = clean.split(" ");
    if (!datePart || !timePart) return null;

    const dateSeps = datePart.includes("-")
      ? datePart.split("-")
      : datePart.split("/");
    const timeSeps = timePart.split(":");

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
export const parseSensorCSV = (
  fileContent: string,
  sensorType: string
): any[] => {
  const cleanText = fileContent
    .replace(/SIZE=\d+/g, "")
    .replace(/EOF/g, "")
    .replace(/META:.*?\n/g, "")
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n");

  const lines = cleanText.split("\n");
  const results: any[] = [];
  const isB01 = sensorType === "B01";
  const seen = new Set<number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(",");
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
  const pad = (n: number) => n.toString().padStart(2, "0");
  // Forzamos formato DD/MM/YYYY HH:mm (24 horas)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

/**
 * Formatea los datos para el gráfico (GiftedCharts).
 * Maneja la lógica visual de etiquetas: Hora siempre, Fecha abajo solo al cambiar de día.
 */
/**
 * Formatea los datos para GiftedCharts.
 * @param arr Datos rellenados
 * @param format Formato de fecha
 * @param labelStep CADA CUANTOS puntos mostrar la etiqueta (evita superposición)
 */
export const formatChartData = (arr: any[], format: string, labelStep: number = 1) => {
    if (!arr || arr.length === 0) return [];
    
    // Variable para recordar la fecha del punto anterior
    let lastDateStr = ""; 
  
    return arr.map((p, index) => {
      // 1. Huecos
      if (p.hideDataPoint) {
          return { value: p.value, label: "", hideDataPoint: true, dataPointRadius: 0, stripHeight: 0 };
      }
      
      const val = Number(p.value);
      if (isNaN(val)) return { value: 0, label: "" };
      
      const d = new Date(p.timestamp);
      let label = "";
      
      // 2. Control de densidad de etiquetas (Zoom)
      const shouldShowLabel = (index % labelStep === 0) || (index === arr.length - 1);

      if (shouldShowLabel) {
          // --- FORMATO: HORA O DÍA-HORA ---
          if (format === 'hour' || format === 'day-hour') {
              // Formato corto de hora: "08:00" o "8am" según prefieras
              const timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); 
              const dateStr = `${d.getDate()}/${d.getMonth() + 1}`; 
    
              // LÓGICA DE LIMPIEZA:
              // Solo mostramos la fecha si CAMBIÓ respecto al punto anterior.
              // Esto hace que veas: "00:00", "08:00", "16:00" (limpios)
              // Y cuando cambie el día: "00:00 \n 17/01"
              if (dateStr !== lastDateStr) {
                  label = `${timeStr}\n${dateStr}`; 
                  lastDateStr = dateStr; 
              } else {
                  // Si es el mismo día, SOLO mostramos la hora
                  label = timeStr; 
              }
          } 
          // --- FORMATO: SOLO FECHA (Zoom lejano > 1 mes) ---
          else {
              const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
              // Evitamos repetir la fecha si el zoom lejano agrupa varios puntos del mismo día
              if (dateStr !== lastDateStr) {
                  label = dateStr;
                  lastDateStr = dateStr;
              } else {
                  label = ""; // Si es el mismo día en modo 'date', lo ocultamos para limpiar
              }
          }
      } 
  
      return { 
          value: val, 
          label,
          labelTextStyle: { color: '#757575', fontSize: 10, textAlign: 'center' } 
      };
    });
};
