import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';

// 1. INTERFAZ MEJORADA
interface SensorItem {
  id: string;
  rssi: number | null; 
  isSaved: boolean;
  alias: string | null;
  type: 'B01' | 'C01' | 'UNKNOWN'; // Agregamos tipo para el icono
}

// SIMULACIÓN DE BASE DE DATOS
const MOCK_DB_SENSORS = [
  { id: 'SEN-B01-A7NU9O', alias: 'Nogales Lote 1' }, 
  { id: 'SEN-C01-WX9921', alias: 'Estación Casco' }
];

// SIMULACIÓN DE ESCÁNER BLUETOOTH
const MOCK_BLE_SCAN = [
  { id: 'SEN-B01-A7NU9O', rssi: -55 }, // Este ya está guardado (se fusionará)
  { id: 'SEN-B01-DSSF12', rssi: -80 }, // Nuevo
  { id: 'SEN-C01-ZZ8811', rssi: -92 }, // Nuevo (lejos)
];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [isScanning, setIsScanning] = useState(true);
  const [displayList, setDisplayList] = useState<SensorItem[]>([]);

  // Helper para detectar tipo según el ID
  const getSensorType = (id: string): 'B01' | 'C01' | 'UNKNOWN' => {
    if (id.includes('B01')) return 'B01';
    if (id.includes('C01')) return 'C01';
    return 'UNKNOWN';
  };

  useEffect(() => {
    // Simulamos el "refresco" del escaneo
    if (isScanning) {
        processList();
    }
  }, [isScanning]);

  const processList = () => {
    // 1. Mapeamos Escaneados
    const combined: SensorItem[] = MOCK_BLE_SCAN.map(device => {
      const known = MOCK_DB_SENSORS.find(db => db.id === device.id);
      return {
        id: device.id,
        rssi: device.rssi,
        isSaved: !!known,
        alias: known ? known.alias : null,
        type: getSensorType(device.id)
      };
    });

    // 2. Agregamos Guardados que NO aparecieron en el escaneo (Offline)
    MOCK_DB_SENSORS.forEach(savedSensor => {
      const isAlreadyListed = combined.find(c => c.id === savedSensor.id);
      
      if (!isAlreadyListed) {
        combined.push({
          id: savedSensor.id,
          rssi: null, // Null indica Offline/Lejos
          isSaved: true,
          alias: savedSensor.alias,
          type: getSensorType(savedSensor.id)
        });
      }
    });

    // 3. Ordenar: Primero los que tienen señal fuerte, al final los offline
    combined.sort((a, b) => {
      const rssiA = a.rssi ?? -999; 
      const rssiB = b.rssi ?? -999;
      return rssiB - rssiA; 
    });

    setDisplayList(combined);
  };

  const handleAction = (item: SensorItem) => {
    // Si es nuevo, aquí podríamos preguntar "¿Desea vincular?"
    // Por ahora vamos directo al dashboard como pediste
    router.push(`/sensor/${item.id}/dashboard`);
  };

  const renderItem = ({ item }: { item: SensorItem }) => {
    const isSoil = item.type === 'B01';
    const isOffline = item.rssi === null;
    
    // Determinar color de señal
    let signalColor = Colors.textSecondary;
    if (!isOffline) {
        if (item.rssi! > -70) signalColor = Colors.success;
        else if (item.rssi! > -85) signalColor = Colors.warning;
        else signalColor = Colors.error;
    }

    return (
      <TouchableOpacity 
        style={[styles.card, isOffline && styles.cardOffline]} 
        onPress={() => handleAction(item)}
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
            {item.alias || item.id} 
            {item.isSaved && <MaterialCommunityIcons name="bookmark" size={14} color={Colors.primary} />}
          </Text>
          <Text style={styles.subId}>{item.id}</Text>
          
          {/* ESTADO DE CONEXIÓN */}
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

        {/* FLECHA */}
        <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      
      {/* HEADER ELEGANTE */}
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
            onPress={() => setIsScanning(!isScanning)}
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
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  appTitle: { fontSize: 28, fontWeight: 'bold', color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  
  scanButton: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    elevation: 2
  },
  scanningBtn: { backgroundColor: Colors.textSecondary },

  // Listas
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#888', marginTop: 10 },

  // Tarjeta de Sensor
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16, borderRadius: 16, marginBottom: 12,
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
  newTag: { fontSize: 10, color: Colors.primary, fontWeight: 'bold', marginLeft: 6 }
});