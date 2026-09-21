const MONTHS_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

export type ChartLabelFormat = "time" | "date" | "month";

export const calculateMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

/**
 * Único lugar que decide el intervalo de agrupación (bucket) y el
 * formato de etiqueta según el rango de fechas seleccionado. Los 4
 * lugares donde se grafican datos (nube, local, SD suelo, SD clima)
 * llaman a esta misma función, en vez de tener cada uno su propia
 * copia — evitaba que las 4 pantallas se desincronizaran entre sí.
 */
export const getOptimalInterval = (
  startDate: Date,
  endDate: Date,
): { intervalMs: number; labelFormat: ChartLabelFormat } => {
  const totalDurationMs = endDate.getTime() - startDate.getTime();
  const diffHours = totalDurationMs / (1000 * 60 * 60);

  const MIN_10 = 10 * 60 * 1000;
  const HOUR_1 = 60 * 60 * 1000;
  const HOUR_6 = 6 * HOUR_1;
  const HOUR_12 = 12 * HOUR_1;
  const DAY_1 = 24 * HOUR_1;
  const DAY_30 = 30 * DAY_1;

  if (diffHours <= 24) {
    return { intervalMs: MIN_10, labelFormat: "time" };
  }
  if (diffHours <= 48) {
    return { intervalMs: HOUR_1, labelFormat: "time" };
  }
  if (diffHours <= 120) {
    // 5 días
    return { intervalMs: HOUR_6, labelFormat: "time" };
  }
  if (diffHours <= 168) {
    // 7 días
    return { intervalMs: HOUR_12, labelFormat: "time" };
  }
  if (diffHours <= 744) {
    // 31 días
    return { intervalMs: DAY_1, labelFormat: "date" };
  }
  // > 31 días: agrupamos en bloques aproximados de 30 días. No es un
  // mes calendario exacto, pero alcanza para una vista de tendencia
  // de largo plazo sin generar miles de puntos.
  return { intervalMs: DAY_30, labelFormat: "month" };
};

/**
 * Reduce la cantidad de puntos agrupándolos por intervalo de tiempo.
 * Guarda mediana (línea central), y min/max del bucket (para la banda
 * de variación del gráfico).
 */
export const downsampleData = (
  data: any[],
  key: string,
  intervalMs: number,
): any[] => {
  if (!data || data.length === 0) return [];

  const grouped: Record<number, number[]> = {};
  const timestamps: number[] = [];

  data.forEach((item) => {
    let val = item[key];

    if (val === undefined || val === null || val === "") return;
    val = Number(val);
    if (isNaN(val)) return;

    const tsRaw = new Date(item.timestamp).getTime();
    if (isNaN(tsRaw)) return;

    const bucket = Math.floor(tsRaw / intervalMs) * intervalMs;

    if (!grouped[bucket]) {
      grouped[bucket] = [];
      timestamps.push(bucket);
    }
    grouped[bucket].push(val);
  });

  timestamps.sort((a, b) => a - b);

  return timestamps.map((ts) => {
    const values = grouped[ts];
    let min = values[0];
    let max = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    return {
      timestamp: ts,
      value: calculateMedian(values),
      min,
      max,
      originalCount: values.length,
    };
  });
};

/**
 * Rellena huecos de tiempo para que el eje X cubra SIEMPRE el rango
 * completo seleccionado por el usuario, no solo el tramo donde hay
 * datos reales.
 *
 * - Huecos DESPUÉS de haber visto datos reales: se rellenan con el
 *   último valor conocido (línea plana hacia adelante), como ya se
 *   hacía.
 * - Huecos ANTES del primer dato real (ej: el usuario pidió un rango
 *   que arranca antes de que el sensor tuviera registros): ahora
 *   también se rellenan, con el PRIMER valor conocido (línea plana
 *   hacia atrás). Antes esto no pasaba, y el gráfico arrancaba recién
 *   donde había datos, "comprimiendo" visualmente todo el rango vacío.
 */
