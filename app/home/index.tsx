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

interface SensorItem {
  id: string;         
  name: string;       
  rssi: number | null; 
  isSaved: boolean;   
  type: 'B01' | 'C01' | 'N01' | 'UNKNOWN'; 
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

  const getSensorType = (id: string): 'B01' | 'C01' | 'N01' | 'UNKNOWN' => {
    const upperId = id.toUpperCase();
    if (upperId.includes('B01')) return 'B01';
    if (upperId.includes('C01')) return 'C01';
    if (upperId.includes('N01')) return 'N01'; 
    return 'UNKNOWN';
  };

  const loadSensorsFromDB = async () => {
      const sensors = await getAllSensors();
      setSavedSensors(sensors);
      console.log(`[Home] Cargados ${sensors.length} sensores de la DB.`);
  };

  // --- GESTIÓN DEL FOCO (CORREGIDO) ---
  useFocusEffect(
    useCallback(() => {
      console.log("--> Home Enfocado");
      
      // Variable para limpiar el timeout
      // CORRECCIÓN: Usamos 'any' para evitar conflictos entre tipos de Node y RN
      let timeoutId: any; 

      // Retrasamos la lógica BLE 100ms para asegurar que la UI se montó
      timeoutId = setTimeout(() => {
          if (connectedDevice) {
              console.log("[Home] Dispositivo detectado al volver. Ejecutando desconexión...");
              disconnectDevice();
          }

          clearScannedDevices();
          setDisplayList([]); 
          loadSensorsFromDB(); 
          startScan();
      }, 100);

      return () => {
        console.log("<-- Saliendo de Home");
        clearTimeout(timeoutId); // Limpiamos el timeout pendiente
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
          type: savedSensor.type,
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

  
  const handleConnectAction = async (item: SensorItem) => {
    if (isBusy) return;

    if (item.device) {
        // ONLINE
        try {
            await connectToDevice(item.device);
            
            // Si es nuevo, guardar en DB
            if (!item.isSaved) {
                console.log("[Home] Guardando nuevo sensor en DB...");
                
                // Determinar el tipo para la DB (DB no debe tener 'UNKNOWN')
                const dbType = item.type === 'UNKNOWN' ? 'B01' : item.type; // Asumir B01 por defecto

                // --- CORRECCIÓN 2: Incluir propiedades de Sincronización ---
                const now = new Date().toISOString();

                const newSensor: SensorEntity = {
                    id: item.id,
                    alias: item.name,
                    type: dbType, // Usamos el tipo determinado
                    location: 'Sin asignar',
                    activity: 'Activo',
                    config_json: '{}',
                    last_sync: now,
                    
                    // PROPIEDADES DE SINCRONIZACIÓN (is_synced, updated_at)
                    is_synced: 0, 
                    updated_at: now, 
                };
                await saveSensor(newSensor);
                await loadSensorsFromDB(); 
            }
            router.push(`/sensor/${item.id}/dashboard`);
        } catch (error) {
            console.log("Error conectando:", error);
        }
    }
    else if (item.isSaved) {
        // OFFLINE
        router.push(`/sensor/${item.id}/dashboard`);
    }
  };

  const renderItem = ({ item }: { item: SensorItem }) => {
    // Determinar tipo y propiedades visuales
    const type = item.type;
    const isOffline = item.rssi === null;

    // Mapeo de tipos a icono y colores/etiquetas
    const typeMap: Record<string, { icon: string; bg: string; iconColor: string; label: string }> = {
      B01: { icon: 'sprout', bg: '#e3f2fd', iconColor: Colors.primary, label: 'Sensor Suelo (B01)' },
      C01: { icon: 'weather-partly-cloudy', bg: '#fff3e0', iconColor: Colors.secondary, label: 'Estación Climática (C01)' },
      N01: { icon: 'router-wireless', bg: '#e8f5e9', iconColor: '#2e7d32', label: 'Gateway Antena (N01)' },
      UNKNOWN: { icon: 'chip-outline', bg: '#f3f4f6', iconColor: Colors.textSecondary, label: 'Dispositivo' }
    };

    const meta = typeMap[type] || typeMap.UNKNOWN;

    // Color de señal
    let signalColor = Colors.textSecondary;
    if (!isOffline && item.rssi != null) {
      if (item.rssi > -70) signalColor = Colors.success;
      else if (item.rssi > -85) signalColor = Colors.warning;
      else signalColor = Colors.error;
    }

    // Decide si la tarjeta está deshabilitada (mismo criterio que antes)
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
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center', alignItems: 'center', zIndex: 999
  },
  loadingBox: {
      width: 200, padding: 20, backgroundColor: '#fff',
      borderRadius: 16, alignItems: 'center', elevation: 10
  },
  loadingText: {
      marginTop: 10, fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary
  }
});