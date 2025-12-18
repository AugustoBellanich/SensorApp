import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { Colors } from "../../../constants/Colors";
import { SensorData, useBle } from "../../../context/BleContext";

// --- COMPONENTES ---
import ClimateCard from "../../../components/sensor/ClimateCard";
import ElectrodeCard from "../../../components/sensor/ElectrodeCard";
import SensorInfoBar from "../../../components/sensor/SensorInfoBar";

// --- LOGICA Y DB ---
import { getElectrodesBySensor } from "../../../database/ElectrodeRepository";
import { getSensorById } from "../../../database/SensorRepository";
import {
    ElectrodeEntity,
    LinearSegment,
    SensorEntity,
} from "../../../database/types";
import { getBatteryColor, getBatteryIcon } from "../../../utils/batteryUtils";

// Función auxiliar para calcular humedad en tiempo real
const calculateMoisture = (mv: number, equationsJson: string): number => {
  try {
    const segments: LinearSegment[] = JSON.parse(equationsJson);
    if (!segments || segments.length === 0) return 0;

    // Buscar el segmento donde cae el voltaje actual
    const segment = segments.find((s) => mv >= s.minMv && mv <= s.maxMv);
    if (segment) {
      const result = segment.m * mv + segment.b;
      return Math.max(0, Math.min(100, result)); // Limitar 0-100%
    }

    // Si el voltaje es menor al primer segmento (suelo muy seco/aire)
    if (mv < segments[0].minMv) return 0;
    // Si supera el último (saturación total)
    const last = segments[segments.length - 1];
    if (mv > last.maxMv) return last.m * last.maxMv + last.b;

    return 0;
  } catch (e) {
    return 0;
  }
};

