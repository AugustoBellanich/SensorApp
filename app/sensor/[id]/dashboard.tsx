import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Colors } from '../../../constants/Colors';

// Importamos nuestros nuevos componentes
import ElectrodeCard from '../../../components/sensor/ElectrodeCard';
import SensorInfoBar from '../../../components/sensor/SensorInfoBar';
import SensorStatusPanel from '../../../components/sensor/SensorStatusPanel';

// DATOS FALSOS (MOCK) PARA PROBAR EL DISEÑO
const MOCK_LIVE_DATA = {
  batteryMv: 4050,
  soilTemp: 23.8,
  status: { sd: true, lora: true, rtc: true },
  electrodes: [
    { num: 1, depth: 10, hv: 15.1, hg: 12.6, mv: 1147, calibrated: true },
    { num: 2, depth: 30, hv: 22.4, hg: 18.2, mv: 1020, calibrated: true },
    { num: 3, depth: 60, hv: 0, hg: 0, mv: 850, calibrated: false }, // Este no está calibrado
  ]
};

export default function SensorDashboard() {
  const { id } = useLocalSearchParams(); // Capturamos el ID de la URL
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id; // Aseguramos que sea string

  return (
    <View style={styles.container}>
      {/* Configuración del Header de Navegación (App Bar) */}
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      {/* 1. Panel de Estado Superior */}
      <SensorStatusPanel 
        batteryMv={MOCK_LIVE_DATA.batteryMv}
        soilTemp={MOCK_LIVE_DATA.soilTemp}
        status={MOCK_LIVE_DATA.status}
      />

      {/* 2. Barra de Información Sutil */}
      <SensorInfoBar 
        id={sensorIdStr}
        alias="Nogales Lote 1 (Test)"
        location="Finca Experimental"
        onEditPress={() => router.push(`/sensor/${sensorIdStr}/info`)}
      />

      {/* 3. Contenido Principal Scrollable */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        
        {/* Mapeamos los 3 electrodos */}
        {MOCK_LIVE_DATA.electrodes.map((e) => (
          <ElectrodeCard
            key={e.num}
            number={e.num as 1|2|3}
            depthCm={e.depth}
            volumetricMoisture={e.hv}
            gravimetricMoisture={e.hg}
            voltageMv={e.mv}
            isCalibrated={e.calibrated}
            onCalibratePress={() => router.push(`/sensor/${sensorIdStr}/calibration?electrode=${e.num}`)}
          />
        ))}
        
        {/* Espacio extra al final */}
        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: '#f2f2f2' }, // Fondo gris claro para el scroll
  scrollContent: { padding: 12 },
});