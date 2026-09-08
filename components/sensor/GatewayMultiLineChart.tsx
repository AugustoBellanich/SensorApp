import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { Colors } from "../../constants/Colors";

export interface GatewayChartSeries {
  label: string;
  color: string;
  values: number[]; // un valor por punto, mismo largo que `labels`
}

interface Props {
  title: string;
  unit: string;
  labels: string[]; // etiquetas del eje X, una por punto
  series: GatewayChartSeries[]; // 1 a 3 líneas
  decimals?: number;
}

// Gráfico de línea FIJO (sin scroll horizontal), pensado para series de
// tiempo con una cantidad conocida de puntos (ej: 24 baldes de 1 hora).
// A diferencia de SensorChart.tsx (una sola serie + líneas de referencia,
// usado en B01/C01), este soporta hasta 3 líneas combinadas en el mismo
// gráfico, para métricas que comparten unidad.
export default function GatewayMultiLineChart({
  title,
  unit,
  labels,
  series,
  decimals = 0,
}: Props) {
  const screenWidth = Dimensions.get("window").width;
  const chartWidth = screenWidth - 90; // aire para eje Y + padding del card

  const pointCount = labels.length;
  const spacing = pointCount > 1 ? chartWidth / (pointCount - 1) : chartWidth;

  // Mostrar como máximo ~8 etiquetas en el eje X para que no se amontonen,
  // PERO además nunca menos separadas que el ancho real que ocupa una
  // etiqueta corta tipo "00h" (~30px aprox a este tamaño de fuente).
  // Así, en una pantalla angosta se muestran menos etiquetas (sin pisarse)
  // y en una más ancha (tablet, etc.) se pueden mostrar más.
  const MIN_LABEL_SPACING_PX = 30;
  const labelEvery = Math.max(
    1,
    Math.ceil(MIN_LABEL_SPACING_PX / spacing),
    Math.ceil(pointCount / 8),
  );

  const buildDataset = (values: number[]) =>
    values.map((v, i) => ({
      value: v,
      label: i % labelEvery === 0 ? labels[i] : "",
    }));

  const allValues = series.flatMap((s) => s.values);
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 0;
  const finalMax = dataMax > 0 ? dataMax * 1.2 : 10;

  const [primary, secondary, tertiary] = series;

  if (!primary) return null;

  // Armado como variable (no como objeto literal directo en el JSX) a
  // propósito: TypeScript solo hace chequeo estricto de "propiedades de
  // más" sobre literales. Al esparcir una variable, evita el error de
  // "scrollable no existe en LineChartPropsType" que tira la librería
  // aunque la prop funcione bien en runtime — mismo truco que usa
  // SensorChart.tsx con su "commonProps".
  const chartProps = {
    data: buildDataset(primary.values),
    data2: secondary ? buildDataset(secondary.values) : undefined,
    data3: tertiary ? buildDataset(tertiary.values) : undefined,
    color: primary.color,
    color2: secondary?.color,
    color3: tertiary?.color,
    height: 200,
    width: chartWidth,
    spacing,
    initialSpacing: 8,
    endSpacing: 8,
    scrollable: false,
    curved: false,
    thickness: 2,
    thickness2: 2,
    thickness3: 2,
    hideDataPoints: pointCount > 12,
    dataPointsRadius: 2,
    maxValue: finalMax,
    noOfSections: 4,
    yAxisTextStyle: { color: "#888", fontSize: 10 },
    xAxisLabelTextStyle: {
      color: "#666",
      fontSize: 9,
      textAlign: "center" as const,
    },
    xAxisHeight: 26,
    rulesColor: "#f0f0f0",
    rulesType: "solid" as const,
    decimalPlaces: decimals,
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.unit}>Unidad: {unit}</Text>
      </View>

      <View style={styles.chartWrapper}>
        <LineChart {...chartProps} />
      </View>

      {series.length > 1 && (
        <View style={styles.legendRow}>
          {series.map((s) => (
            <View key={s.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={styles.legendText}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 10,
    marginVertical: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    borderWidth: 1,
    borderColor: "#eee",
  },
  headerBlock: {
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.textPrimary,
    textTransform: "uppercase",
  },
  unit: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: "600",
  },
  chartWrapper: { alignItems: "center" },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: Colors.textSecondary, fontWeight: "600" },
});
