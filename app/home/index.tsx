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
  linkNewSensor,
} from "../../database/SensorRepository";
import { SensorEntity } from "../../database/types";
import { syncService } from "../../services/syncService";

// --- SUPABASE ---
import { supabase } from "../../lib/supabase";

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

  const [displayList, setDisplayList] = useState<SensorItem[]>([]);
  const [savedSensors, setSavedSensors] = useState<SensorEntity[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);

  // --- ACCIÓN: CERRAR SESIÓN ---
  const handleLogout = () => {
    Alert.alert("Cerrar Sesión", "¿Estás seguro de que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: async () => {
          try {
            setIsSyncing(true);
            await supabase.auth.signOut();
            isSessionSynced = false;
            // Si tu pantalla de login no es "/", cambia esto por la ruta correcta
            router.replace("/");
          } catch {
            Alert.alert("Error", "No se pudo cerrar la sesión.");
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
      if (isSessionSynced) {
        await loadSensorsFromDB();
        return;
      }
      setIsSyncing(true);
      try {
        await syncService.syncAll();
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

  // --- 2. GESTIÓN DEL ESCANEO AL ENTRAR ---
  useFocusEffect(
    useCallback(() => {
      let timeoutId: any;

      const onFocus = async () => {
        // 1. Limpieza UI
        clearScannedDevices();
        setDisplayList([]);
        await loadSensorsFromDB();

        // 2. Lógica de seguridad para iniciar escaneo
        // Esperamos un poco más para asegurar que el BLE stack esté libre tras la desconexión
        timeoutId = setTimeout(async () => {
          // Verificar explícitamente que NO estamos conectados ni ocupados
          // A veces connectedDevice tarda en ser null, verificamos isBusy también
          if (!connectedDevice && !isBusy) {
            console.log("[HOME] Iniciando escaneo seguro...");
            startScan();
          } else {
            console.log("[HOME] BLE Ocupado o Conectado, saltando escaneo.");
            // Opcional: Podrías forzar un disconnect aquí si detectas un estado inconsistente
          }
        }, 800); // Aumenté el tiempo de 500 a 800ms para dar aire al Garbage Collector
      };

      onFocus();

      return () => {
        clearTimeout(timeoutId);
        stopScan();
      };
    }, [connectedDevice, isBusy, clearScannedDevices, startScan, stopScan])
  );

  // --- 3. PROCESAMIENTO DE LISTA (BLE + DB) ---
  useEffect(() => {
    const combined: SensorItem[] = scannedDevices.map((device) => {
      const rawName = device.name || device.id;
      const cleanId = rawName.replace(/^SEN-/i, "").trim();
      const known = savedSensors.find(
        (db) => db.id === cleanId || db.id === rawName
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
        });
      }
    });

    combined.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    setDisplayList(combined);
  }, [scannedDevices, savedSensors]);

  // --- 4. ACCIÓN: CONECTAR O ENTRAR A DASHBOARD ---
  const handleConnectAction = async (item: SensorItem) => {
    if (isBusy || isSyncing) return;

    if (item.device) {
      try {
        setOnboardingStatus("Conectando...");
        await connectToDevice(item.device);

        const rawId = item.device.name || item.id;
        const cleanId = rawId.replace("SEN-", "").trim();

        // --- AQUÍ CORREGIMOS EL ERROR DE DUPLICADO ---
        // Verificamos una sola vez si existe localmente
        const existingLocal = await getSensorById(cleanId);

        if (!existingLocal) {
          setOnboardingStatus("Vinculando...");

          const validatedType: "B01" | "C01" | "N01" =
            item.type === "UNKNOWN" ? "B01" : item.type;

          // USAMOS LA NUEVA FUNCIÓN DEL REPO
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

          // Feedback al usuario según el resultado
          if (result.status === "LOCAL_ONLY") {
            Alert.alert("Modo Local", result.message);
          } else if (result.status === "EDITOR_CONFIRMED") {
            Alert.alert("Sincronizado", result.message);
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
        Alert.alert("Error", "No se pudo conectar.");
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
              <Text style={styles.offlineText}>Offline</Text>
            ) : (
              <Text style={styles.rssiText}>{item.rssi} dBm</Text>
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

      <FlatList
        data={displayList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
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
