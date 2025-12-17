import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Buffer } from "buffer";
import {
    Stack,
    useLocalSearchParams,
    useRouter,
} from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import SensorInfoBar from "../../../components/sensor/SensorInfoBar";
import { BLE_UUIDS } from "../../../constants/BleUUIDs";
import { Colors } from "../../../constants/Colors";
import { useBle } from "../../../context/BleContext";
import { getSensorById } from "../../../database/SensorRepository";
import { SensorEntity } from "../../../database/types";
// Asegúrate de que la ruta sea correcta según donde creaste el archivo
import {
    getBatteryColor,
    getBatteryIcon,
    getBatteryPercentage,
} from "../../../utils/batteryUtils";

// --- HELPER: FORMATO FECHA ARGENTINA ---
const formatDateAR = (isoStringOrTimestamp: string | number) => {
  if (!isoStringOrTimestamp) return "--/-- --:--";

  let date: Date;
  if (typeof isoStringOrTimestamp === "number") {
    date = new Date(isoStringOrTimestamp * 1000);
  } else {
    date = new Date(isoStringOrTimestamp);
  }

  if (isNaN(date.getTime())) return "--/-- --:--";

  return date
    .toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
};

export default function GatewayDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const {
    connectedDevice,
    sensorData,
    diagnosisStatus,
    isBusy,
    disconnectDevice,
  } = useBle();
  const isConnected = !!connectedDevice;
  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);

  // Cargar datos de DB
  useEffect(() => {
    const load = async () => {
      if (sensorIdStr) {
        const data = await getSensorById(sensorIdStr);
        setDbSensor(data);
      }
    };
    load();
  }, [sensorIdStr]);

  useEffect(() => {
    // Al montar no hacemos nada

    return () => {
      // Esto SOLO se ejecuta cuando el componente se destruye (Unmount)
      // En Expo Router, al ir hacia atrás (Back), el componente se desmonta.
      // Al ir "hacia adelante" (a Config), el componente NO se desmonta.
      console.log("[Dashboard] Componente destruido. Desconectando...");
      disconnectDevice();
    };
  }, []);

  // Estados específicos del Gateway
  const wifiStatus = diagnosisStatus.wifiStatus || "UNKNOWN";
  const isWifiOnline = wifiStatus === "ONLINE";
  // Nota: Aquí podrías usar también getBatteryPercentage si quisieras,
  // pero por ahora dejamos el crudo o 0 para la batería del Gateway principal.
  const batteryPercent = isConnected ? sensorData.battery ?? 0 : 0;

  // --- PARSEO DE LISTA DE SENSORES (LORA) ---
  const loraSensors = useMemo(() => {
    if (!diagnosisStatus.sensorsList) return [];
    try {
      const raw = JSON.parse(diagnosisStatus.sensorsList);
      return Object.keys(raw)
        .map((key) => ({
          id: key,
          ...raw[key],
          // raw[key] trae: { type, last, bat, v1, v2, v3 }
        }))
        .sort((a: any, b: any) => b.last - a.last);
    } catch (_) {
      return [];
    }
  }, [diagnosisStatus.sensorsList]);

  // Acción rápida: Forzar Subida
  const handleForceSync = async () => {
    if (!connectedDevice) return;
    try {
      const base64Val = Buffer.from("1").toString("base64");
      await connectedDevice.writeCharacteristicWithResponseForService(
        BLE_UUIDS.SVC_CONFIG,
        BLE_UUIDS.CONFIG.SEND_NOW,
        base64Val
      );
      Alert.alert(
        "Comando Enviado",
        "El Gateway intentará subir los datos pendientes ahora."
      );
    } catch (_) {
      Alert.alert("Error", "No se pudo enviar el comando.");
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER DE ESTADO */}
      <View style={[styles.headerPanel, { paddingTop: 50 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Gateway N01</Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: isConnected
                      ? Colors.success
                      : Colors.error,
                  },
                ]}
              />
              <Text style={styles.headerSub}>
                {isConnected ? "Conectado por BLE" : "Desconectado"}
              </Text>
            </View>
          </View>
          <View style={styles.batteryBadge}>
            <MaterialCommunityIcons
              name="battery"
              size={20}
              color={isConnected ? Colors.success : "#ccc"}
            />
            <Text style={{ fontWeight: "bold", color: "#555" }}>
              {isConnected ? `${batteryPercent}%` : "--"}
            </Text>
          </View>
        </View>
      </View>

      <SensorInfoBar
        id={sensorIdStr}
        alias={dbSensor?.alias || "Cargando..."}
        location={dbSensor?.location || "Sin ubicación"}
        onEditPress={() => router.push(`/gateway/${sensorIdStr}/info`)}
        isOffline={!isConnected}
      />

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ padding: 16 }}
      >
        {/* 1. ESTADO DE RED */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Estado de Conectividad</Text>

          <View style={styles.statusRow}>
            <View style={styles.statusIcon}>
              <MaterialCommunityIcons
                name="wifi"
                size={24}
                color={
                  isWifiOnline
                    ? Colors.success
                    : wifiStatus === "LOCAL"
                    ? Colors.warning
                    : Colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>Conexión WiFi</Text>
              <Text style={styles.statusValue}>{wifiStatus}</Text>
            </View>
          </View>

          <View style={[styles.divider]} />

          <View style={styles.statusRow}>
            <View style={styles.statusIcon}>
              <MaterialCommunityIcons
                name="cloud-upload"
                size={24}
                color={
                  diagnosisStatus.syncStatus === "SENDING"
                    ? Colors.primary
                    : Colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>Sincronización Nube</Text>
              <Text style={styles.statusValue}>
                {diagnosisStatus.syncStatus === "SENDING"
                  ? "Subiendo datos..."
                  : diagnosisStatus.syncStatus || "IDLE"}
              </Text>
              <Text style={styles.lastSync}>
                Última: {formatDateAR(diagnosisStatus.lastSync ?? "")}
              </Text>
            </View>
          </View>
        </View>

        {/* 2. ACCIONES DE CONTROL */}
        <Text style={styles.sectionHeader}>Controles</Text>
        <View style={styles.grid}>
          <TouchableOpacity
            style={[styles.actionCard, !isConnected && styles.disabledCard]}
            disabled={!isConnected}
            onPress={() => router.push(`/gateway/${sensorIdStr}/config`)}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#e8f5e9" }]}>
              <MaterialCommunityIcons
                name="wifi-cog"
                size={28}
                color="#2e7d32"
              />
            </View>
            <Text style={styles.actionTitle}>Configurar WiFi</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, !isConnected && styles.disabledCard]}
            disabled={!isConnected || isBusy}
            onPress={handleForceSync}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#e3f2fd" }]}>
              {diagnosisStatus.syncStatus === "SENDING" ? (
                <ActivityIndicator color={Colors.primary} />
              ) : (
                <MaterialCommunityIcons
                  name="send"
                  size={28}
                  color={Colors.primary}
                />
              )}
            </View>
            <Text style={styles.actionTitle}>Forzar Subida</Text>
          </TouchableOpacity>
        </View>

        {/* 3. SENSORES LORA DETECTADOS */}
        <Text style={styles.sectionHeader}>Sensores en Campo (LoRa)</Text>

        {loraSensors.length === 0 ? (
          <View
            style={[styles.sectionCard, { padding: 20, alignItems: "center" }]}
          >
            <Text style={{ color: "#999", fontStyle: "italic" }}>
              Esperando datos de sensores...
            </Text>
            <Text style={{ color: "#ccc", fontSize: 10, marginTop: 5 }}>
              El Gateway escucha en 915MHz
            </Text>
          </View>
        ) : (
          loraSensors.map((sensor: any) => {
            // --- LÓGICA DE BATERÍA ---
            const batPct = getBatteryPercentage(sensor.bat);
            const batColor = getBatteryColor(batPct);
            const batIcon = getBatteryIcon(batPct); // Necesitas castear si TypeScript se queja, o asegurar que retorna string válido

            return (
              <View key={sensor.id} style={styles.sensorCard}>
                {/* HEADER DE LA TARJETA */}
                <View style={styles.sensorHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialCommunityIcons
                      name={
                        sensor.type === "C01"
                          ? "weather-partly-cloudy"
                          : "sprout"
                      }
                      size={20}
                      color={Colors.primary}
                    />
                    <Text style={styles.sensorId}>{sensor.id}</Text>
                    <View style={styles.sensorTypeBadge}>
                      <Text style={styles.sensorTypeText}>{sensor.type}</Text>
                    </View>
                  </View>
                  <Text style={styles.sensorTime}>
                    {formatDateAR(sensor.last)}
                  </Text>
                </View>

                {/* DATOS DEL SENSOR */}
                <View style={styles.sensorDataRow}>
                  {/* Dato Principal (Temp) */}
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>
                      {sensor.type === "C01" ? "T. Aire" : "T. Suelo"}
                    </Text>
                    <Text style={styles.dataValue}>
                      {sensor.v1 != null
                        ? `${Number(sensor.v1).toFixed(1)}°C`
                        : "--"}
                    </Text>
                  </View>

                  {/* Dato Secundario (Humedad/Otro) */}
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>
                      {sensor.type === "C01" ? "Humedad" : "Hum. (mV)"}
                    </Text>
                    <Text style={styles.dataValue}>
                      {sensor.v2 != null
                        ? sensor.type === "C01"
                          ? `${Number(sensor.v2).toFixed(1)}%`
                          : sensor.v2
                        : "--"}
                    </Text>
                  </View>

                  {/* Batería (UI MEJORADA) */}
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>Batería</Text>

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 2,
                      }}
                    >
                      {/* Icono dinámico */}
                      <MaterialCommunityIcons
                        name={sensor.bat ? (batIcon as any) : "battery-unknown"}
                        size={18}
                        color={sensor.bat ? batColor : "#ccc"}
                      />
                      {/* Porcentaje */}
                      <Text
                        style={[
                          styles.dataValue,
                          {
                            color: sensor.bat ? batColor : "#555",
                            marginTop: 0,
                          },
                        ]}
                      >
                        {sensor.bat ? `${Math.round(batPct)}%` : "--"}
                      </Text>
                    </View>

                    {/* Voltaje pequeño (Opcional) */}
                    {sensor.bat ? (
                      <Text
                        style={{ fontSize: 9, color: "#999", marginTop: 1 }}
                      >
                        {(sensor.bat / 1000).toFixed(2)}V
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f2" },
  headerPanel: {
    backgroundColor: "#fff",
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { fontSize: 24, fontWeight: "bold", color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  batteryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 6,
    borderRadius: 12,
    gap: 4,
  },

  content: { flex: 1 },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
    marginBottom: 15,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "bold",
    color: Colors.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
    textTransform: "uppercase",
  },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 15 },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f9f9f9",
    justifyContent: "center",
    alignItems: "center",
  },
  statusLabel: { fontSize: 14, color: Colors.textSecondary },
  statusValue: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  lastSync: { fontSize: 13, color: "#666", marginTop: 2, fontWeight: "500" },
  divider: { height: 1, backgroundColor: "#eee", marginVertical: 15 },

  grid: { flexDirection: "row", gap: 12, marginBottom: 20 },
  actionCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    elevation: 2,
  },
  disabledCard: { opacity: 0.6, backgroundColor: "#f0f0f0" },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  actionTitle: { fontWeight: "bold", color: Colors.textPrimary, fontSize: 14 },
  actionSub: { color: Colors.textSecondary, fontSize: 12, textAlign: "center" },

  sensorCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#eee",
  },
  sensorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    paddingBottom: 8,
  },
  sensorId: { fontWeight: "bold", fontSize: 16, color: "#333", marginLeft: 6 },
  sensorTypeBadge: {
    backgroundColor: "#e3f2fd",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  sensorTypeText: { fontSize: 10, fontWeight: "bold", color: Colors.primary },
  sensorTime: { fontSize: 12, color: "#888" },

  sensorDataRow: { flexDirection: "row", justifyContent: "space-between" },
  dataItem: { alignItems: "center", flex: 1 },
  dataLabel: { fontSize: 11, color: "#999", textTransform: "uppercase" },
  dataValue: { fontSize: 15, fontWeight: "bold", color: "#444", marginTop: 2 },
});
