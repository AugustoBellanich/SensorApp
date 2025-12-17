import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
        if (connectedDevice) {
          await disconnectDevice();
        }

        clearScannedDevices();
        setDisplayList([]);

        // Recargamos DB por si agregaste un sensor nuevo en otra pantalla
        await loadSensorsFromDB();

        timeoutId = setTimeout(() => {
          startScan();
        }, 500);
      };

      onFocus();

      return () => {
        clearTimeout(timeoutId);
        stopScan();
      };
    }, [
      connectedDevice,
      disconnectDevice,
      clearScannedDevices,
      startScan,
      stopScan,
    ])
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
    // Evitamos doble ejecución si ya estamos trabajando
    if (isBusy || isSyncing) return;

    if (item.device) {
      // --- ESCENARIO A: DISPOSITIVO ENCONTRADO POR BLUETOOTH (ONLINE) ---
      try {
        setOnboardingStatus("Conectando BLE...");

        // El nuevo connectToDevice blindado lanzará un error si falla el timeout o se duerme
        await connectToDevice(item.device);

        // Si llegamos aquí, la conexión BLE fue exitosa
        const cleanId = item.id.replace("SEN-", "");

        // Verificamos si ya lo tenemos en la base de datos local (SQLite)
        const existingLocal = await getSensorById(cleanId);

        if (!existingLocal) {
          // Si es un sensor totalmente nuevo para esta App
          console.log(`[Onboarding] Nuevo sensor detectado: ${cleanId}`);
          setOnboardingStatus("Verificando en la Nube...");

          let newSensorData: SensorEntity;
          let isFromCloud = false;

          try {
            // 1. Intentamos ver si el sensor ya existe en Supabase y tenemos permiso
            const { data: cloudDevice, error } = await supabase
              .from("devices")
              .select("*")
              .eq("id", cleanId)
              .single();

            if (cloudDevice && !error) {
              console.log(
                "[Onboarding] Encontrado en nube. Descargando configuración..."
              );
              newSensorData = {
                id: cloudDevice.id,
                alias: cloudDevice.alias,
                type: cloudDevice.type,
                location: cloudDevice.name_farm,
                activity: cloudDevice.activity,
                lat: cloudDevice.lat,
                lng: cloudDevice.lng,
                config_json: JSON.stringify(cloudDevice.config),
                is_synced: 1, // Ya está en la nube
                updated_at: cloudDevice.created_at,
                last_sync: new Date().toISOString(),
              };
              isFromCloud = true;
            } else {
              throw new Error("No existe en nube o acceso denegado");
            }
          } catch (_) {
            // 2. Si no hay internet o el sensor no es nuestro en la nube, lo creamos como local
            console.log(
              "[Onboarding] Creando registro local (Modo Instalador/Offline)."
            );
            const dbType = item.type === "UNKNOWN" ? "B01" : item.type;
            const now = new Date().toISOString();

            newSensorData = {
              id: cleanId,
              alias: item.name,
              type: dbType,
              location: "Sin asignar",
              activity: "Activo",
              config_json: "{}",
              last_sync: now,
              is_synced: 0, // Pendiente de subir. Evita que la limpieza lo borre.
              updated_at: now,
            };
            isFromCloud = false;
          }

          // Guardamos el sensor en SQLite
          await saveSensor(newSensorData, isFromCloud);

          // Si es un sensor nuevo creado localmente, intentamos subirlo a la nube en background
          if (!isFromCloud) {
            syncService
              .pushChanges()
              .catch((e) =>
                console.log(
                  "Push background fallido (normal si es ajeno):",
                  e.message
                )
              );
          }

          // Actualizamos la lista del Home para que aparezca como "Guardado" (con el icono bookmark)
          await loadSensorsFromDB();
        }

        // Finalizamos onboarding y navegamos al Dashboard correspondiente
        setOnboardingStatus(null);

        if (item.type === "N01") {
          router.push(`/gateway/${cleanId}/dashboard`);
        } else {
          router.push(`/sensor/${cleanId}/dashboard`);
        }
      } catch (error: any) {
        // --- MANEJO DE ERRORES DE CONEXIÓN (Sensor dormido, timeout, etc) ---
        setOnboardingStatus(null);
        console.log("Error en el proceso de conexión:", error.message);

        // Solo mostramos alerta si no es un error de "Busy" (evitar alertas duplicadas)
        if (error.message !== "BUSY") {
          // El error de Timeout ya dispara un Alert dentro del BleContext,
          // pero aquí podemos capturar cualquier otro fallo.
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
