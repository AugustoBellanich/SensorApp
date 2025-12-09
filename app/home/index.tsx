import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SensorCard from '../../components/sensor/SensorCard';
import { Colors } from '../../constants/Colors';
// Eliminamos GlobalStyles de aquí porque no lo estábamos usando y daba warning
// import { GlobalStyles } from '../../constants/GlobalStyles'; 

// 1. DEFINIMOS EL CONTRATO DE DATOS (LA SOLUCIÓN AL ERROR ROJO)
interface SensorItem {
  id: string;
  rssi: number | null; // <--- ¡Aquí está la clave! Permitimos número O nulo
  isSaved: boolean;
  alias: string | null;
}

// SIMULACIÓN DE BASE DE DATOS
const MOCK_DB_SENSORS = [
  { id: 'SEN-B01-A7NU9O', alias: 'Nogales Lote 1' }, 
  { id: 'SEN-C01-WX9921', alias: 'Estación lote pecan' }
];

// SIMULACIÓN DE ESCÁNER BLUETOOTH
const MOCK_BLE_SCAN = [
  { id: 'SEN-B01-A7NU9O', rssi: -55 },
  { id: 'SEN-B01-DSSF12', rssi: -80 },
];

export default function HomeScreen() {
  const router = useRouter();
  const [isScanning, setIsScanning] = useState(true);
  
  // Le decimos al estado que va a guardar una lista de 'SensorItem'
  const [displayList, setDisplayList] = useState<SensorItem[]>([]);

  useEffect(() => {
    // 1. Empezamos con los escaneados
    // Forzamos a que 'combined' sea un array de nuestro tipo SensorItem
    const combined: SensorItem[] = MOCK_BLE_SCAN.map(device => {
      const known = MOCK_DB_SENSORS.find(db => db.id === device.id);
      return {
        id: device.id,
        rssi: device.rssi, // Esto es un número
        isSaved: !!known,
        alias: known ? known.alias : null
      };
    });

    // 2. Agregamos los guardados offline
    MOCK_DB_SENSORS.forEach(savedSensor => {
      const isAlreadyListed = combined.find(c => c.id === savedSensor.id);
      
      if (!isAlreadyListed) {
        combined.push({
          id: savedSensor.id,
          rssi: null, // <--- Ahora TypeScript NO se queja, porque permitimos null arriba
          isSaved: true,
          alias: savedSensor.alias
        });
      }
    });

    // 3. Ordenar
    combined.sort((a, b) => {
      // Truco: Si a.rssi es null, lo tratamos como -999 (muy lejos) para ordenar
      const rssiA = a.rssi ?? -999; 
      const rssiB = b.rssi ?? -999;
      return rssiB - rssiA; // Orden descendente (el más cercano/mayor valor arriba)
    });

    setDisplayList(combined);
  }, [isScanning]);

  const handleAction = (item: SensorItem) => {
    if (!item.isSaved && item.rssi) {
      console.log("VINCULANDO...");
    }
    console.log(`Navegando a ${item.id}`);
    router.push(`/sensor/${item.id}/dashboard`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Mis Sensores</Text>
          <Text style={styles.headerSubtitle}>
            {isScanning ? 'Buscando dispositivos...' : 'Escaneo pausado'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setIsScanning(!isScanning)}>
           <Text style={styles.scanButton}>{isScanning ? '⏹' : '▶'}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayList}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <SensorCard 
            id={item.id}
            alias={item.alias || undefined} // Manejo seguro de null/undefined
            rssi={item.rssi}
            isSaved={item.isSaved}
            onPress={() => handleAction(item)}
          />
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', marginTop: 50, color: '#888' }}>
            No hay sensores cerca ni guardados.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f2' },
  header: {
    backgroundColor: '#fff',
    paddingTop: 50, paddingBottom: 15, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#e0e0e0',
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: Colors.textPrimary },
  headerSubtitle: { fontSize: 14, color: Colors.textSecondary },
  scanButton: { fontSize: 24, color: Colors.primary, fontWeight: 'bold' }
});