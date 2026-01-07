import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { getSensorById, unlinkSensor } from "../../../database/SensorRepository";

import {
  ElectrodeEntity,
  LinearSegment,
  SensorEntity,
} from "../../../database/types";
import { getBatteryColor, getBatteryIcon } from "../../../utils/batteryUtils";
import { calculateMoistureFromSegments } from "../../../utils/calibration";

// --- SUPABASE ---
import { supabase } from "../../../lib/supabase";

export default function SensorDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const { connectedDevice, disconnectDevice, sensorData, diagnosisStatus } = useBle();
  const isConnected = !!connectedDevice;

  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);
  const [dbElectrodes, setDbElectrodes] = useState<ElectrodeEntity[]>([]);
  
  // Estado para el último dato (Nube)
  const [lastReading, setLastReading] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ROL DEL USUARIO
  const [userRole, setUserRole] = useState<string>("viewer"); // Por seguridad, default viewer

  // Helper para permisos
  const canEdit = userRole === 'owner' || userRole === 'editor';

  // 1. CARGA DE DATOS
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadInitialData = async () => {
        if (!sensorIdStr) return;
        
        try {
          // 1. Configuración local
          const sensor = await getSensorById(sensorIdStr);
          const electrodes = await getElectrodesBySensor(sensorIdStr);
          
          if (isActive) {
            setDbSensor(sensor);
            setDbElectrodes(electrodes);
          }

          // 2. Si NO estamos conectados, buscar dato en NUBE
          if (!connectedDevice) {
              const typeToCheck = sensor?.type || (sensorIdStr.includes("B01") ? "B01" : "C01");
              const tableName = typeToCheck === 'B01' ? 'readings_b01' : 'readings_c01';

              const { data, error } = await supabase
                  .from(tableName)
                  .select('*')
                  .eq('sensor_id', sensorIdStr)
                  .order('timestamp', { ascending: false })
                  .limit(1)
                  .single();

              if (isActive) {
                  if (data) {
                      setLastReading(data);
                  } else {
                      setLastReading(null); 
                  }
              }
          } else {
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
    }, [sensorIdStr, connectedDevice]) 
  );

  // 2. VERIFICACIÓN DE ROL
  useEffect(() => {
     const checkRole = async () => {
        if(!dbSensor) return;

        // A. Intentar leer del JSON local primero (rápido)
        try {
            const config = JSON.parse(dbSensor.config_json || '{}');
            if(config.role) setUserRole(config.role);
        } catch {}

        // B. Si hay internet, verificar el rol real en Supabase (seguro)
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data } = await supabase
                .from('sensor_permissions')
                .select('role')
                .eq('device_id', sensorIdStr)
                .eq('user_id', user.id)
                .single();
            
            if (data?.role) {
                setUserRole(data.role);
                // Si el rol cambió respecto al local, sería bueno actualizar SQLite, 
                // pero lo dejamos para el syncService para no complicar este efecto.
            }
        }
     };
     checkRole();
  }, [dbSensor, sensorIdStr]);

  // 3. DESCONEXIÓN AL SALIR
  useEffect(() => {
    return () => {
      if (connectedDevice) {
        console.log("[DASHBOARD] Desmontando vista -> Desconectando...");
        disconnectDevice(); 
      }
    };
  }, []);

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
      if (!electrode || !electrode.equations_json || electrode.equations_json === '[]') return 0;
      try {
          const segments: LinearSegment[] = JSON.parse(electrode.equations_json);
          return calculateMoistureFromSegments(rawMv, segments);
      } catch { return 0; }
  };

  // --- ACCIÓN: DESVINCULAR ---
  const handleUnlinkSensor = () => {
    const isOwner = userRole === 'owner';
    const message = isOwner
      ? "Eres el PROPIETARIO. Si confirmas, perderás el control sobre este sensor y quedará LIBRE para que otro usuario lo registre.\n\nSe borrarán todos los datos de este teléfono."
      : "Se eliminará el sensor de tu lista local y dejarás de tener acceso a sus datos. El propietario seguirá teniendo acceso.";

    Alert.alert(
      isOwner ? "Liberar Sensor" : "Desvincular",
      message,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: isOwner ? "Liberar y Borrar" : "Borrar",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            const result = await unlinkSensor(sensorIdStr);
            setLoading(false);
            
            if (result.success) {
              router.replace("/");
            } else {
              Alert.alert("Error", "No se pudo eliminar: " + result.error);
            }
          },
        },
      ]
    );
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

      {/* BADGE DE ROL */}
       <View style={{ 
          backgroundColor: userRole === 'owner' ? '#e8f5e9' : '#fff3e0', 
          paddingVertical: 4, paddingHorizontal: 16,
          flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6
       }}>
          <MaterialCommunityIcons 
             name={userRole === 'owner' ? "shield-check" : "eye-outline"} 
             size={14} 
             color={userRole === 'owner' ? "#2e7d32" : "#ef6c00"} 
          />
          <Text style={{ 
             fontSize: 12, fontWeight: 'bold', 
             color: userRole === 'owner' ? "#2e7d32" : "#ef6c00",
             textTransform: 'uppercase'
          }}>
             {userRole === 'owner' ? "Administrador (Dueño)" : "Modo Visualizador"}
          </Text>
       </View>

      {/* BARRA INFO (Con restricción de edición) */}
      <SensorInfoBar
        id={sensorIdStr}
        alias={dbSensor?.alias || "Cargando..."}
        location={dbSensor?.location || "Sin ubicación"}
        onEditPress={() => {
            if (canEdit) {
                router.push(`/sensor/${sensorIdStr}/info`);
            } else {
                Alert.alert("Modo Visualizador", "Solo el propietario puede editar la configuración del sensor.");
            }
        }}
        isOffline={!isConnected}
      />

      {/* BANNER OFFLINE / NUBE */}
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
                  voltageMv={rawMv ?? 0} 
                  volumetricMoisture={hv ?? 0}  
                  gravimetricMoisture={hg ?? undefined}
                  isNoData={rawMv === null} 
                  isCalibrated={isCalibrated}
                  texture={electrodeDb?.texture || "Sin definir"}
                  
                  // RESTRICCIÓN DE CALIBRACIÓN
                  onCalibratePress={() => {
                    if (canEdit) {
                        router.push(`/sensor/${sensorIdStr}/calibration?electrode=${idx}`);
                    } else {
                        Alert.alert("Modo Visualizador", "Solo el propietario puede calibrar este electrodo.");
                    }
                  }}
                  disabled={false} // Dejamos habilitado para que se pueda tocar, pero mostramos alerta
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
        <View style={{ marginTop: 20, marginBottom: 40 }}>
          
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

          {/* BOTÓN DATOS EN NUBE */}
          <TouchableOpacity
            style={[styles.actionButton, styles.btnLocal]}
            onPress={() => router.push(`/sensor/${sensorIdStr}/cloud-data`)}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#42A5F5" }]}>
              <MaterialCommunityIcons name="cloud-search" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.btnTitle}>Datos en Nube</Text>
              <Text style={styles.btnSub}>Verificar sincronización remota</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />
          </TouchableOpacity>

          {/* BOTÓN ELIMINAR/LIBERAR */}
          <TouchableOpacity
            style={[styles.actionButton, styles.btnLocal]}
            onPress={handleUnlinkSensor}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#FFEBEE" }]}>
              <MaterialCommunityIcons name="link-variant-off" size={24} color="#D32F2F" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.btnTitle, { color: "#D32F2F" }]}>{userRole === 'owner' ? "Liberar Sensor" : "Eliminar de mi lista"}</Text>
              <Text style={styles.btnSub}>{userRole === 'owner' ? "Desvincular propiedad" : "Borrar copia local"}</Text>
            </View>
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
      backgroundColor: "#42A5F5", 
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
      gap: 8,
  },
  offlineText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  actionButton: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", padding: 14, borderRadius: 12, marginTop: 10, elevation: 2 },
  btnLocal: { marginTop: 10 },
  btnDisabled: { backgroundColor: "#f0f0f0" },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center", marginRight: 12 },
  btnTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  btnSub: { fontSize: 12, color: Colors.textSecondary },
});