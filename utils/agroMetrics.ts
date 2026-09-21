/*
 * ============================================================
 * MÉTRICAS AGRONÓMICAS DERIVADAS (temperatura del aire) — C01
 * ------------------------------------------------------------
 * Puerto de sensor-web (src/lib/agroMetrics.ts), adaptado a los
 * tipos de SensorApp. `timestamp` puede venir como string ISO
 * (filas de SQLite/Supabase) o como número en ms (datos ya
 * procesados de la descarga SD) — new Date() acepta ambos.
 * ============================================================
 */

export interface C01Reading {
  timestamp: string | number;
  air_temp?: number | null;
  humidity?: number | null;
  [key: string]: any;
}

export interface DailyTempSummary {
  dateKey: string;
  date: Date;
  tmax: number;
  tmin: number;
  tmaxTime: number;
  tminTime: number;
  avgHumidity: number | null;
  readingsCount: number;
}

export interface AgroThresholds {
  chillingLower: number;
  chillingUpper: number;
  heatThreshold: number;
  gddBase: number;
  frostMeteorological: number;
  frostAgro: number;
  maxGapHours: number;
}

export const DEFAULT_AGRO_THRESHOLDS: AgroThresholds = {
  chillingLower: 0,
  chillingUpper: 7.2,
  heatThreshold: 30,
  gddBase: 10,
  frostMeteorological: 0,
  frostAgro: 3,
  maxGapHours: 3,
};

const HOUR_MS = 60 * 60 * 1000;

const localDateKey = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const computeDailySummaries = (
  readings: C01Reading[],
): DailyTempSummary[] => {
  const byDay = new Map<
    string,
    {
      date: Date;
      tmax: number;
      tmin: number;
      tmaxTime: number;
      tminTime: number;
      humiditySum: number;
      humidityCount: number;
      readingsCount: number;
    }
  >();

  for (const reading of readings) {
    if (typeof reading.air_temp !== "number" || !reading.timestamp) continue;

    const time = new Date(reading.timestamp).getTime();
    if (!Number.isFinite(time)) continue;

    const date = new Date(time);
    const key = localDateKey(date);
    const existing = byDay.get(key);

    if (!existing) {
      byDay.set(key, {
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        tmax: reading.air_temp,
        tmin: reading.air_temp,
        tmaxTime: time,
        tminTime: time,
        humiditySum:
          typeof reading.humidity === "number" ? reading.humidity : 0,
        humidityCount: typeof reading.humidity === "number" ? 1 : 0,
        readingsCount: 1,
      });
      continue;
    }

    existing.readingsCount += 1;
    if (reading.air_temp > existing.tmax) {
      existing.tmax = reading.air_temp;
      existing.tmaxTime = time;
    }
    if (reading.air_temp < existing.tmin) {
      existing.tmin = reading.air_temp;
      existing.tminTime = time;
    }
    if (typeof reading.humidity === "number") {
      existing.humiditySum += reading.humidity;
      existing.humidityCount += 1;
    }
  }

  return Array.from(byDay.entries())
    .map(([dateKey, value]) => ({
      dateKey,
      date: value.date,
      tmax: value.tmax,
      tmin: value.tmin,
      tmaxTime: value.tmaxTime,
      tminTime: value.tminTime,
      avgHumidity:
        value.humidityCount > 0
          ? value.humiditySum / value.humidityCount
          : null,
      readingsCount: value.readingsCount,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
};

/*
 * Integra por el tiempo REAL entre lecturas consecutivas (no un
 * intervalo fijo asumido). Si el gap entre dos lecturas supera
 * maxGapHours (sensor offline), ese tramo NO se cuenta, para no
 * inflar el acumulado con datos faltantes.
 */
const integrateHours = (
  readings: C01Reading[],
  matches: (avgTemp: number) => boolean,
  maxGapHours: number,
): number => {
  const points = readings
    .filter((r) => typeof r.air_temp === "number" && Boolean(r.timestamp))
    .map((r) => ({
      time: new Date(r.timestamp).getTime(),
      temp: r.air_temp as number,
    }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);

  let totalMs = 0;
  const maxGapMs = maxGapHours * HOUR_MS;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const gapMs = b.time - a.time;
    if (gapMs <= 0 || gapMs > maxGapMs) continue;

    const avgTemp = (a.temp + b.temp) / 2;
    if (matches(avgTemp)) totalMs += gapMs;
  }

  return totalMs / HOUR_MS;
};

/** Horas de frío (modelo Weinberger): temperatura entre chillingLower y chillingUpper. */
export const computeChillingHours = (
  readings: C01Reading[],
  thresholds: AgroThresholds = DEFAULT_AGRO_THRESHOLDS,
): number =>
  integrateHours(
    readings,
    (t) => t >= thresholds.chillingLower && t <= thresholds.chillingUpper,
    thresholds.maxGapHours,
  );

/** Horas de calor: temperatura por encima del umbral de estrés térmico. */
export const computeHeatHours = (
  readings: C01Reading[],
  thresholds: AgroThresholds = DEFAULT_AGRO_THRESHOLDS,
): number =>
  integrateHours(
    readings,
    (t) => t >= thresholds.heatThreshold,
    thresholds.maxGapHours,
  );

export interface DailyGDD {
  dateKey: string;
  date: Date;
  gdd: number;
}

/** Grados-día de crecimiento: max(0, (Tmax+Tmin)/2 - Tbase), sumado por jornada. */
export const computeGDD = (
  dailySummaries: DailyTempSummary[],
  gddBase: number = DEFAULT_AGRO_THRESHOLDS.gddBase,
): { daily: DailyGDD[]; accumulated: number } => {
  const daily = dailySummaries.map((day) => ({
    dateKey: day.dateKey,
    date: day.date,
    gdd: Math.max(0, (day.tmax + day.tmin) / 2 - gddBase),
  }));
  const accumulated = daily.reduce((sum, day) => sum + day.gdd, 0);
  return { daily, accumulated };
};

export interface FrostSummary {
  meteorological: DailyTempSummary[];
  agro: DailyTempSummary[];
}

/** Helada meteorológica: Tmín ≤ 0°C. Helada agrometeorológica: Tmín < 3°C. */
export const computeFrostEvents = (
  dailySummaries: DailyTempSummary[],
  thresholds: AgroThresholds = DEFAULT_AGRO_THRESHOLDS,
): FrostSummary => ({
  meteorological: dailySummaries.filter(
    (day) => day.tmin <= thresholds.frostMeteorological,
  ),
  agro: dailySummaries.filter((day) => day.tmin < thresholds.frostAgro),
});

export const formatHoursDecimal = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) return "0 h";
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  if (minutes === 0) return `${wholeHours} h`;
  if (wholeHours === 0) return `${minutes} min`;
  return `${wholeHours} h ${minutes} min`;
};
