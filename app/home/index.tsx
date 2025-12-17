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
import { getAllSensors, getSensorById, saveSensor } from "../../database/SensorRepository";
import { SensorEntity } from "../../database/types";
import { supabase } from "../../lib/supabase";
import { syncService } from "../../services/syncService"; // Asegúrate que coincida con tu archivo

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
  const [isSyncing, setIsSyncing] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);

  // --- DETECCIÓN INTELIGENTE DE TIPO ---
  const getSensorType = (id: string): SensorModelType => {
    const upperId = id.toUpperCase();
    if (upperId.includes('B01') || upperId.includes('A01')) return 'B01';
    if (upperId.includes('C01')) return 'C01';
    if (upperId.includes('N01') || upperId.includes('N02')) return 'N01';
    return 'UNKNOWN';
  };

  const loadSensorsFromDB = async () => {
      const sensors = await getAllSensors();
      setSavedSensors(sensors);
      console.log(`[Home] Cargados ${sensors.length} sensores de la DB.`);
  };

  // --- 1. SINCRONIZACIÓN SILENCIOSA AL INICIO ---
  useEffect(() => {
    const initSync = async () => {
        setIsSyncing(true);
        try {
            await syncService.pullChanges();
            await loadSensorsFromDB(); 
        } catch (e) {
            console.log("Sync warning (Silent Pull Failed):", e);
        } finally {
            setIsSyncing(false);
        }
    };
    initSync();
  }, []); 

  // --- 2. GESTIÓN DEL FOCO (INICIA ESCANEO) ---
  useFocusEffect(
    useCallback(() => {
      let timeoutId: any; 

      const onFocus = async () => {
          if (connectedDevice) {
              await disconnectDevice();
          }
          
          clearScannedDevices();
          setDisplayList([]); 
          
          if (savedSensors.length === 0) {
            await loadSensorsFromDB();
          }

          timeoutId = setTimeout(() => {
              startScan();
          }, 500);
      };

      onFocus();

      return () => {
        clearTimeout(timeoutId);
        stopScan();
      };
    }, [connectedDevice, disconnectDevice, clearScannedDevices, startScan, stopScan, savedSensors.length]) 
  );

  // --- 3. MERGE: BLE + DB ---
  useEffect(() => {
    const combined: SensorItem[] = scannedDevices.map(device => {
      const uniqueId = device.name || device.id;
      const known = savedSensors.find(db => db.id === uniqueId);
      
      return {
        id: uniqueId,
        name: known?.alias || device.name || 'Sensor Nuevo', 
        rssi: device.rssi,
        isSaved: !!known,
        type: known?.type as SensorModelType || getSensorType(uniqueId), 
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
      const rssiA = a.rssi ?? -999;
      const rssiB = b.rssi ?? -999;
      return rssiB - rssiA;
    });

    setDisplayList(combined);
  }, [scannedDevices, savedSensors]); 

  
  // --- 4. ACCIÓN PRINCIPAL: ONBOARDING INTELIGENTE ---
  const handleConnectAction = async (item: SensorItem) => {
    if (isBusy || isSyncing) return;

    if (item.device) {
        // ONLINE (BLE Detectado)
        try {
            setOnboardingStatus("Conectando BLE...");
            await connectToDevice(item.device);
            
            // --- CORRECCIÓN CRÍTICA DE ID ---
            // Limpiamos "SEN-" para que coincida con la DB
            const cleanId = item.id.replace("SEN-", ""); 
            
            // Verificamos si ya existe localmente
            const existingLocal = await getSensorById(cleanId);
            
            if (!existingLocal) {
                console.log(`[Onboarding] Nuevo sensor detectado: ${item.id} -> ${cleanId}`);
                setOnboardingStatus("Verificando en la Nube...");
                
                let newSensorData: SensorEntity;
                let isFromCloud = false;

                try {
                    // 1. Consultamos a Supabase si existe (usando cleanId)
                    const { data: cloudDevice, error } = await supabase
                        .from('devices')
                        .select('*')
                        .eq('id', cleanId)
                        .single();

                    if (cloudDevice && !error) {
                        // CASO A: YA EXISTE EN NUBE -> DESCARGAMOS DATOS
                        console.log("[Onboarding] Encontrado en nube. Descargando...");
                        newSensorData = {
                            id: cloudDevice.id,
                            alias: cloudDevice.alias,
                            type: cloudDevice.type,
                            location: cloudDevice.name_farm,
                            activity: cloudDevice.activity,
                            lat: cloudDevice.lat,
                            lng: cloudDevice.lng,
                            config_json: JSON.stringify(cloudDevice.config),
                            is_synced: 1, // Ya está sincronizado
                            updated_at: cloudDevice.created_at,
                            last_sync: new Date().toISOString()
                        };
                        isFromCloud = true;
                    } else {
                        throw new Error("No existe en nube");
                    }

                } catch (_) {
                    // CASO B: NO EXISTE EN NUBE -> CREAMOS LOCAL
                    console.log("[Onboarding] Creando Localmente.");
                    const dbType = item.type === 'UNKNOWN' ? 'B01' : item.type;
                    const now = new Date().toISOString();

                    newSensorData = {
                        id: cleanId, // Guardamos ID limpio
                        alias: item.name, 
                        type: dbType, 
                        location: 'Sin asignar', 
                        activity: 'Activo',
                        config_json: '{}',
                        last_sync: now,
                        is_synced: 0, // Pendiente de subir
                        updated_at: now, 
                    };
                    isFromCloud = false;
                }

                // 2. Guardamos en SQLite
                await saveSensor(newSensorData, isFromCloud);
                
                // 3. Push inmediato si es local
                if (!isFromCloud) {
                    syncService.pushChanges().catch(e => console.log("Push background err:", e));
                }

                await loadSensorsFromDB(); 
            }
            
            setOnboardingStatus(null); 
            
            // Navegar usando cleanId
            if (item.type === 'N01') {
                router.push(`/gateway/${cleanId}/dashboard`);
            } else {
                router.push(`/sensor/${cleanId}/dashboard`);
            }
        } catch (error) {
            setOnboardingStatus(null);
            console.log("Error conectando:", error);
            alert("No se pudo conectar con el sensor. Intenta acercarte más.");
        }
    }
    else if (item.isSaved) {
        // OFFLINE (Historial)
        // El item.id ya viene de la DB (por ende ya está limpio), pero por seguridad usamos el ID del item
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
      N01: { icon: 'router-wireless', bg: '#e8f5e9', iconColor: '#2e7d32', label: 'Gateway LoRa (N01)' },
      UNKNOWN: { icon: 'chip-outline', bg: '#f3f4f6', iconColor: Colors.textSecondary, label: 'Dispositivo Desconocido' }
    };

    const meta = typeMap[type] || typeMap.UNKNOWN;

    let signalColor = Colors.textSecondary;
    if (!isOffline && item.rssi != null) {
      if (item.rssi > -70) signalColor = Colors.success;
      else if (item.rssi > -85) signalColor = Colors.warning;
      else signalColor = Colors.error;
    }

    const disabled = ( !item.isSaved && isOffline ) || isBusy || isSyncing;

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
                <Text style={styles.offlineText}>• Sin señal (Historial Offline)</Text>
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
      
      {/* HEADER LIMPIO */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>Sensores</Text>
          <View style={{flexDirection:'row', alignItems:'center'}}>
              <Text style={styles.headerSub}>
                {isScanning ? 'Buscando dispositivos...' : 'Escaneo pausado'}
              </Text>
              {isSyncing && <ActivityIndicator size="small" color={Colors.primary} style={{marginLeft: 10}}/>}
          </View>
        </View>
        
        {/* BOTÓN CON ÍCONO BLUETOOTH */}
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
            <MaterialCommunityIcons name="bluetooth-off" size={48} color="#ccc" />
            <Text style={styles.emptyText}>
                {isScanning ? "Esperando sensores..." : "No se encontraron sensores cercanos."}
            </Text>
             {!isScanning && savedSensors.length === 0 && (
                 <Text style={{fontSize: 12, color: '#aaa', marginTop: 5}}>Pulsa el botón Bluetooth para buscar</Text>
            )}
          </View>
        }
      />

      <LoadingOverlay 
        visible={isBusy || isSyncing || !!onboardingStatus} 
        message={onboardingStatus || (isSyncing ? "Sincronizando..." : "Conectando...")} 
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
    width: 48, height: 48, borderRadius: 24,
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
      width: 220, padding: 24, backgroundColor: '#fff', borderRadius: 16, alignItems: 'center', elevation: 10
  },
  loadingText: { marginTop: 12, fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, textAlign: 'center' }
});