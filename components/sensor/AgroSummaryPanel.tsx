import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "../../constants/Colors";
import {
    C01Reading,
    computeChillingHours,
    computeDailySummaries,
    computeFrostEvents,
    computeGDD,
    computeHeatHours,
    DEFAULT_AGRO_THRESHOLDS,
    formatHoursDecimal,
} from "../../utils/agroMetrics";

interface Props {
  readings: C01Reading[];
  periodLabel?: string;
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

export default function AgroSummaryPanel({ readings, periodLabel }: Props) {
  const stats = useMemo(() => {
    const dailySummaries = computeDailySummaries(readings);
    const chillingHours = computeChillingHours(readings);
    const heatHours = computeHeatHours(readings);
    const gdd = computeGDD(dailySummaries);
    const frost = computeFrostEvents(dailySummaries);
    return { dailySummaries, chillingHours, heatHours, gdd, frost };
  }, [readings]);

  if (!readings || readings.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Resumen agronómico del período</Text>
        {periodLabel && (
          <Text style={styles.subtitle}>
            {periodLabel} · {stats.dailySummaries.length}{" "}
            {stats.dailySummaries.length === 1 ? "jornada" : "jornadas"} con
            datos
          </Text>
        )}
      </View>

      <View style={styles.grid}>
        <View style={styles.item}>
          <View style={styles.itemHeader}>
            <MaterialCommunityIcons
              name="snowflake"
              size={14}
              color="#0284C7"
            />
            <Text style={[styles.itemLabel, { color: "#0284C7" }]}>
              Horas de frío
            </Text>
          </View>
          <Text style={styles.itemValue}>
            {formatHoursDecimal(stats.chillingHours)}
          </Text>
          <Text style={styles.itemSub}>
            Entre {DEFAULT_AGRO_THRESHOLDS.chillingLower}° y{" "}
            {DEFAULT_AGRO_THRESHOLDS.chillingUpper}° (Weinberger)
          </Text>
        </View>

        <View style={styles.item}>
          <View style={styles.itemHeader}>
            <MaterialCommunityIcons name="fire" size={14} color="#EA580C" />
            <Text style={[styles.itemLabel, { color: "#EA580C" }]}>
              Horas de calor
            </Text>
          </View>
          <Text style={styles.itemValue}>
            {formatHoursDecimal(stats.heatHours)}
          </Text>
          <Text style={styles.itemSub}>
            Por encima de {DEFAULT_AGRO_THRESHOLDS.heatThreshold}°
          </Text>
        </View>

        <View style={styles.item}>
          <View style={styles.itemHeader}>
            <MaterialCommunityIcons name="sprout" size={14} color="#059669" />
            <Text style={[styles.itemLabel, { color: "#059669" }]}>
              Grados-día
            </Text>
          </View>
          <Text style={styles.itemValue}>
            {stats.gdd.accumulated.toFixed(1)} GDD
          </Text>
          <Text style={styles.itemSub}>
            Base {DEFAULT_AGRO_THRESHOLDS.gddBase}°
          </Text>
        </View>

        <View style={styles.item}>
          <View style={styles.itemHeader}>
            <MaterialCommunityIcons
              name="weather-snowy-heavy"
              size={14}
              color="#4F46E5"
            />
            <Text style={[styles.itemLabel, { color: "#4F46E5" }]}>
              Heladas
            </Text>
          </View>
          <Text style={styles.itemValue}>{stats.frost.agro.length} agro</Text>
          <Text style={styles.itemSub}>
            {stats.frost.meteorological.length} meteorológicas (≤ 0°) · agro
            &lt; {DEFAULT_AGRO_THRESHOLDS.frostAgro}°
          </Text>
        </View>
      </View>

      {stats.frost.agro.length > 0 && (
        <View style={styles.frostDaysRow}>
          {stats.frost.agro.map((day) => (
            <View key={day.dateKey} style={styles.frostChip}>
              <Text style={styles.frostChipText}>
                {fmtDay(day.date)} · {day.tmin.toFixed(1)}°
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.disclaimer}>
        Estimaciones sobre temperatura de abrigo (altura del sensor), sin
        medición a nivel de suelo.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 15,
    elevation: 2,
    marginBottom: 25,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "#eee",
  },
  headerRow: { marginBottom: 12 },
  title: { fontSize: 14, fontWeight: "bold", color: Colors.textPrimary },
  subtitle: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  item: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  itemLabel: { fontSize: 11, fontWeight: "bold" },
  itemValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
    marginTop: 4,
  },
  itemSub: { fontSize: 10, color: Colors.textSecondary, marginTop: 3 },
  frostDaysRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  frostChip: {
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#E0E7FF",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  frostChipText: { fontSize: 10, fontWeight: "600", color: "#4338CA" },
  disclaimer: { fontSize: 10, color: "#94a3b8", marginTop: 12, lineHeight: 14 },
});
