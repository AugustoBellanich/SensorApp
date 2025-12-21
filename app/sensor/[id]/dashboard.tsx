import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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
import { getLastReadingB01, getLastReadingC01 } from "../../../database/ReadingsRepository";
import { getSensorById } from "../../../database/SensorRepository";

import {
  ElectrodeEntity,
  LinearSegment,
  SensorEntity,
} from "../../../database/types";
import { getBatteryColor, getBatteryIcon } from "../../../utils/batteryUtils";
import { calculateMoistureFromSegments } from "../../../utils/calibration"; // Asegúrate que la importación sea correcta

export default function SensorDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const { connectedDevice, sensorData, diagnosisStatus } = useBle();
  const isConnected = !!connectedDevice;

  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);
  const [dbElectrodes, setDbElectrodes] = useState<ElectrodeEntity[]>([]);
  
  // Estado para el último dato guardado (Offline)
  const [lastReading, setLastReading] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 1. CARGA DE DATOS
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadInitialData = async () => {
        if (!sensorIdStr) return;
        
        try {
          const sensor = await getSensorById(sensorIdStr);
          const electrodes = await getElectrodesBySensor(sensorIdStr);
          
          // Determinar tipo (fallback al ID si sensor es null)
          const typeToCheck = sensor?.type || (sensorIdStr.includes("B01") ? "B01" : "C01");
          
          console.log(`[DASHBOARD] Buscando datos locales para ${sensorIdStr} (Tipo: ${typeToCheck})`);

          let lastData = null;
          if (typeToCheck === 'B01') {
             lastData = await getLastReadingB01(sensorIdStr);
          } else {
             lastData = await getLastReadingC01(sensorIdStr);
          }

          if (isActive) {
            setDbSensor(sensor);
            setDbElectrodes(electrodes);
            setLastReading(lastData);
            
            if (lastData) {
                console.log(`[DASHBOARD] ✅ Dato encontrado: ${lastData.timestamp}`);
            } else {
                console.log(`[DASHBOARD] ⚠️ SQLite vacío para este sensor.`);
            }
            
            setLoading(false);
          }
        } catch (error) {
          console.error("Error cargando dashboard", error);
          if (isActive) setLoading(false);
        }
      };

      loadInitialData();

      return () => { isActive = false; };
    }, [sensorIdStr])
  );

  const modelType = dbSensor?.type || (sensorIdStr.includes("B01") ? "B01" : "C01");
  const isClimate = modelType === "C01";

  // --- HELPER BATERÍA ---
  const getDisplayBattery = () => {
      if (isConnected) return sensorData.battery ?? 0;
      if (lastReading?.battery_mv) {
          const v = lastReading.battery_mv / 1000;
          return Math.max(0, Math.min(100, (v - 3.3) / (4.2 - 3.3) * 100));
      }
      return null;
  };
  
  const batteryPercent = getDisplayBattery();

  // --- HELPER HUMEDAD ---
  const getMoisture = (rawMv: number | null, electrode?: ElectrodeEntity) => {
      if (rawMv === null || rawMv === 0) return null;
      
      if (!electrode || !electrode.equations_json || electrode.equations_json === '[]') {
          return 0;
      }
      try {
          const segments: LinearSegment[] = JSON.parse(electrode.equations_json);
          return calculateMoistureFromSegments(rawMv, segments);
      } catch {
          // ESLint Fix: Quitamos la variable 'e' si no la usamos
          return 0;
      }
  };

  const formatOfflineDate = (isoString: string) => {
      if (!isoString) return "";
      const d = new Date(isoString);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
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
            <MaterialCommunityIcons 
                name={getBatteryIcon(batteryPercent || 0)} 
                size={20} 
                color={batteryPercent !== null ? getBatteryColor(batteryPercent) : "#ccc"} 
            />
            <Text style={[styles.metricText, { color: batteryPercent !== null ? getBatteryColor(batteryPercent) : "#ccc" }]}>
              {batteryPercent !== null ? `${batteryPercent.toFixed(0)}%` : "--"}
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

      {/* BANNER OFFLINE / SIN DATOS */}
      {!isConnected && (
          <View style={[styles.offlineBanner, !lastReading && { backgroundColor: '#999' }]}>
              <MaterialCommunityIcons name={lastReading ? "history" : "database-off"} size={16} color="#fff" />
              <Text style={styles.offlineText}>
                  {lastReading 
                    ? `Viendo último dato: ${formatOfflineDate(lastReading.timestamp)}`
                    : "Desconectado: Sin datos recientes en este teléfono."}
              </Text>
          </View>
      )}

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {isClimate ? (
          <View style={styles.rowContainer}>
            <ClimateCard 
                type="temp" 
                value={isConnected ? sensorData.airTemp : (lastReading?.air_temp ?? null)} 
            />
            <ClimateCard 
                type="hum" 
                value={isConnected ? sensorData.humidity : (lastReading?.humidity ?? null)} 
            />
          </View>
        ) : (
          <View>
            {[1, 2, 3].map((idx) => {
              const electrodeDb = dbElectrodes.find((e) => e.electrode_index === idx);
              
              // SELECCIÓN DE DATO:
              let rawMv: number | null = 0;

              if (isConnected) {
                  rawMv = (sensorData[`moisture${idx}` as keyof SensorData] as number) || null;
              } else {
                  if (lastReading) {
                      const key = `e${idx}_mv`; 
                      rawMv = lastReading[key]; 
                  } else {
                      rawMv = null;
                  }
              }

              // Cálculos
              const hv = getMoisture(rawMv, electrodeDb);
              
              let hg: number | null = null;
              if (hv !== null && electrodeDb?.density && electrodeDb.density > 0) {
                  hg = hv / electrodeDb.density;
              }

              const isCalibrated = !!(electrodeDb && electrodeDb.equations_json && electrodeDb.equations_json !== "[]");

              return (
                <ElectrodeCard
                  key={idx}
                  number={idx as 1 | 2 | 3}
                  depthCm={electrodeDb?.depth || 0}
                  
                  // FIX 1: Pasamos 0 si es null para satisfacer TypeScript (number), pero isNoData mandará
                  voltageMv={rawMv ?? 0} 
                  
                  // FIX 2: Pasamos 0 si es null (TypeScript error "number | null" -> "number")
                  volumetricMoisture={hv ?? 0}  
                  
                  // FIX 3: Pasamos undefined si es null (TypeScript error "number | null" -> "number | undefined")
                  gravimetricMoisture={hg ?? undefined}
                  
                  // ESTO ES LO IMPORTANTE: Si rawMv es null, mostramos "--"
                  isNoData={rawMv === null} 
                  
                  isCalibrated={isCalibrated}
                  texture={electrodeDb?.texture || "Sin definir"}
                  onCalibratePress={() => {
                    router.push(`/sensor/${sensorIdStr}/calibration?electrode=${idx}`);
                  }}
                  disabled={false} 
                />
              );
            })}

            <ClimateCard 
                type="temp" 
                label="Temp. Suelo" 
                value={isConnected ? sensorData.soilTemp : (lastReading?.soil_temp ?? null)} 
            />
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
              <Text style={styles.btnSub}>{isConnected ? "Extraer datos del sensor" : "Requiere conexión Bluetooth"}</Text>
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
  
  offlineBanner: {
      backgroundColor: "#FF9800",
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
      gap: 8,
  },
  offlineText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 12,
  },

  actionButton: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", padding: 14, borderRadius: 12, marginTop: 10, elevation: 2 },
  btnLocal: { marginTop: 10 },
  btnDisabled: { backgroundColor: "#f0f0f0" },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center", marginRight: 12 },
  btnTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  btnSub: { fontSize: 12, color: Colors.textSecondary },
});