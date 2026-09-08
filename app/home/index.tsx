import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Device } from "react-native-ble-plx";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/Colors";
import { useAuth } from "../../context/AuthContext";
import { useBle } from "../../context/BleContext";
import { supabase } from "../../lib/supabase";

// --- DB & SYNC ---
import {
  getAllSensors,
  getSensorById,
  getSensorsPendingSync,
  linkNewSensor,
} from "../../database/SensorRepository";
import { SensorEntity } from "../../database/types";
import { syncService } from "../../services/syncService";

// Variable global para controlar la sincronización por sesión de app
let isSessionSynced = false;

type SensorModelType = "B01" | "C01" | "N01" | "UNKNOWN";

interface SensorItem {
  id: string;
  name: string;
  rssi: number | null;
  isSaved: boolean;
  type: SensorModelType;
  device?: Device;
  location: string;
  cloudStatus: "online" | "warning" | "offline";
  cloudBattery: number | null;
}

// ============================================================
// ESTADO EN LA NUBE
// ------------------------------------------------------------
// Mismo criterio que deviceService.ts en sensor-web: online hasta
// 1.5x el intervalo esperado, warning hasta 4x, offline después.
// Se consulta Supabase directo (gateway_status / readings_*),
// NO el campo local last_sync (no refleja actividad real).
// ============================================================

type CloudStatus = "online" | "warning" | "offline";

interface CloudInfo {
  status: CloudStatus;
  battery: number | null;
}

const OFFLINE_INFO: CloudInfo = { status: "offline", battery: null };

function resolveStatusFromTimestamp(
  iso: string,
  expectedIntervalSec: number,
): CloudStatus {
  const diffMinutes = (Date.now() - new Date(iso).getTime()) / (1000 * 60);
  const expectedMinutes = expectedIntervalSec / 60;

  if (diffMinutes <= expectedMinutes * 1.5) return "online";
  if (diffMinutes <= expectedMinutes * 4) return "warning";
  return "offline";
}

async function fetchCloudInfo(sensor: SensorEntity): Promise<CloudInfo> {
  const cleanId = sensor.id.replace(/^SEN-/i, "").trim();

  if (sensor.type === "N01") {
    const { data, error } = await supabase
      .from("gateway_status")
      .select("last_heartbeat, battery_pct")
      .eq("device_id", cleanId)
      .maybeSingle();

    if (error || !data?.last_heartbeat) return OFFLINE_INFO;

    return {
      status: resolveStatusFromTimestamp(data.last_heartbeat, 5 * 60), // heartbeat cada 5 min
      battery: data.battery_pct ?? null,
    };
  }

  const table = sensor.type === "C01" ? "readings_c01" : "readings_b01";

  const { data, error } = await supabase
    .from(table)
    .select("timestamp, battery_pct")
    .eq("sensor_id", cleanId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.timestamp) return OFFLINE_INFO;

  let configIntervalSec = 1800;
  try {
    const config = JSON.parse(sensor.config_json || "{}");
    configIntervalSec = config.loraInterval ?? config.saveInterval ?? 1800;
  } catch {}

  return {
    status: resolveStatusFromTimestamp(data.timestamp, configIntervalSec),
    battery: data.battery_pct ?? null,
  };
}

function getCloudStatusColor(status: CloudStatus): string {
  switch (status) {
    case "online":
      return Colors.success;
    case "warning":
      return "#f59e0b";
    default:
      return "#ef4444";
  }
}

function getCloudStatusLabel(status: CloudStatus): string {
  switch (status) {
    case "online":
      return "En línea";
    case "warning":
      return "Demorado";
    default:
      return "Sin contacto";
  }
}

function getBatteryColor(battery: number | null): string {
  if (battery == null) return "#999";
  if (battery <= 20) return "#ef4444";
  if (battery <= 50) return "#f59e0b";
  return Colors.success;
}