export default function SensorDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const { connectedDevice, sensorData, diagnosisStatus, disconnectDevice } =
    useBle();
  const isConnected = !!connectedDevice;

  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);
  const [dbElectrodes, setDbElectrodes] = useState<ElectrodeEntity[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. CARGAR TODO DESDE LA DB (Offline First)
  useEffect(() => {
    const loadInitialData = async () => {
      if (sensorIdStr) {
        const [sensor, electrodes] = await Promise.all([
          getSensorById(sensorIdStr),
          getElectrodesBySensor(sensorIdStr),
        ]);
        setDbSensor(sensor);
        setDbElectrodes(electrodes);
        setLoading(false);
      }
    };
    loadInitialData();
  }, [sensorIdStr]);

  useEffect(() => {
    return () => {
      disconnectDevice();
    };
  }, [disconnectDevice]);

  const modelType =
    dbSensor?.type || (sensorIdStr.includes("B01") ? "B01" : "C01");
  const isClimate = modelType === "C01";

  // Batería procesada con utilidad real
  const batteryPercent = isConnected ? sensorData.battery ?? 0 : 0;

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 1. HEADER DE DIAGNÓSTICO */}
      <View style={[styles.statusPanelContainer, { paddingTop: 50 }]}>
        <View style={styles.modulesRow}>
          <StatusIcon
            name="sd"
            active={diagnosisStatus.sdStatus}
            enabled={diagnosisStatus.sdEnabled}
            isConnected={isConnected}
          />
          <StatusIcon
            name="radio-tower"
            active={diagnosisStatus.loraStatus}
            enabled={diagnosisStatus.loraEnabled}
            isConnected={isConnected}
          />
          <StatusIcon
            name="clock-outline"
            active={diagnosisStatus.rtcStatus !== "ERROR"}
            enabled={true}
            warning={diagnosisStatus.rtcStatus === "WARNING"}
            isConnected={isConnected}
          />
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <MaterialCommunityIcons
              // getBatteryIcon espera un número 0-100, así que batteryPercent (85) funcionará perfecto
              name={
                isConnected ? getBatteryIcon(batteryPercent) : "battery-unknown"
              }
              size={20}
              color={isConnected ? getBatteryColor(batteryPercent) : "#ccc"}
            />
            <Text
              style={[
                styles.metricText,
                {
                  color: isConnected ? getBatteryColor(batteryPercent) : "#ccc",
                },
              ]}
            >
              {isConnected ? `${batteryPercent.toFixed(0)}%` : "--"}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. BARRA DE IDENTIFICACIÓN */}
      <SensorInfoBar
        id={sensorIdStr}
        alias={dbSensor?.alias || "Cargando..."}
        location={dbSensor?.location || "Sin ubicación"}
        onEditPress={() => router.push(`/sensor/${sensorIdStr}/info`)}
        isOffline={!isConnected}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {isClimate ? (
          /* VISTA CLIMA (C01) */
          <View style={styles.rowContainer}>
            <ClimateCard
              type="temp"
              value={isConnected ? sensorData.airTemp ?? null : null}
            />
            <ClimateCard
              type="hum"
              value={isConnected ? sensorData.humidity ?? null : null}
            />
          </View>
        ) : (
          /* VISTA SUELO (B01) */
          <View>
            {[1, 2, 3].map((idx) => {
              const electrodeDb = dbElectrodes.find(
                (e) => e.electrode_index === idx
              );
              const rawMv =
                (sensorData[`moisture${idx}` as keyof SensorData] as number) ||
                0;

              const hv =
                isConnected && electrodeDb
                  ? calculateMoisture(rawMv, electrodeDb.equations_json)
                  : 0;
              const isCalibrated = !!(
                electrodeDb &&
                electrodeDb.equations_json &&
                electrodeDb.equations_json !== "[]"
              );

              return (
                <ElectrodeCard
                  key={idx}
                  number={idx as 1 | 2 | 3}
                  depthCm={electrodeDb?.depth || 0}
                  voltageMv={isConnected ? rawMv : 0}
                  volumetricMoisture={hv}
                  isCalibrated={isCalibrated}
                  texture={electrodeDb?.texture || "Sin definir"} // Ahora sí existe en Props
                  onCalibratePress={() => {
                    if (isConnected)
                      router.push(
                        `/sensor/${sensorIdStr}/calibration?electrode=${idx}`
                      );
                  }}
                  disabled={!isConnected}
                />
              );
            })}

            <ClimateCard
              type="temp"
              label="Temp. Suelo" // Ahora sí existe en Props
              value={isConnected ? sensorData.soilTemp ?? null : null}
            />
          </View>
        )}

        {/* 4. ACCIONES */}
        <View style={{ marginTop: 20 }}>
          <TouchableOpacity
            style={[styles.actionButton, !isConnected && styles.btnDisabled]}
            disabled={!isConnected}
            onPress={() =>
              router.push(
                `/sensor/${sensorIdStr}/${
                  isClimate ? "sd-data-climate" : "sd-data"
                }`
              )
            }
          >
            <View
              style={[
                styles.iconCircle,
                !isConnected && { backgroundColor: "#ccc" },
              ]}
            >
              <MaterialCommunityIcons name="download" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.btnTitle, !isConnected && { color: "#999" }]}
              >
                Descargar Historial SD
              </Text>
              <Text style={styles.btnSub}>
                {isConnected
                  ? "Extraer datos del sensor"
                  : "Requiere Bluetooth"}
              </Text>
            </View>
            {isConnected && (
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color="#ccc"
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.btnLocal]}
            onPress={() => router.push(`/sensor/${sensorIdStr}/local-data`)}
          >
            <View
              style={[styles.iconCircle, { backgroundColor: Colors.secondary }]}
            >
              <MaterialCommunityIcons
                name="database-search"
                size={24}
                color="#fff"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.btnTitle}>Datos en Teléfono</Text>
              <Text style={styles.btnSub}>Historial guardado offline</Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color="#ccc"
            />
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const StatusIcon = ({ name, active, enabled, warning, isConnected }: any) => {
  const color = !isConnected
    ? "#ddd"
    : warning
    ? Colors.warning
    : active
    ? Colors.success
    : Colors.primary;
  return (
    <MaterialCommunityIcons
      name={name}
      size={22}
      color={color}
      style={{ opacity: isConnected ? 1 : 0.3, marginRight: 15 }}
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: "#f2f2f2" },
  scrollContent: { padding: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  rowContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  statusPanelContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    elevation: 4,
    zIndex: 10,
  },
  modulesRow: { flexDirection: "row" },
  metricsRow: { flexDirection: "row", gap: 20 },
  metricItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metricText: { fontWeight: "bold", fontSize: 15 },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    marginTop: 10,
    elevation: 2,
  },
  btnLocal: { marginTop: 10 },
  btnDisabled: { backgroundColor: "#f0f0f0" },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  btnTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  btnSub: { fontSize: 12, color: Colors.textSecondary },
});
