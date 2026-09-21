import React, { useCallback, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { BarChart, LineChart } from "react-native-gifted-charts";
import { Colors } from "../../constants/Colors";

interface Props {
  data: any[];
  type: "line" | "bar";
  unit: string;
  color: string;
  referenceLines?: { value: number; label: string; color: string }[];
  yAxisMax?: number;
  spacing?: number;
}

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const MIN_LABEL_SPACING_PX = 48;
const INITIAL_SPACING = 6;
const END_SPACING = 10;
const RIGHT_MARGIN = 16;
const SAFETY_FACTOR = 0.97;
const Y_AXIS_SECTIONS = 5;

const reduceExtreme = (arr: number[], pick: (a: number, b: number) => number) =>
  arr.reduce((acc, v) => pick(acc, v), arr.length ? arr[0] : 0);

export default function SensorChart({
  data,
  type,
  unit,
  color,
  referenceLines = [],
  yAxisMax,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      if (Math.abs(w - containerWidth) > 1) setContainerWidth(w);
    },
    [containerWidth],
  );

  // 1. Sanitización
  const safeData = data.map((d) => {
    const val = typeof d.value === "number" && !isNaN(d.value) ? d.value : 0;
    return {
      ...d,
      value: val,
      min: typeof d.min === "number" && !isNaN(d.min) ? d.min : val,
      max: typeof d.max === "number" && !isNaN(d.max) ? d.max : val,
    };
  });
  const pointCount = safeData.length;

  // 2. Techo del eje Y
  const dataMax =
    safeData.length > 0
      ? reduceExtreme(
          safeData.map((d) => d.max),
          Math.max,
        )
      : 0;
  const refMax =
    referenceLines.length > 0
      ? reduceExtreme(
          referenceLines.map((r) => r.value),
          Math.max,
        )
      : 0;
  const calculatedMax = Math.max(dataMax, refMax) * 1.15;
  const finalMaxValue =
    (yAxisMax ? Math.max(yAxisMax, calculatedMax) : calculatedMax) || 10;

  // 3. Textos del eje Y sin decimales
  const yAxisLabelTexts = Array.from({ length: Y_AXIS_SECTIONS + 1 }, (_, i) =>
    String(Math.round((finalMaxValue / Y_AXIS_SECTIONS) * i)),
  );

  // 4. Ancho del eje Y según cantidad de dígitos
  const yAxisDigits = String(
    Math.max(1, Math.round(Math.abs(finalMaxValue))),
  ).length;
  const yAxisLabelWidth = Math.max(28, yAxisDigits * 7 + 12);

  // 5. Espacio disponible (contenedor menos margen derecho real)
  const renderWidth = Math.max(containerWidth - RIGHT_MARGIN, 0);

  // 6. Ancho del ÁREA DE TRAZADO únicamente (sin el eje Y)
  const plotWidth = Math.max(
    renderWidth - yAxisLabelWidth - INITIAL_SPACING - END_SPACING,
    1,
  );
  const computedSpacing =
    pointCount > 1
      ? Math.max(2, (plotWidth / (pointCount - 1)) * SAFETY_FACTOR)
      : plotWidth;

  // 7. Densidad de etiquetas según el espacio real en píxeles
  const labelEvery =
    pointCount > 1
      ? Math.max(1, Math.ceil(MIN_LABEL_SPACING_PX / computedSpacing))
      : 1;

  const xLabelWidth = Math.min(Math.max(computedSpacing * labelEvery, 44), 90);
  const xAxisLabelStyleRef = {
    current: {
      color: "#666",
      fontSize: 10,
      textAlign: "center" as const,
      width: xLabelWidth,
      lineHeight: 13,
    },
  };
  const xAxisLabelStyle = xAxisLabelStyleRef.current;

  // 8. Etiquetas: para cada punto VISIBLE (según labelEvery), decidimos
  // el texto ACÁ MISMO, en el mismo lugar donde decidimos cuáles
  // puntos se muestran. Antes esta decisión vivía partida entre
  // dataProcessing (qué texto poner) y acá (qué índices mostrar), y un
  // punto con cambio de día que no coincidiera con un índice visible
  // perdía su etiqueta de fecha para siempre. Ahora la fecha SIEMPRE
  // aparece la primera vez que cambia entre dos etiquetas realmente
  // visibles.
  let lastShownDate = "";
  const displayData = safeData.map((d, i) => {
    const show = i % labelEvery === 0 || i === pointCount - 1;
    let label = "";
    if (show) {
      if (d.hourLabel) {
        // Vista horaria: mostramos la hora, y la fecha debajo SOLO
        // cuando cambia respecto de la última etiqueta mostrada.
        if (d.dateLabel !== lastShownDate) {
          label = `${d.hourLabel}\n${d.dateLabel}`;
          lastShownDate = d.dateLabel;
        } else {
          label = d.hourLabel;
        }
      } else {
        // Vista diaria/mensual: directamente la fecha (o el mes).
        label = d.dateLabel;
        lastShownDate = d.dateLabel;
      }
    }
    return { ...d, label, labelTextStyle: xAxisLabelStyleRef.current };
  });

  const maxAreaData = safeData.map((d) => ({ value: d.max }));
  const minAreaData = safeData.map((d) => ({ value: d.min }));
  const hasBand = safeData.some((d) => d.max > d.min);

  const validColor = color || Colors.primary;

  const getLineConfig = (ref: any) => {
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

  const renderPointerLabel = (items: any) => {
    const item = items?.[0];
    if (!item) return null;
    const d = new Date(item.timestamp);
    const dateStr = d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
    const timeStr = d.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <View style={styles.tooltipBox}>
        <Text style={styles.tooltipDate}>
          {dateStr} · {timeStr}
        </Text>
        {item.isInterpolated ? (
          <Text style={styles.tooltipNoData}>Sin datos</Text>
        ) : (
          <>
            <Text style={styles.tooltipValue}>
              {Number(item.value).toFixed(2)} {unit}
            </Text>
            {item.max > item.min && (
              <Text style={styles.tooltipRange}>
                min {Number(item.min).toFixed(2)} · max{" "}
                {Number(item.max).toFixed(2)}
              </Text>
            )}
          </>
        )}
      </View>
    );
  };

  const sharedLayout = {
    height: 220,
    width: plotWidth,
    scrollable: false,
    initialSpacing: INITIAL_SPACING,
    spacing: computedSpacing,
    endSpacing: END_SPACING,
    maxValue: finalMaxValue,
    noOfSections: Y_AXIS_SECTIONS,
    yAxisLabelWidth,
    yAxisOffset: 0,
    overflowTop: 20,
  };

  const axisProps = {
    yAxisTextStyle: styles.yAxisText,
    yAxisLabelTexts,
    xAxisLabelTextStyle: xAxisLabelStyle,
    xAxisTextNumberOfLines: 2,
    xAxisHeight: 46,
    rulesColor: "#f0f0f0",
    rulesType: "solid" as const,
  };

  const maxLayerProps = {
    ...sharedLayout,
    data: maxAreaData,
    color: "transparent",
    thickness: 0,
    hideDataPoints: true,
    areaChart: true,
    curved: true,
    curvature: 0.2,
    startFillColor: validColor,
    endFillColor: validColor,
    startOpacity: 0.18,
    endOpacity: 0.18,
    hideRules: true,
    hideYAxisText: true,
    xAxisColor: "transparent",
    yAxisColor: "transparent",
    disableScroll: true,
  };

  const minLayerProps = {
    ...sharedLayout,
    data: minAreaData,
    color: "transparent",
    thickness: 0,
    hideDataPoints: true,
    areaChart: true,
    curved: true,
    curvature: 0.2,
    startFillColor: "#ffffff",
    endFillColor: "#ffffff",
    startOpacity: 1,
    endOpacity: 1,
    hideRules: true,
    hideYAxisText: true,
    xAxisColor: "transparent",
    yAxisColor: "transparent",
    disableScroll: true,
  };

  const topLayerProps = {
    ...sharedLayout,
    ...axisProps,
    data: displayData,
    color: validColor,
    thickness: 2.5,
    curved: true,
    curvature: 0.2,
    isAnimated: false,
    hideDataPoints: computedSpacing < 15,
    dataPointsColor: validColor,
    dataPointsRadius: 2,
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
      ? getLineConfig(referenceLines[2])
      : undefined,
    pointerConfig: {
      pointerStripHeight: 180,
      pointerStripColor: "#ccc",
      pointerStripWidth: 2,
      pointerColor: validColor,
      radius: 5,
      pointerLabelWidth: 150,
      pointerLabelHeight: 66,
      activatePointersOnLongPress: false,
      autoAdjustPointerLabelPosition: true,
      pointerLabelComponent: renderPointerLabel,
    },
  };

  const barLayerProps = {
    ...sharedLayout,
    ...axisProps,
    data: displayData,
    barWidth: Math.max(4, computedSpacing * 0.5),
    roundedTop: true,
    frontColor: validColor,
    isAnimated: false,
  };

  return (
    <View style={styles.container}>
      <Text style={styles.unitLabel}>{unit}</Text>
      <View style={styles.chartWrapper} onLayout={onLayout}>
        {containerWidth > 0 &&
          (type === "bar" ? (
            <BarChart {...barLayerProps} />
          ) : (
            <View style={{ position: "relative" }}>
              {hasBand && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <LineChart {...maxLayerProps} />
                </View>
              )}
              {hasBand && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <LineChart {...minLayerProps} />
                </View>
              )}
              <LineChart {...topLayerProps} />
            </View>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  chartWrapper: {
    width: "100%",
  },
  unitLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textSecondary,
    marginLeft: 4,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  yAxisText: { color: "#888", fontSize: 10 },
  tooltipBox: {
    backgroundColor: "rgba(30,30,30,0.92)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  tooltipDate: { color: "#ccc", fontSize: 10, marginBottom: 2 },
  tooltipValue: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  tooltipRange: { color: "#bbb", fontSize: 10, marginTop: 2 },
  tooltipNoData: { color: "#ff8a80", fontSize: 12, fontStyle: "italic" },
});
