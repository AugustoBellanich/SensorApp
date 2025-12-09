import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Device } from 'react-native-ble-plx'; // Importamos el tipo real de BLE
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 1. Importamos el contexto BLE
import { Colors } from '../../constants/Colors';
import { useBle } from '../../context/BleContext';

// --- INTERFACES ---
interface SensorItem {
  id: string;             // ID o UUID de BLE
  name: string | null;    // Nombre leído o Alias
  rssi: number | null; 
  isSaved: boolean;
  type: 'B01' | 'C01' | 'UNKNOWN';
  device?: Device;        // Objeto Device real de BLE-PLX si está escaneado
}

// SIMULACIÓN DE BASE DE DATOS LOCAL
// Nota: En una app real, esto vendría del SensorRepository.getAllSensors()
const MOCK_DB_SENSORS = [
  { id: 'SEN-B01-A7NU9O', alias: 'Nogales Lote 1' }, 
  { id: 'SEN-C01-WX9921', alias: 'Estación Casco' }
];


export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  // --- USAMOS EL CONTEXTO BLE REAL ---
  const { 
    startScan, 
    stopScan, 
    isScanning, 
    scannedDevices, 
    connectToDevice, 
    connectedDevice,
    disconnectDevice 
  } = useBle(); // <--- Ahora los datos de escaneo son reales

  const [displayList, setDisplayList] = useState<SensorItem[]>([]);

  // Helper para detectar tipo según ID
  const getSensorType = (id: string): 'B01' | 'C01' | 'UNKNOWN' => {
    if (id.includes('B01')) return 'B01';
    if (id.includes('C01')) return 'C01';
    return 'UNKNOWN';
  };

  // --- LÓGICA DE FUSIÓN DE DATOS (DB + BLE) ---
  const mergeAndSortDevices = (scanned: Device[]) => {
    
    // 1. Mapeamos dispositivos escaneados reales
    const combined: SensorItem[] = scanned.map(device => {
      // Usamos device.name como ID provisional o device.id como fallback
      const uniqueId = device.name || device.id; 
      const known = MOCK_DB_SENSORS.find(db => db.id === uniqueId); 
      
      return {
        id: uniqueId, 
        name: known?.alias || device.name || 'Sensor Desconocido',
        rssi: device.rssi,
        isSaved: !!known,
        type: getSensorType(uniqueId),
        device: device // Objeto BLE-PLX
      } as SensorItem;
    });

    // 2. Agregamos Guardados offline que no se detectaron
    MOCK_DB_SENSORS.forEach(savedSensor => {
      const isAlreadyListed = combined.find(c => c.id === savedSensor.id);
      if (!isAlreadyListed) {
        combined.push({
          id: savedSensor.id,
          name: savedSensor.alias,
          rssi: null, // Offline
          isSaved: true,
          type: getSensorType(savedSensor.id)
        });
      }
    });

    // 3. Ordenar: Conectado, luego por RSSI, luego Offline
    combined.sort((a, b) => {
        // Mover el conectado actual al inicio
        if (connectedDevice?.id === a.id) return -1;
        if (connectedDevice?.id === b.id) return 1;

        const rssiA = a.rssi ?? -999; 
        const rssiB = b.rssi ?? -999;
        return rssiB - rssiA;
    });
    
    setDisplayList(combined);
  };

  useEffect(() => {
    // Cuando la lista de escaneados del Contexto cambia, actualizamos la lista visual
    mergeAndSortDevices(scannedDevices);
  }, [scannedDevices, connectedDevice]); // Depende del escaneo y del estado de conexión

  // --- INICIAR ESCANEO AL MONTAR ---
  useEffect(() => {
    // Inicia el escaneo y pide permisos al usuario
    startScan();
    return () => stopScan();
  }, []);

  // --- ACCIÓN DE CONEXIÓN REAL ---
  const handleConnectAction = async (item: SensorItem) => {
    // 1. Si el sensor está OFFLINE y no conectado, no hacemos nada
    if (item.rssi === null && connectedDevice?.id !== item.id) {
        Alert.alert("Sensor Fuera de Alcance", "Para ver datos en tiempo real o descargar SD, el sensor debe estar al alcance.");
        router.push(`/sensor/${item.id}/dashboard`); // Pero navegamos para ver historial local
        return;
    }
    
    // 2. Si el sensor está CONECTADO y lo volvemos a tocar, lo desconectamos
    if (connectedDevice?.id === item.id) {
        await disconnectDevice();
        return;
    }

    // 3. Si hay otra conexión activa, desconectar primero
    if (connectedDevice) {
        await disconnectDevice();
    }

    // 4. Conectar
    if (item.device) {
        try {
            await connectToDevice(item.device);
            router.push(`/sensor/${item.id}/dashboard`);
        } catch (error) {
            Alert.alert("Error de Conexión", "No se pudo establecer el enlace Bluetooth.");
        }
    }
  };


  const renderItem = ({ item }: { item: SensorItem }) => {
    const isSoil = item.type === 'B01';
    const isOffline = item.rssi === null;
    const isCurrentlyConnected = connectedDevice?.id === item.id;
    
    let signalColor = Colors.textSecondary;
    if (!isOffline && item.rssi) {
        if (item.rssi > -70) signalColor = Colors.success;
        else if (item.rssi > -85) signalColor = Colors.warning;
        else signalColor = Colors.error;
    }

    return (
      <TouchableOpacity 
        style={[
          styles.card, 
          isOffline && styles.cardOffline,
          isCurrentlyConnected && styles.cardConnected // <-- Nuevo estilo de conectado
        ]} 
        onPress={() => handleConnectAction(item)}
        // Permitimos click para ver el dashboard si está offline, pero no si es un sensor NUEVO y offline
        disabled={!item.isSaved && isOffline} 
      >
        {/* ICONO DISTINTIVO */}
        <View style={[styles.iconBox, { backgroundColor: isSoil ? '#e3f2fd' : '#fff3e0' }]}>
          <MaterialCommunityIcons 
            name={isSoil ? "sprout" : "weather-partly-cloudy"} 
            size={24} 
            color={isSoil ? Colors.primary : Colors.secondary} 
            style={{ opacity: isOffline ? 0.5 : 1 }}
          />
        </View>

        {/* INFO PRINCIPAL */}
        <View style={styles.cardContent}>
          <Text style={styles.alias}>
            {item.name} 
            {item.isSaved && <MaterialCommunityIcons name="bookmark" size={14} color={Colors.primary} />}
          </Text>
          <Text style={styles.subId}>{item.id}</Text>
          
          {/* ESTADO DE CONEXIÓN */}
          <View style={styles.signalRow}>
            {isOffline && !isCurrentlyConnected ? (
                <Text style={styles.offlineText}>• Sin señal (Offline)</Text>
            ) : (
                <>
                    {isCurrentlyConnected ? (
                       <Text style={styles.connectedTag}>• CONECTADO</Text>
                    ) : (
                       <>
                         <MaterialCommunityIcons name="signal" size={14} color={signalColor} />
                         <Text style={[styles.rssiText, {color: signalColor}]}> {item.rssi} dBm</Text>
                         {!item.isSaved && <Text style={styles.newTag}>• NUEVO</Text>}
                       </>
                    )}
                </>
            )}
          </View>
        </View>

        {/* FLECHA */}
        <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      
      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>Mis Sensores</Text>
          <Text style={styles.headerSub}>
            {isScanning ? 'Buscando dispositivos...' : 'Escaneo pausado'}
          </Text>
        </View>
        
        {/* BOTÓN ESCANEAR/PAUSAR */}
        <TouchableOpacity 
            style={[styles.scanButton, isScanning && styles.scanningBtn]} 
            onPress={isScanning ? stopScan : startScan}
        >
            {isScanning ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="radar" size={20} color="#fff" />}
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
            <Text style={styles.emptyText}>No se encontraron sensores cercanos.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  // Header
  header: {
    paddingHorizontal: 24, paddingVertical: 20, backgroundColor: '#fff',
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24, elevation: 4, 
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  appTitle: { fontSize: 28, fontWeight: 'bold', color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  // Scan Button
  scanButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', elevation: 2
  },
  scanningBtn: { backgroundColor: Colors.textSecondary },
  // Listas
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#888', marginTop: 10 },
  // Tarjeta de Sensor
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', padding: 16, borderRadius: 16, marginBottom: 12,
    elevation: 2, borderWidth: 1, borderColor: '#eee'
  },
  cardOffline: { opacity: 0.7, backgroundColor: '#f9f9f9' },
  cardConnected: { 
    borderColor: Colors.success, borderWidth: 2, 
    backgroundColor: Colors.success + '10' 
  },
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
  connectedTag: { fontSize: 10, color: Colors.success, fontWeight: 'bold', marginLeft: 6 }
});