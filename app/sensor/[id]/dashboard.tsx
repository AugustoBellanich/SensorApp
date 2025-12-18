import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
// Asegúrate de importar el componente actualizado abajo
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

// IMPORTAMOS LA LÓGICA MATEMÁTICA CENTRAL
import { calculateMoistureFromSegments } from "../../../utils/calibration";

export default function SensorDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const { connectedDevice, sensorData, diagnosisStatus, disconnectDevice } = useBle();
  const isConnected = !!connectedDevice;

  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);
  const [dbElectrodes, setDbElectrodes] = useState<ElectrodeEntity[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. CARGAR TODO DESDE LA DB
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadInitialData = async () => {
        if (!sensorIdStr) return;
        
        try {
          const sensor = await getSensorById(sensorIdStr);
          const electrodes = await getElectrodesBySensor(sensorIdStr);

          if (isActive) {
            setDbSensor(sensor);
            setDbElectrodes(electrodes);
            setLoading(false);
          }
        } catch (e) {
          console.error("Error cargando dashboard", e);
        }
      };

      loadInitialData();

      return () => { isActive = false; };
    }, [sensorIdStr])
  );

  useEffect(() => {
    return () => {
      // disconnectDevice(); 
    };
  }, [disconnectDevice]);

  const modelType = dbSensor?.type || (sensorIdStr.includes("B01") ? "B01" : "C01");
  const isClimate = modelType === "C01";
  const batteryPercent = isConnected ? sensorData.battery ?? 0 : 0;

  // --- HELPER DE CÁLCULO (CORREGIDO: 2 Argumentos) ---
  const getMoisture = (rawMv: number, electrode?: ElectrodeEntity) => {
      if (!electrode || !electrode.equations_json || electrode.equations_json === '[]') {
          return 0;
      }
      try {
          const segments: LinearSegment[] = JSON.parse(electrode.equations_json);
          return calculateMoistureFromSegments(rawMv, segments);
      } catch (e) {
          console.error("Error calculando humedad:", e);
          return 0;
      }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER DE DIAGNÓSTICO */}
      <View style={[styles.statusPanelContainer, { paddingTop: 50 }]}>
        <View style={styles.modulesRow}>
          <StatusIcon name="sd" active={diagnosisStatus.sdStatus} enabled={diagnosisStatus.sdEnabled} isConnected={isConnected} />
          <StatusIcon name="radio-tower" active={diagnosisStatus.loraStatus} enabled={diagnosisStatus.loraEnabled} isConnected={isConnected} />
          <StatusIcon name="clock-outline" active={diagnosisStatus.rtcStatus !== "ERROR"} enabled={true} warning={diagnosisStatus.rtcStatus === "WARNING"} isConnected={isConnected} />
        </View>
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <MaterialCommunityIcons name={isConnected ? getBatteryIcon(batteryPercent) : "battery-unknown"} size={20} color={isConnected ? getBatteryColor(batteryPercent) : "#ccc"} />
            <Text style={[styles.metricText, { color: isConnected ? getBatteryColor(batteryPercent) : "#ccc" }]}>
              {isConnected ? `${batteryPercent.toFixed(0)}%` : "--"}
            </Text>
          </View>
        </View>
      </View>

      {/* BARRA INFO */}
      <SensorInfoBar
        id={sensorIdStr}
        alias={dbSensor?.alias || "Cargando..."}
        location={dbSensor?.location || "Sin ubicación"}
        onEditPress={() => router.push(`/sensor/${sensorIdStr}/info`)}
        isOffline={!isConnected}
      />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {isClimate ? (
          <View style={styles.rowContainer}>
            <ClimateCard type="temp" value={isConnected ? sensorData.airTemp ?? null : null} />
            <ClimateCard type="hum" value={isConnected ? sensorData.humidity ?? null : null} />
          </View>
        ) : (
          <View>
            {[1, 2, 3].map((idx) => {
              const electrodeDb = dbElectrodes.find((e) => e.electrode_index === idx);
              const rawMv = (sensorData[`moisture${idx}` as keyof SensorData] as number) || 0;

              // 1. Calcular Hv (Volumétrica) - CORREGIDO: solo 2 argumentos
              const hv = isConnected ? getMoisture(rawMv, electrodeDb) : 0;
              
              // 2. Calcular Hg (Gravimétrica) = Hv / Densidad
              const density = electrodeDb?.density || 0;
              const hg = (isConnected && density > 0) ? (hv / density) : 0;
              
              const isCalibrated = !!(electrodeDb && electrodeDb.equations_json && electrodeDb.equations_json !== "[]");

              return (
                <ElectrodeCard
                  key={idx}
                  number={idx as 1 | 2 | 3}
                  depthCm={electrodeDb?.depth || 0}
                  voltageMv={isConnected ? rawMv : 0}
                  
                  volumetricMoisture={hv}  // Hv
                  gravimetricMoisture={hg} // Hg (NUEVO)
                  
                  isCalibrated={isCalibrated}
                  texture={electrodeDb?.texture || "Sin definir"}
                  onCalibratePress={() => {
                    if (isConnected) router.push(`/sensor/${sensorIdStr}/calibration?electrode=${idx}`);
                  }}
                  disabled={!isConnected}
                />
              );
            })}

            <ClimateCard type="temp" label="Temp. Suelo" value={isConnected ? sensorData.soilTemp ?? null : null} />
          </View>
        )}

        {/* BOTONES ACCIÓN */}
        <View style={{ marginTop: 20 }}>
          <TouchableOpacity
            style={[styles.actionButton, !isConnected && styles.btnDisabled]}
            disabled={!isConnected}
            onPress={() => router.push(`/sensor/${sensorIdStr}/${isClimate ? "sd-data-climate" : "sd-data"}`)}
          >
            <View style={[styles.iconCircle, !isConnected && { backgroundColor: "#ccc" }]}>
              <MaterialCommunityIcons name="download" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.btnTitle, !isConnected && { color: "#999" }]}>Descargar Historial SD</Text>
              <Text style={styles.btnSub}>{isConnected ? "Extraer datos del sensor" : "Requiere Bluetooth"}</Text>
            </View>
            {isConnected && <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.btnLocal]}
            onPress={() => router.push(`/sensor/${sensorIdStr}/local-data`)}
          >
            <View style={[styles.iconCircle, { backgroundColor: Colors.secondary }]}>
              <MaterialCommunityIcons name="database-search" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.btnTitle}>Datos en Teléfono</Text>
              <Text style={styles.btnSub}>Historial guardado offline</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const StatusIcon = ({ name, active, enabled, warning, isConnected }: any) => {
  const color = !isConnected ? "#ddd" : warning ? Colors.warning : active ? Colors.success : Colors.primary;
  return (
    <MaterialCommunityIcons name={name} size={22} color={color} style={{ opacity: isConnected ? 1 : 0.3, marginRight: 15 }} />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: "#f2f2f2" },
  scrollContent: { padding: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  rowContainer: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  statusPanelContainer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", paddingBottom: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: "#e0e0e0", elevation: 4, zIndex: 10 },
  modulesRow: { flexDirection: "row" },
  metricsRow: { flexDirection: "row", gap: 20 },
  metricItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metricText: { fontWeight: "bold", fontSize: 15 },
  actionButton: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", padding: 14, borderRadius: 12, marginTop: 10, elevation: 2 },
  btnLocal: { marginTop: 10 },
  btnDisabled: { backgroundColor: "#f0f0f0" },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center", marginRight: 12 },
  btnTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  btnSub: { fontSize: 12, color: Colors.textSecondary },
});