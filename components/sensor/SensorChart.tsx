import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { BarChart, LineChart } from "react-native-gifted-charts";
import { Colors } from "../../constants/Colors";

interface Props {
  data: any[];
  type: "line" | "bar";
  unit: string;
  color: string;
  referenceLines?: { value: number; label: string; color: string }[];
  yAxisMax?: number;
  spacing: number;
}

// Helper para dar opacidad a los colores Hex
const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export default function SensorChart({
  data,
  type,
  unit,
  color,
  referenceLines = [],
  yAxisMax,
  spacing,
}: Props) {
  const screenWidth = Dimensions.get("window").width;
  const chartWidth = screenWidth - 70;

  // 1. Sanitización
  const safeData = data.map((d) => ({
    ...d,
    value: typeof d.value === "number" && !isNaN(d.value) ? d.value : 0,
  }));

  // 2. Cálculo de Techo
  const dataMax =
    safeData.length > 0 ? Math.max(...safeData.map((d) => d.value)) : 0;

  let refMax = 0;
  if (referenceLines.length > 0) {
    refMax = Math.max(...referenceLines.map((r) => r.value));
  }

  const calculatedMax = Math.max(dataMax, refMax) * 1.15;
  const finalMaxValue = yAxisMax
    ? Math.max(yAxisMax, calculatedMax)
    : calculatedMax;

  const validColor = color || Colors.primary;

  // Helper para configuración de línea de referencia
  const getLineConfig = (ref: any, isBottomLine: boolean = false) => {
    const colorWithOpacity = hexToRgba(ref.color, 0.7);

    return {
      color: colorWithOpacity,
      thickness: 1,
      dashWidth: 5,
      dashGap: 5,
      labelText: ref.label,
      labelTextStyle: {
        color: colorWithOpacity,
        fontSize: 12,
        fontWeight: "900" as const,
        marginLeft: 5,
        marginTop: -15,
        opacity: 0.7,
      },
      zIndex: 1000,
    };
  };

  const commonProps = {
    height: 220,
    width: chartWidth,
    scrollable: true,
    initialSpacing: 20,
    spacing: spacing,
    endSpacing: 50,

    maxValue: finalMaxValue || 10,
    noOfSections: 5,
    yAxisTextStyle: { color: "#888", fontSize: 10 },

    // Evita cortes en el techo del gráfico
    yAxisOffset: 0,
    overflowTop: 20, // <--- AGREGAR ESTO (Da aire arriba)

    // --- ESTILO DEL EJE X ---
    xAxisLabelTextStyle: {
      color: "#666",
      fontSize: 10,
      textAlign: "center" as const,
      width: 100, // <--- Aumentado un poco para asegurar que entre "DD/MM"
      lineHeight: 12, // <--- Ajustado para que no quede muy separado
    },
    xAxisTextNumberOfLines: 2,
    xAxisHeight: 50, // <--- IMPORTANTE: Altura suficiente para las 2 líneas de texto
    // ------------------------

    rulesColor: "#f0f0f0",
    rulesType: "solid",
    yAxisLabelSuffix: "",

    // --- LÍNEAS DE REFERENCIA ---
    showReferenceLine1: referenceLines.length > 0,
    referenceLine1Position: referenceLines[0]?.value || 0,
    referenceLine1Config: referenceLines[0]
      ? getLineConfig(referenceLines[0])
      : undefined,

    showReferenceLine2: referenceLines.length > 1,
    referenceLine2Position: referenceLines[1]?.value || 0,
    referenceLine2Config: referenceLines[1]
      ? getLineConfig(referenceLines[1])
      : undefined,

    showReferenceLine3: referenceLines.length > 2,
    referenceLine3Position: referenceLines[2]?.value || 0,
    referenceLine3Config: referenceLines[2]
      ? getLineConfig(referenceLines[2], true)
      : undefined,
  };

  return (
    <View style={styles.card}>
      <Text style={styles.unitLabel}>{unit}</Text>

      <View style={styles.chartWrapper}>
        {type === "bar" ? (
          <BarChart
            {...commonProps}
            data={safeData}
            barWidth={Math.max(4, spacing * 0.5)}
            roundedTop
            frontColor={validColor}
            isAnimated={false}
          />
        ) : (
          <LineChart
            {...commonProps}
            data={safeData}
            color={validColor}
            thickness={2.5}
            curved={true}
            curvature={0.2}
            areaChart={true}
            startFillColor={validColor}
            endFillColor="#ffffff"
            startOpacity={0.2}
            endOpacity={0.0}
            isAnimated={false}
            hideDataPoints={spacing < 25}
            dataPointsColor={validColor}
            dataPointsRadius={2}
            initialSpacing={10}
          />
        )}
      </View>
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
    overflow: "hidden",
  },
  chartWrapper: {
    //overflow: "hidden",
    alignItems: 'center', 
    marginTop: 10,
  },
  unitLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textSecondary,
    marginLeft: 15,
    marginBottom: 5,
    textTransform: "uppercase",
  },
});
