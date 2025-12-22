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
import { getSensorById } from "../../../database/SensorRepository";
// ELIMINADO: getLastReadingB01, getLastReadingC01 (Ya no leemos lecturas de SQLite)

import {
  ElectrodeEntity,
  LinearSegment,
  SensorEntity,
} from "../../../database/types";
import { getBatteryColor, getBatteryIcon } from "../../../utils/batteryUtils";
import { calculateMoistureFromSegments } from "../../../utils/calibration";

// --- SUPABASE ---
import { supabase } from "../../../lib/supabase"; // Asegúrate que esta ruta sea correcta

export default function SensorDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const { connectedDevice, sensorData, diagnosisStatus } = useBle();
  const isConnected = !!connectedDevice;

  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);
  const [dbElectrodes, setDbElectrodes] = useState<ElectrodeEntity[]>([]);
  
  // Estado para el último dato (Ahora vendrá de la Nube, no SQLite)
  const [lastReading, setLastReading] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 1. CARGA DE DATOS
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadInitialData = async () => {
        if (!sensorIdStr) return;
        
        try {
          // 1. Configuración y Metadatos siempre locales (para tener alias, calibración, etc.)
          const sensor = await getSensorById(sensorIdStr);
          const electrodes = await getElectrodesBySensor(sensorIdStr);
          
          if (isActive) {
            setDbSensor(sensor);
            setDbElectrodes(electrodes);
          }

          // 2. Si NO estamos conectados por Bluetooth, intentamos bajar el último dato de SUPABASE
          if (!connectedDevice) {
              const typeToCheck = sensor?.type || (sensorIdStr.includes("B01") ? "B01" : "C01");
              const tableName = typeToCheck === 'B01' ? 'readings_b01' : 'readings_c01';

              console.log(`[DASHBOARD] Desconectado. Buscando último dato en NUBE (${tableName})...`);

              const { data, error } = await supabase
                  .from(tableName)
                  .select('*')
                  .eq('sensor_id', sensorIdStr)
                  .order('timestamp', { ascending: false })
                  .limit(1)
                  .single();

              if (isActive) {
                  if (data) {
                      console.log(`[DASHBOARD] ✅ Dato nube encontrado: ${data.timestamp}`);
                      setLastReading(data);
                  } else {
                      console.log(`[DASHBOARD] ☁️ Sin datos en la nube o error:`, error?.message);
                      setLastReading(null); // Esto hará que se muestren las rayitas
                  }
              }
          } else {
              // Si estamos conectados, limpiamos lastReading para priorizar sensorData real
              if (isActive) setLastReading(null);
          }
          
          if (isActive) setLoading(false);

        } catch (error) {
          console.error("Error cargando dashboard", error);
          if (isActive) setLoading(false);
        }
      };

      loadInitialData();

      return () => { isActive = false; };
    }, [sensorIdStr, connectedDevice]) // Agregamos connectedDevice a dependencias para recargar si se desconecta
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

      {/* BANNER OFFLINE / NUBE / SIN DATOS */}
      {!isConnected && (
          <View style={[styles.offlineBanner, !lastReading && { backgroundColor: '#999' }]}>
              <MaterialCommunityIcons name={lastReading ? "cloud-check" : "cloud-off-outline"} size={16} color="#fff" />
              <Text style={styles.offlineText}>
                  {lastReading 
                    ? `Dato Nube: ${formatOfflineDate(lastReading.timestamp)}`
                    : "Desconectado: Sin datos en la Nube."}
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
                  // MODO ONLINE: Datos del BLE Context
                  rawMv = (sensorData[`moisture${idx}` as keyof SensorData] as number) || null;
              } else {
                  // MODO OFFLINE: Datos de Supabase (o null si no hay)
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
                  
                  // Si es null, pasamos 0 pero isNoData se activa
                  voltageMv={rawMv ?? 0} 
                  
                  volumetricMoisture={hv ?? 0}  
                  gravimetricMoisture={hg ?? undefined}
                  
                  // CRUCIAL: Esto mostrará las rayitas si rawMv es null (que sucede si no hay dato en nube)
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
      backgroundColor: "#42A5F5", // Azul Nube
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