// --- SUBCOMPONENTE: OVERLAY DE CARGA ---
const LoadingOverlay = ({
  visible,
  message,
}: {
  visible: boolean;
  message: string;
}) => {
  if (!visible) return null;
  return (
    <View style={styles.loadingOverlay}>
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>{message}</Text>
      </View>
    </View>
  );
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    startScan,
    stopScan,
    isScanning,
    isBusy,
    scannedDevices,
    connectToDevice,
    connectedDevice,
    clearScannedDevices,
  } = useBle();

  const { signOut } = useAuth();
  const [displayList, setDisplayList] = useState<SensorItem[]>([]);
  const [savedSensors, setSavedSensors] = useState<SensorEntity[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);
  const [collapsedFarms, setCollapsedFarms] = useState<Record<string, boolean>>(
    {},
  );
  const [cloudInfoMap, setCloudInfoMap] = useState<Record<string, CloudInfo>>(
    {},
  );

  // --- ACCIÓN: CERRAR SESIÓN SEGURA ---
  const handleLogout = async () => {
    let hasPendingData = false;
    try {
      const pendingSensors = await getSensorsPendingSync();
      if (pendingSensors.length > 0) hasPendingData = true;
    } catch {}

    const title = "Cerrar Sesión";
    let message =
      "¿Estás seguro de que quieres salir?\n\nSe borrarán los datos locales de este dispositivo para proteger tu cuenta.";

    if (hasPendingData) {
      message =
        "⚠️ ¡CUIDADO! Tienes datos SIN SINCRONIZAR.\n\nSi cierras sesión ahora, PERDERÁS los cambios que no han subido a la nube.\n\n¿Quieres salir de todos modos?";
    }

    Alert.alert(title, message, [
      { text: "Cancelar", style: "cancel" },
      {
        text: hasPendingData ? "Salir y Perder Datos" : "Salir",
        style: "destructive",
        onPress: async () => {
          try {
            setIsSyncing(true);
            router.replace("/");
            await signOut();
            isSessionSynced = false;
          } catch (e) {
            console.error("Error al salir:", e);
            Alert.alert("Error", "No se pudo cerrar la sesión correctamente.");
          } finally {
            setIsSyncing(false);
          }
        },
      },
    ]);
  };

  const loadSensorsFromDB = async () => {
    try {
      const sensors = await getAllSensors();
      setSavedSensors(sensors);
      console.log(`[Home] Cargados ${sensors.length} sensores de la DB.`);
    } catch (e) {
      console.error("Error cargando DB:", e);
    }
  };

  // --- 1. SINCRONIZACIÓN INICIAL ---
  useEffect(() => {
    const initSync = async () => {
      const localSensors = await getAllSensors();
      setSavedSensors(localSensors);

      if (isSessionSynced) return;

      const needsFullRestore = localSensors.length === 0;

      if (needsFullRestore) {
        setOnboardingStatus("Restaurando tus sensores desde la nube...");
      } else {
        setIsSyncing(true);
      }

      try {
        await syncService.syncAll();

        const updatedSensors = await getAllSensors();
        setSavedSensors(updatedSensors);

        isSessionSynced = true;
        console.log(
          `[Home] Restauración completada. ${updatedSensors.length} sensores recuperados.`,
        );
      } catch (e) {
        console.log("Sync warning:", e);
        Alert.alert(
          "Aviso",
          "No se pudieron recuperar los datos de la nube. Revisa tu conexión.",
        );
      } finally {
        setIsSyncing(false);
        setOnboardingStatus(null);
      }
    };

    initSync();
  }, []);

  // --- 1.1 ESTADO EN LA NUBE (consulta directa a Supabase) ---
  useEffect(() => {
    let active = true;

    const loadCloudInfo = async () => {
      if (savedSensors.length === 0) return;

      const entries = await Promise.all(
        savedSensors.map(async (sensor) => {
          const info = await fetchCloudInfo(sensor);
          return [sensor.id, info] as const;
        }),
      );

      if (active) {
        setCloudInfoMap(Object.fromEntries(entries));
      }
    };

    loadCloudInfo();
    const interval = setInterval(loadCloudInfo, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [savedSensors]);

  // --- 2. GESTIÓN DEL ESCANEO AL ENTRAR ---
  useFocusEffect(
    useCallback(() => {
      let timeoutId: any;

      const onFocus = async () => {
        clearScannedDevices();
        setDisplayList([]);
        await loadSensorsFromDB();

        timeoutId = setTimeout(async () => {
          if (!connectedDevice && !isBusy) {
            console.log("[HOME] Iniciando escaneo seguro...");
            startScan();
          } else {
            console.log("[HOME] BLE Ocupado o Conectado, saltando escaneo.");
          }
        }, 800);
      };

      onFocus();

      return () => {
        clearTimeout(timeoutId);
        stopScan();
      };
    }, [connectedDevice, isBusy, clearScannedDevices, startScan, stopScan]),
  );

  // --- 3. PROCESAMIENTO DE LISTA (BLE + DB) ---
  useEffect(() => {
    const combined: SensorItem[] = scannedDevices.map((device) => {
      const rawName = device.name || device.id;
      const cleanId = rawName.replace(/^SEN-/i, "").trim();
      const known = savedSensors.find(
        (db) => db.id === cleanId || db.id === rawName,
      );

      let detectedType: SensorModelType = "UNKNOWN";
      if (known) {
        detectedType = known.type as SensorModelType;
      } else {
        const upperId = cleanId.toUpperCase();
        if (upperId.includes("N01") || upperId.includes("N02"))
          detectedType = "N01";
        else if (upperId.includes("C01")) detectedType = "C01";
        else if (upperId.includes("B01") || upperId.includes("A01"))
          detectedType = "B01";
      }

      return {
        id: rawName,
        name: known?.alias || cleanId,
        rssi: device.rssi,
        isSaved: !!known,
        type: detectedType,
        device: device,
        location: known?.location || "Sin establecimiento asignado",
        cloudStatus: known
          ? (cloudInfoMap[known.id]?.status ?? "offline")
          : "offline",
        cloudBattery: known ? (cloudInfoMap[known.id]?.battery ?? null) : null,
      };
    });

    savedSensors.forEach((savedSensor) => {
      const isAlreadyListed = combined.find((c) => {
        const cClean = (c.device?.name || c.id).replace(/^SEN-/i, "").trim();
        return cClean === savedSensor.id;
      });
      if (!isAlreadyListed) {
        combined.push({
          id: savedSensor.id,
          name: savedSensor.alias,
          rssi: null,
          isSaved: true,
          type: savedSensor.type as SensorModelType,
          location: savedSensor.location || "Sin establecimiento asignado",
          cloudStatus: cloudInfoMap[savedSensor.id]?.status ?? "offline",
          cloudBattery: cloudInfoMap[savedSensor.id]?.battery ?? null,
        });
      }
    });

    combined.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    setDisplayList(combined);
  }, [scannedDevices, savedSensors, cloudInfoMap]);

  // --- 3.1 AGRUPACIÓN POR ESTABLECIMIENTO ---
  const groupedList = useMemo(() => {
    const groups: Record<string, SensorItem[]> = {};
    displayList.forEach((item) => {
      const farm = item.location || "Sin establecimiento asignado";
      if (!groups[farm]) groups[farm] = [];
      groups[farm].push(item);
    });
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  }, [displayList]);

  const toggleFarm = (farm: string) => {
    setCollapsedFarms((prev) => ({ ...prev, [farm]: !prev[farm] }));
  };

  // --- 4. ACCIÓN: CONECTAR O ENTRAR A DASHBOARD ---
  const handleConnectAction = async (item: SensorItem) => {
    if (isBusy || isSyncing) return;

    if (item.device) {
      try {
        const rawId = item.device.name || item.id;
        const cleanId = rawId.replace(/^SEN-/i, "").trim().toUpperCase();

        const idRegex = /^[A-Z]\d{2}-[A-Z0-9]{6}$/;

        if (!idRegex.test(cleanId)) {
          Alert.alert(
            "Dispositivo No Compatible",
            `"${cleanId}" no es un sensor válido.\n\nDebe cumplir el formato: TIPO-SERIE (Ej: B01-A1B2C3).`,
          );
          return;
        }

        setOnboardingStatus("Conectando...");
        await connectToDevice(item.device);

        const existingLocal = await getSensorById(cleanId);

        if (!existingLocal) {
          setOnboardingStatus("Vinculando...");

          let validatedType: "B01" | "C01" | "N01" = "B01";
          if (cleanId.startsWith("C01")) validatedType = "C01";
          else if (cleanId.startsWith("N01")) validatedType = "N01";

          const result = await linkNewSensor({
            id: cleanId,
            alias: item.name,
            type: validatedType,
            location: "Sin asignar",
            activity: "Nuevo",
            config_json: "{}",
            is_synced: 0,
            updated_at: new Date().toISOString(),
          });

          console.log(`[Home] Resultado vinculación: ${result.status}`);

          if (result.status === "LOCAL_ONLY") {
            Alert.alert(
              "Modo Visor Local",
              "Este sensor pertenece a otro usuario. Podrás ver datos en vivo por Bluetooth, pero no se guardarán en la nube.",
            );
          } else if (result.status === "EDITOR_CONFIRMED") {
            Alert.alert(
              "Sincronizado",
              "Permisos de editor recuperados correctamente.",
            );
          } else if (result.status === "OWNER") {
            // Opcional: Toast o mensaje de éxito sutil
          }

          await loadSensorsFromDB();
        }

        setOnboardingStatus(null);
        setTimeout(() => {
          const route = item.type === "N01" ? "gateway" : "sensor";
          router.push(`/${route}/${cleanId}/dashboard`);
        }, 200);
      } catch (e) {
        console.error(e);
        setOnboardingStatus(null);
        Alert.alert("Error", "No se pudo conectar con el sensor.");
      }
    } else if (item.isSaved) {
      const route = item.type === "N01" ? "gateway" : "sensor";
      router.push(`/${route}/${item.id}/dashboard`);
    }
  };

  const renderItem = ({ item }: { item: SensorItem }) => {
    const meta = {
      B01: {
        icon: "sprout",
        bg: "#e3f2fd",
        color: Colors.primary,
        label: "Suelo (B01)",
      },
      C01: {
        icon: "weather-partly-cloudy",
        bg: "#fff3e0",
        color: Colors.secondary,
        label: "Clima (C01)",
      },
      N01: {
        icon: "router-wireless",
        bg: "#e8f5e9",
        color: "#2e7d32",
        label: "Gateway (N01)",
      },
      UNKNOWN: {
        icon: "developer-board",
        bg: "#f3f4f6",
        color: "#666",
        label: "Desconocido",
      },
    }[item.type] || {
      icon: "developer-board",
      bg: "#f3f4f6",
      color: "#666",
      label: "Desconocido",
    };

    const isOffline = item.rssi === null;

    return (
      <TouchableOpacity
        style={[styles.card, isOffline && styles.cardOffline]}
        onPress={() => handleConnectAction(item)}
      >
        <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
          <MaterialCommunityIcons
            name={meta.icon as any}
            size={24}
            color={meta.color}
          />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.alias}>
            {item.name}{" "}
            {item.isSaved && (
              <MaterialCommunityIcons
                name="bookmark"
                size={14}
                color={Colors.primary}
              />
            )}
          </Text>
          <Text style={styles.subId}>{item.id}</Text>
          <View style={styles.signalRow}>
            {isOffline ? (
              <Text style={styles.offlineText}>Offline (BLE)</Text>
            ) : (
              <Text style={styles.rssiText}>{item.rssi} dBm</Text>
            )}

            <View
              style={[
                styles.cloudDot,
                { backgroundColor: getCloudStatusColor(item.cloudStatus) },
              ]}
            />
            <Text style={styles.cloudStatusText}>
              {getCloudStatusLabel(item.cloudStatus)}
            </Text>

            {item.cloudBattery != null && (
              <Text
                style={[
                  styles.cloudBatteryText,
                  { color: getBatteryColor(item.cloudBattery) },
                ]}
              >
                {" "}
                · {item.cloudBattery}%
              </Text>
            )}
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>MIS SENSORES</Text>
          <Text style={styles.headerSub}>
            {isScanning ? "Buscando..." : "Pausado"}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <MaterialCommunityIcons
              name="logout-variant"
              size={22}
              color="#666"
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.scanningBtn]}
            onPress={() => (isScanning ? stopScan() : startScan())}
          >
            {isScanning ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons name="bluetooth" size={24} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <SectionList
        sections={groupedList}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => (
          <TouchableOpacity
            style={styles.farmHeader}
            onPress={() => toggleFarm(section.title)}
          >
            <MaterialCommunityIcons
              name="office-building-outline"
              size={16}
              color="#555"
            />
            <Text style={styles.farmHeaderText}>
              {section.title} ({section.data.length})
            </Text>
            <MaterialCommunityIcons
              name={
                collapsedFarms[section.title] ? "chevron-right" : "chevron-down"
              }
              size={18}
              color="#999"
            />
          </TouchableOpacity>
        )}
        renderItem={({ item, section }) =>
          collapsedFarms[section.title] ? null : renderItem({ item })
        }
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 40,
        }}
        stickySectionHeadersEnabled={false}
      />
      <LoadingOverlay
        visible={isBusy || isSyncing || !!onboardingStatus}
        message={onboardingStatus || "Cargando..."}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: "#fff",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    elevation: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 15 },
  logoutButton: { padding: 8 },
  appTitle: { fontSize: 24, fontWeight: "bold", color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary },
  scanButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  scanningBtn: { backgroundColor: "#999" },
  farmHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  farmHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
    textTransform: "uppercase",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    elevation: 2,
  },
  cardOffline: { opacity: 0.6 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  cardContent: { flex: 1 },
  alias: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  subId: { fontSize: 12, color: Colors.textSecondary, fontFamily: "monospace" },
  signalRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  rssiText: { fontSize: 12, fontWeight: "bold", color: Colors.success },
  offlineText: { fontSize: 12, color: "#999", fontStyle: "italic" },
  cloudDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: 10,
  },
  cloudStatusText: {
    fontSize: 11,
    color: "#888",
    marginLeft: 4,
  },
  cloudBatteryText: {
    fontSize: 11,
    fontWeight: "bold",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  loadingBox: {
    width: 200,
    padding: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    alignItems: "center",
  },
  loadingText: { marginTop: 12, fontWeight: "bold", textAlign: "center" },
});
