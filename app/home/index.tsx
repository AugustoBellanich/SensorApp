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

// --- DB REPOSITORY ---
import { getAllSensors, saveSensor } from "../../database/SensorRepository";
import { SensorEntity } from "../../database/types";

// Tipos de Sensores Soportados
type SensorModelType = 'B01' | 'C01' | 'N01' | 'UNKNOWN';

interface SensorItem {
  id: string;         
  name: string;       
  rssi: number | null; 
  isSaved: boolean;   
  type: SensorModelType; 
  device?: Device;    
}

// --- OVERLAY ---
const LoadingOverlay = ({ visible, message }: { visible: boolean, message: string }) => {
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
    clearScannedDevices 
  } = useBle();

  const [displayList, setDisplayList] = useState<SensorItem[]>([]);
  const [savedSensors, setSavedSensors] = useState<SensorEntity[]>([]); 

  // --- DETECCIÓN INTELIGENTE DE TIPO ---
  const getSensorType = (id: string): SensorModelType => {
    const upperId = id.toUpperCase();
    if (upperId.includes('B01') || upperId.includes('A01')) return 'B01'; // A01 se comporta similar a B01 por ahora
    if (upperId.includes('C01')) return 'C01';
    if (upperId.includes('N01') || upperId.includes('N02')) return 'N01'; // Gateways
    return 'UNKNOWN';
  };

  const loadSensorsFromDB = async () => {
      const sensors = await getAllSensors();
      setSavedSensors(sensors);
      console.log(`[Home] Cargados ${sensors.length} sensores de la DB.`);
  };

  // --- GESTIÓN DEL FOCO ---
  useFocusEffect(
    useCallback(() => {
      console.log("--> Home Enfocado");
      let timeoutId: any; 

      timeoutId = setTimeout(() => {
          if (connectedDevice) {
              console.log("[Home] Dispositivo detectado al volver. Desconectando...");
              disconnectDevice();
          }

          clearScannedDevices();
          setDisplayList([]); 
          loadSensorsFromDB(); 
          startScan();
      }, 100);

      return () => {
        console.log("<-- Saliendo de Home");
        clearTimeout(timeoutId);
        stopScan();
      };
    }, [connectedDevice, disconnectDevice, clearScannedDevices, startScan, stopScan]) 
  );

  // --- MERGE: BLE + DB ---
  useEffect(() => {
    const combined: SensorItem[] = scannedDevices.map(device => {
      const uniqueId = device.name || device.id;
      const known = savedSensors.find(db => db.id === uniqueId);
      
      return {
        id: uniqueId,
        name: known?.alias || device.name || 'Sensor Nuevo', 
        rssi: device.rssi,
        isSaved: !!known,
        type: getSensorType(uniqueId),
        device: device 
      };
    });

    savedSensors.forEach(savedSensor => {
      const isAlreadyListed = combined.find(c => c.id === savedSensor.id);
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
      // Prioridad: 1. Con señal (RSSI > -999), 2. Guardados
      const rssiA = a.rssi ?? -999;
      const rssiB = b.rssi ?? -999;
      return rssiB - rssiA;
    });

    setDisplayList(combined);
  }, [scannedDevices, savedSensors]); 

  
  const handleConnectAction = async (item: SensorItem) => {
    if (isBusy) return;

    if (item.device) {
        // ONLINE
        try {
            await connectToDevice(item.device);
            
            // Si es nuevo, guardar en DB
            if (!item.isSaved) {
                console.log("[Home] Guardando nuevo sensor en DB...");
                
                const dbType = item.type === 'UNKNOWN' ? 'B01' : item.type;
                const now = new Date().toISOString();

                const newSensor: SensorEntity = {
                    id: item.id,
                    alias: item.name,
                    type: dbType, 
                    location: 'Sin asignar',
                    activity: 'Activo',
                    config_json: '{}',
                    last_sync: now,
                    is_synced: 0, 
                    updated_at: now, 
                };
                await saveSensor(newSensor);
                await loadSensorsFromDB(); 
            }
            // Navegar según tipo
            if (item.type === 'N01') {
                router.push(`/gateway/${item.id}/dashboard`);
            } else {
                router.push(`/sensor/${item.id}/dashboard`);
            }
        } catch (error) {
            console.log("Error conectando:", error);
        }
    }
    else if (item.isSaved) {
        // OFFLINE
        if (item.type === 'N01') {
             router.push(`/gateway/${item.id}/dashboard`);
        } else {
             router.push(`/sensor/${item.id}/dashboard`);
        }
    }
  };

  const renderItem = ({ item }: { item: SensorItem }) => {
    const type = item.type;
    const isOffline = item.rssi === null;

    // --- MAPA VISUAL ---
    const typeMap: Record<string, { icon: string; bg: string; iconColor: string; label: string }> = {
      B01: { icon: 'sprout', bg: '#e3f2fd', iconColor: Colors.primary, label: 'Sensor Suelo (B01)' },
      C01: { icon: 'weather-partly-cloudy', bg: '#fff3e0', iconColor: Colors.secondary, label: 'Estación Climática (C01)' },
      N01: { icon: 'router-wireless', bg: '#e8f5e9', iconColor: '#2e7d32', label: 'Gateway LoRa (N01)' }, // Nuevo Estilo
      UNKNOWN: { icon: 'chip-outline', bg: '#f3f4f6', iconColor: Colors.textSecondary, label: 'Dispositivo Desconocido' }
    };

    const meta = typeMap[type] || typeMap.UNKNOWN;

    let signalColor = Colors.textSecondary;
    if (!isOffline && item.rssi != null) {
      if (item.rssi > -70) signalColor = Colors.success;
      else if (item.rssi > -85) signalColor = Colors.warning;
      else signalColor = Colors.error;
    }

    const disabled = ( !item.isSaved && isOffline ) || isBusy;

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
            {item.isSaved && <MaterialCommunityIcons name="bookmark" size={14} color={Colors.primary} style={{marginLeft: 4}} />}
          </Text>
          <Text style={styles.subId}>{item.id}</Text>

          <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{meta.label}</Text>

          <View style={styles.signalRow}>
            {isOffline ? (
                <Text style={styles.offlineText}>• Sin señal (Offline)</Text>
            ) : (
                <>
                    <MaterialCommunityIcons name="signal" size={14} color={signalColor} />
                    <Text style={[styles.rssiText, {color: signalColor}]}> {item.rssi} dBm</Text>
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
          <Text style={styles.appTitle}>Mis Sensores</Text>
          <Text style={styles.headerSub}>
            {isScanning ? 'Buscando dispositivos...' : 'Escaneo pausado'}
          </Text>
        </View>
        
        <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.scanningBtn]}
            onPress={() => {
                if (isBusy) return; 
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
                <MaterialCommunityIcons name="radar" size={20} color="#fff" />
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
            <MaterialCommunityIcons name="bluetooth-off" size={48} color="#ccc" />
            <Text style={styles.emptyText}>
                {isScanning ? "Esperando sensores..." : "No se encontraron sensores cercanos."}
            </Text>
             {!isScanning && savedSensors.length === 0 && (
                 <Text style={{fontSize: 12, color: '#aaa', marginTop: 5}}>Pulsa el radar para buscar</Text>
            )}
          </View>
        }
      />

      <LoadingOverlay 
        visible={isBusy} 
        message="Procesando conexión..." 
      />

    </View>
  );
}

const styles = StyleSheet.create({
  // ... (Tus estilos se mantienen igual) ...
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: {
    paddingHorizontal: 24, paddingVertical: 20, backgroundColor: '#fff',
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24, elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  appTitle: { fontSize: 28, fontWeight: 'bold', color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  scanButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', elevation: 2
  },
  scanningBtn: { backgroundColor: Colors.textSecondary },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#888', marginTop: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', padding: 16, borderRadius: 16, marginBottom: 12,
    elevation: 2, borderWidth: 1, borderColor: '#eee'
  },
  cardOffline: { opacity: 0.7, backgroundColor: '#f9f9f9' },
  iconBox: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginRight: 16
  },
  cardContent: { flex: 1 },
  alias: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  subId: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'monospace', marginVertical: 2 },
  signalRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  rssiText: { fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
  offlineText: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },
  newTag: { fontSize: 10, color: Colors.primary, fontWeight: 'bold', marginLeft: 6 },
  loadingOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 999
  },
  loadingBox: {
      width: 200, padding: 20, backgroundColor: '#fff', borderRadius: 16, alignItems: 'center', elevation: 10
  },
  loadingText: { marginTop: 10, fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary }
});