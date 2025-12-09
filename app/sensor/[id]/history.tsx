import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../../../components/global/SegmentedControl';
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel'; // <--- IMPORTAMOS EL NUEVO COMPONENTE
import { Colors } from '../../../constants/Colors';

// --- TIPOS ---
type TimeRange = '12h' | '1D' | '7D' | '1M' | '1A';
type UnitType = '%Vol' | '%Grav' | 'mV';

// Helper Mock
const generateMockData = (points: number, baseVal: number) => {
  const data = [];
  for (let i = 0; i < points; i++) {
    data.push({ value: baseVal + (Math.random() * 5 - 2.5), label: `${i}h` });
  }
  return data;
};

export default function HistoryScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  
  const [range, setRange] = useState<TimeRange>('12h');
  const [unit, setUnit] = useState<UnitType>('%Vol');
  const [isLoading, setIsLoading] = useState(false);
  
  // Datos separados por electrodo
  const [tempData, setTempData] = useState<any[]>([]);
  const [electrodesData, setElectrodesData] = useState<{
    1: { data: any[], stats: any },
    2: { data: any[], stats: any },
    3: { data: any[], stats: any }
  } | null>(null);

  const calibrationRefs = [
    { value: 35, label: 'CC', color: Colors.primary },
    { value: 15, label: 'PMP', color: Colors.error },
  ];

  useEffect(() => {
    loadData();
  }, [range]);

  const calculateStats = (data: any[]) => {
    const vals = data.map(d => d.value);
    if (!vals.length) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length
    };
  };

  const loadData = async () => {
    setIsLoading(true);
    // Simular retardo
    await new Promise(r => setTimeout(r, 800));

    const points = range === '12h' ? 12 : 24;
    
    // Generamos datos para E1, E2, E3
    const e1 = generateMockData(points, 25);
    const e2 = generateMockData(points, 18);
    const e3 = generateMockData(points, 10);

    setTempData(generateMockData(points, 22));
    
    setElectrodesData({
      1: { data: e1, stats: calculateStats(e1) },
      2: { data: e2, stats: calculateStats(e2) },
      3: { data: e3, stats: calculateStats(e3) },
    });

    setIsLoading(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>Historial y Análisis</Text>
        <Text style={styles.subtitle}>{id}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* FILTROS TIEMPO */}
        <View style={styles.filterContainer}>
          {['12h', '1D', '7D', '1M', '1A'].map((r) => (
            <TouchableOpacity 
              key={r} 
              style={[styles.filterBtn, range === r && styles.filterBtnActive]}
              onPress={() => setRange(r as TimeRange)}
            >
              <Text style={[styles.filterText, range === r && styles.filterTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* FILTRO UNIDAD */}
        <View style={{ paddingHorizontal: 16 }}>
           <SegmentedControl 
             options={['% Vol', '% Grav', 'mV']} 
             selectedIndex={unit === '%Vol' ? 0 : unit === '%Grav' ? 1 : 2} 
             onChange={(i) => setUnit(i === 0 ? '%Vol' : i === 1 ? '%Grav' : 'mV')} 
           />
        </View>

        {isLoading || !electrodesData ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 50 }} />
        ) : (
          <View style={styles.content}>
            
            {/* 1. TEMPERATURA (Siempre fija arriba) */}
            <Text style={styles.sectionTitle}>Temperatura de Suelo</Text>
            <StatPanel stats={calculateStats(tempData)} unit="°C" />
            <SensorChart 
              data={tempData} 
              type="line" 
              unit="°C" 
              color={Colors.secondary}
            />

            {/* 2. BUCLE PARA ELECTRODOS (DRY - Don't Repeat Yourself) */}
            {[1, 2, 3].map((num) => {
              // @ts-ignore
              const elec = electrodesData[num];
              return (
                <View key={num} style={{ marginTop: 20 }}>
                  <Text style={styles.sectionTitle}>Humedad - Electrodo {num}</Text>
                  
                  {/* Reutilizamos el componente StatPanel */}
                  <StatPanel stats={elec.stats} unit={unit} />
                  
                  {/* Reutilizamos el componente SensorChart */}
                  <SensorChart 
                    data={elec.data} 
                    type={range === '12h' || range === '1D' ? 'line' : 'bar'} 
                    unit={unit} 
                    color={Colors.primary}
                    referenceLines={unit === '%Vol' ? calibrationRefs : []}
                  />
                </View>
              );
            })}

          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' }, // Fondo gris muy suave
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  title: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'monospace' },
  
  filterContainer: { flexDirection: 'row', justifyContent: 'space-around', padding: 10, marginVertical: 5 },
  filterBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#e0e0e0' },
  filterBtnActive: { backgroundColor: Colors.primary },
  filterText: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  filterTextActive: { color: '#fff' },

  content: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 8, marginTop: 10 },
});