export const fillTimeGaps = (
  data: any[],
  intervalMs: number,
  startDate: Date,
  endDate: Date,
): any[] => {
  if (!data || data.length === 0) return [];

  const filledData: any[] = [];
  const dataMap = new Map<number, any>();

  let maxRealTs = 0;
  data.forEach((item) => {
    dataMap.set(item.timestamp, item);
    if (item.timestamp > maxRealTs) maxRealTs = item.timestamp;
  });

  // data ya viene ordenada ascendente desde downsampleData.
  const firstKnownValue = data.length > 0 ? Number(data[0].value) : null;

  const startTs = Math.floor(startDate.getTime() / intervalMs) * intervalMs;
  const endTs = Math.ceil(endDate.getTime() / intervalMs) * intervalMs;

  let currentTs = startTs;
  let lastKnownValue: number | null = null;

  const CUTOFF_THRESHOLD = maxRealTs + intervalMs;

  while (currentTs <= endTs) {
    if (lastKnownValue !== null && currentTs > CUTOFF_THRESHOLD) {
      break;
    }

    if (dataMap.has(currentTs)) {
      const item = dataMap.get(currentTs);
      filledData.push({
        ...item,
        hideDataPoint: false,
        isInterpolated: false,
      });
      lastKnownValue = Number(item.value);
    } else if (lastKnownValue !== null) {
      filledData.push({
        timestamp: currentTs,
        value: lastKnownValue,
        min: lastKnownValue,
        max: lastKnownValue,
        label: "",
        hideDataPoint: true,
        dataPointRadius: 0,
        stripHeight: 0,
        isInterpolated: true,
      });
    } else if (firstKnownValue !== null) {
      filledData.push({
        timestamp: currentTs,
        value: firstKnownValue,
        min: firstKnownValue,
        max: firstKnownValue,
        label: "",
        hideDataPoint: true,
        dataPointRadius: 0,
        stripHeight: 0,
        isInterpolated: true,
      });
    }
    // Si no hay ni lastKnownValue ni firstKnownValue (no hay NINGÚN
    // dato real en todo el dataset), no se agrega nada.

    currentTs += intervalMs;
  }

  return filledData;
};

const parseSensorTimestamp = (dateStr: string): number | null => {
  try {
    const clean = dateStr.replace(/["']/g, "").trim();
    if (clean.includes("T")) return new Date(clean).getTime();

    const [datePart, timePart] = clean.split(" ");
    if (!datePart || !timePart) return null;

    const dateSeps = datePart.includes("-")
      ? datePart.split("-")
      : datePart.split("/");
    const timeSeps = timePart.split(":");

    if (dateSeps.length < 3 || timeSeps.length < 2) return null;

    let year = parseInt(dateSeps[0]);
    if (year < 100) year += 2000;
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

export const parseSensorCSV = (
  fileContent: string,
  sensorType: string,
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

export const formatForExcel = (ts: number | string | Date): string => {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

/**
 * Anota cada punto con hourLabel/dateLabel (texto candidato), SIN
 * decidir cuáles se muestran ni cuándo repetir la fecha — esa
 * decisión ahora vive en SensorChart, en el mismo lugar donde se
 * decide qué puntos son visibles según el ancho de pantalla. Antes
 * esa decisión estaba partida entre acá y SensorChart, y un cambio de
 * día que cayera en un punto "invisible" se perdía para siempre.
 */
export const formatChartData = (
  arr: any[],
  format: ChartLabelFormat | string,
) => {
  if (!arr || arr.length === 0) return [];

  return arr.map((p) => {
    const d = new Date(p.timestamp);
    const dateLabel =
      format === "month"
        ? `${MONTHS_ES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`
        : `${d.getDate()}/${d.getMonth() + 1}`;
    const hourLabel =
      format === "time"
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";

    if (p.hideDataPoint) {
      return {
        value: p.value,
        min: p.min,
        max: p.max,
        label: "",
        hideDataPoint: true,
        dataPointRadius: 0,
        stripHeight: 0,
        timestamp: p.timestamp,
        isInterpolated: true,
        hourLabel,
        dateLabel,
      };
    }

    const val = Number(p.value);
    if (isNaN(val)) {
      return {
        value: 0,
        min: 0,
        max: 0,
        label: "",
        timestamp: p.timestamp,
        isInterpolated: false,
        hourLabel: "",
        dateLabel: "",
      };
    }

    return {
      value: val,
      min: typeof p.min === "number" && !isNaN(p.min) ? p.min : val,
      max: typeof p.max === "number" && !isNaN(p.max) ? p.max : val,
      label: "",
      timestamp: p.timestamp,
      isInterpolated: false,
      hourLabel,
      dateLabel,
    };
  });
};
