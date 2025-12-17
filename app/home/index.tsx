import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Device } from "react-native-ble-plx";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/Colors";
import { useBle } from "../../context/BleContext";

// --- DB & SYNC ---
import {
  getAllSensors,
  getSensorById,
  saveSensor,
} from "../../database/SensorRepository";
import { SensorEntity } from "../../database/types";
import { supabase } from "../../lib/supabase";
import { syncService } from "../../services/syncService";

// --- VARIABLE DE CONTROL DE SESIÓN ---
// Al estar fuera del componente, mantiene su valor aunque navegues entre pantallas.
// Solo se reinicia si cierras la app completamente.
let isSessionSynced = false;

// Tipos de Sensores Soportados
type SensorModelType = "B01" | "C01" | "N01" | "UNKNOWN";

interface SensorItem {
  id: string;
  name: string;
  rssi: number | null;
  isSaved: boolean;
  type: SensorModelType;
  device?: Device;
}

// --- OVERLAY ---
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
    disconnectDevice,
    clearScannedDevices,
  } = useBle();

  const [displayList, setDisplayList] = useState<SensorItem[]>([]);
  const [savedSensors, setSavedSensors] = useState<SensorEntity[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);

  // --- DETECCIÓN INTELIGENTE DE TIPO ---
  const getSensorType = (id: string): SensorModelType => {
    const upperId = id.toUpperCase();
    if (upperId.includes("B01") || upperId.includes("A01")) return "B01";
    if (upperId.includes("C01")) return "C01";
    if (upperId.includes("N01") || upperId.includes("N02")) return "N01";
    return "UNKNOWN";
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

  // --- 1. SINCRONIZACIÓN INTELIGENTE (SOLO UNA VEZ POR SESIÓN) ---
  useEffect(() => {
    const initSync = async () => {
      // Si ya sincronizamos en esta sesión, NO hacemos nada pesado.
      // Solo cargamos los datos locales y salimos.
      if (isSessionSynced) {
        console.log("✅ Sesión ya sincronizada. Cargando datos locales...");
        await loadSensorsFromDB();
        return;
      }

      // Si es la primera vez que abrimos la app...
      setIsSyncing(true);
      try {
        console.log(
          "🔄 Iniciando Sincronización Inicial (Push + Pull + Limpieza)..."
        );
        await syncService.syncAll();

        // Marcamos que ya se hizo, para que no se repita al volver al Home
        isSessionSynced = true;

        await loadSensorsFromDB();
      } catch (e) {
        console.log("Sync warning:", e);
      } finally {
        setIsSyncing(false);
      }
    };

    initSync();
  }, []);

  // --- 2. GESTIÓN DEL FOCO (INICIA ESCANEO + RECARGA LOCAL) ---
  // Cada vez que miras la pantalla, refresca la lista LOCAL, pero no llama a la nube.
  useFocusEffect(
    useCallback(() => {
      let timeoutId: any;

      const onFocus = async () => {
        if (connectedDevice && !isBusy) {
          // await disconnectDevice();
        }

        clearScannedDevices();
        setDisplayList([]);
        await loadSensorsFromDB();

        timeoutId = setTimeout(() => {
          if (!connectedDevice && !isBusy) {
            startScan();
          }
        }, 500);
      };

      onFocus();

      return () => {
        clearTimeout(timeoutId);
        stopScan();
      };
    }, [connectedDevice, isBusy])
  );

  // --- 3. MERGE: BLE + DB ---
  useEffect(() => {
    const combined: SensorItem[] = scannedDevices.map((device) => {
      const uniqueId = device.name || device.id;
      const cleanId = uniqueId.replace("SEN-", "");
      const known = savedSensors.find(
        (db) => db.id === cleanId || db.id === uniqueId
      );

      return {
        id: uniqueId,
        name: known?.alias || device.name || "Sensor Nuevo",
        rssi: device.rssi,
        isSaved: !!known,
        type: (known?.type as SensorModelType) || getSensorType(uniqueId),
        device: device,
      };
    });

    savedSensors.forEach((savedSensor) => {
      const isAlreadyListed = combined.find(
        (c) => c.id.replace("SEN-", "") === savedSensor.id
      );

      if (!isAlreadyListed) {
        combined.push({
          id: savedSensor.id,
          name: savedSensor.alias,
          rssi: null,
          isSaved: true,
          type: savedSensor.type as SensorModelType,
        });
      }
    });

    combined.sort((a, b) => {
      const rssiA = a.rssi ?? -999;
      const rssiB = b.rssi ?? -999;
      return rssiB - rssiA;
    });

    setDisplayList(combined);
  }, [scannedDevices, savedSensors]);

  // --- 4. ACCIÓN PRINCIPAL: ONBOARDING ---
  const handleConnectAction = async (item: SensorItem) => {
    if (isBusy || isSyncing) return;

    if (item.device) {
      try {
        setOnboardingStatus("Conectando BLE...");
        await connectToDevice(item.device);

        // --- PUNTO CRÍTICO ---
        // Usamos el nombre del sensor (ej: SEN-N01-25104E) si existe,
        // sino la MAC. Queremos el ID limpio (N01-25104E).
        const rawId = item.device.name || item.id;
        const cleanId = rawId.replace("SEN-", "");

        console.log(`[DEBUG] ID Detectado: ${rawId} -> ID Limpio: ${cleanId}`);

        setOnboardingStatus("Verificando registro...");
        const existingLocal = await getSensorById(cleanId);

        if (!existingLocal) {
          setOnboardingStatus("Consultando Nube...");
          try {
            const { data: cloudDevice, error } = await supabase
              .from("devices")
              .select("*")
              .eq("id", cleanId)
              .single();

            if (cloudDevice && !error) {
              console.log("[DEBUG] Sensor encontrado en Supabase.");
              await saveSensor(
                {
                  id: cloudDevice.id,
                  alias: cloudDevice.alias,
                  type: cloudDevice.type,
                  location: cloudDevice.name_farm,
                  activity: cloudDevice.activity,
                  lat: cloudDevice.lat,
                  lng: cloudDevice.lng,
                  config_json: JSON.stringify(cloudDevice.config),
                  is_synced: 1,
                  updated_at: cloudDevice.created_at,
                  last_sync: new Date().toISOString(),
                },
                true
              );
            } else {
              console.log(
                "[DEBUG] No está en nube o error RLS. Creando local..."
              );
              throw new Error("NOT_IN_CLOUD");
            }
          } catch (e) {
            // Si no está en la nube, lo creamos local igual para no trabar al usuario
            const now = new Date().toISOString();
            await saveSensor(
              {
                id: cleanId,
                alias: item.name,
                type: item.type === "UNKNOWN" ? "N01" : item.type,
                location: "Sin asignar",
                activity: "Activo",
                config_json: "{}",
                is_synced: 0,
                updated_at: now,
                last_sync: now,
              },
              false
            );
          }
          await loadSensorsFromDB();
        }

        // --- NAVEGACIÓN ---
        setOnboardingStatus(null);
        console.log(`[DEBUG] Navegando a dashboard de ${cleanId}`);

        // Usar setTimeout para dar tiempo a que los estados de BLE se asienten
        setTimeout(() => {
          if (item.type === "N01") {
            router.push(`/gateway/${cleanId}/dashboard`);
          } else {
            router.push(`/sensor/${cleanId}/dashboard`);
          }
        }, 100);
      } catch (error: any) {
        setOnboardingStatus(null);
        console.error("[DEBUG] Error en handleConnectAction:", error);

        // IMPORTANTE: Solo desconectamos si el error es realmente de BLE.
        // Si el error fue de navegación o de base de datos, quizás no queremos desconectar.
        if (
          error.message.includes("BLE") ||
          error.message.includes("TIMEOUT")
        ) {
          await disconnectDevice();
          Alert.alert(
            "Error",
            "No se pudo establecer comunicación con el sensor."
          );
        }
      }
    } else if (item.isSaved) {
      // --- ESCENARIO B: EL SENSOR NO ESTÁ CERCA PERO ESTÁ EN EL HISTORIAL ---
      if (item.type === "N01") {
        router.push(`/gateway/${item.id}/dashboard`);
      } else {
        router.push(`/sensor/${item.id}/dashboard`);
      }
    }
  };

  const renderItem = ({ item }: { item: SensorItem }) => {
    const type = item.type;
    const isOffline = item.rssi === null;
    const typeMap: Record<
      string,
      { icon: string; bg: string; iconColor: string; label: string }
    > = {
      B01: {
        icon: "sprout",
        bg: "#e3f2fd",
        iconColor: Colors.primary,
        label: "Sensor Suelo (B01)",
      },
      C01: {
        icon: "weather-partly-cloudy",
        bg: "#fff3e0",
        iconColor: Colors.secondary,
        label: "Estación Climática (C01)",
      },
      N01: {
        icon: "router-wireless",
        bg: "#e8f5e9",
        iconColor: "#2e7d32",
        label: "Gateway LoRa (N01)",
      },
      UNKNOWN: {
        icon: "chip-outline",
        bg: "#f3f4f6",
        iconColor: Colors.textSecondary,
        label: "Dispositivo Desconocido",
      },
    };
    const meta = typeMap[type] || typeMap.UNKNOWN;
    let signalColor = Colors.textSecondary;
    if (!isOffline && item.rssi != null) {
      if (item.rssi > -70) signalColor = Colors.success;
      else if (item.rssi > -85) signalColor = Colors.warning;
      else signalColor = Colors.error;
    }
    const disabled = (!item.isSaved && isOffline) || isBusy || isSyncing;

    return (
      <TouchableOpacity
        style={[styles.card, isOffline && styles.cardOffline]}
        onPress={() => handleConnectAction(item)}
        disabled={disabled}
      >
        <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
          <MaterialCommunityIcons
            name={meta.icon as any}
            size={24}
            color={meta.iconColor}
            style={{ opacity: isOffline ? 0.5 : 1 }}
          />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.alias}>
            {item.name}
            {item.isSaved && (
              <MaterialCommunityIcons
                name="bookmark"
                size={14}
                color={Colors.primary}
                style={{ marginLeft: 4 }}
              />
            )}
          </Text>
          <Text style={styles.subId}>{item.id}</Text>
          <Text
            style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}
          >
            {meta.label}
          </Text>
          <View style={styles.signalRow}>
            {isOffline ? (
              <Text style={styles.offlineText}>
                • Sin señal (Historial Offline)
              </Text>
            ) : (
              <>
                <MaterialCommunityIcons
                  name="signal"
                  size={14}
                  color={signalColor}
                />
                <Text style={[styles.rssiText, { color: signalColor }]}>
                  {" "}
                  {item.rssi} dBm
                </Text>
                {!item.isSaved && <Text style={styles.newTag}>• NUEVO</Text>}
              </>
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
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.headerSub}>
              {isScanning ? "Buscando dispositivos..." : "Escaneo pausado"}
            </Text>
            {isSyncing && (
              <ActivityIndicator
                size="small"
                color={Colors.primary}
                style={{ marginLeft: 10 }}
              />
            )}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.scanButton, isScanning && styles.scanningBtn]}
          onPress={() => {
            if (isBusy || isSyncing) return;
            if (isScanning) stopScan();
            else {
              clearScannedDevices();
              startScan();
            }
          }}
        >
          {isScanning ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <MaterialCommunityIcons name="bluetooth" size={24} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="bluetooth-off"
              size={48}
              color="#ccc"
            />
            <Text style={styles.emptyText}>
              {isScanning
                ? "Esperando sensores..."
                : "No se encontraron sensores cercanos."}
            </Text>
            {!isScanning && savedSensors.length === 0 && (
              <Text style={{ fontSize: 12, color: "#aaa", marginTop: 5 }}>
                Pulsa el botón Bluetooth para buscar
              </Text>
            )}
          </View>
        }
      />
      <LoadingOverlay
        visible={isBusy || isSyncing || !!onboardingStatus}
        message={
          onboardingStatus || (isSyncing ? "Sincronizando..." : "Conectando...")
        }
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
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  appTitle: { fontSize: 24, fontWeight: "bold", color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  scanButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
  },
  scanningBtn: { backgroundColor: Colors.textSecondary },
  emptyState: { alignItems: "center", marginTop: 60 },
  emptyText: { color: "#888", marginTop: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardOffline: { opacity: 0.7, backgroundColor: "#f9f9f9" },
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
  subId: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: "monospace",
    marginVertical: 2,
  },
  signalRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  rssiText: { fontSize: 12, fontWeight: "bold", marginLeft: 4 },
  offlineText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontStyle: "italic",
  },
  newTag: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: "bold",
    marginLeft: 6,
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
    width: 220,
    padding: 24,
    backgroundColor: "#fff",
    borderRadius: 16,
    alignItems: "center",
    elevation: 10,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
    textAlign: "center",
  },
});
