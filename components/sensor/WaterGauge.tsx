import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WaterStatus } from "../../utils/soilStatus";

interface Props {
  status: WaterStatus;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export default function WaterGauge({ status }: Props) {
  const fillPct = clamp(status.fraction * 100, 0, 100);
  const ccPct = clamp(status.ccFraction * 100, 0, 100);
  const awText = Number.isFinite(status.availableWaterPercent)
    ? ` · ${Math.round(status.availableWaterPercent)}% AW`
    : "";

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${fillPct}%`, backgroundColor: status.barColor },
          ]}
        />
        {/* Marca de Capacidad de Campo dentro de la barra */}
        <View style={[styles.ccMarker, { left: `${ccPct}%` }]} />
      </View>
      <Text style={[styles.label, { color: status.textColor }]}>
        {status.label}
        {awText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 10 },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e2e8f0",
    overflow: "hidden",
    position: "relative",
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 3,
  },
  ccMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(71,85,105,0.6)",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
});
