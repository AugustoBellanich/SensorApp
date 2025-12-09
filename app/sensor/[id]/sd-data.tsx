import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../../../components/global/SegmentedControl';
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';
import { Colors } from '../../../constants/Colors';

type TimeRange = '12h' | '1D' | '7D' | '1M' | '1A';
type UnitType = '% θ' | '% ω' | 'mV';

export default function SDDataScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [range, setRange] = useState<TimeRange>('12h');
  const [unit, setUnit] = useState<UnitType>('% θ');
  const [isLoading, setIsLoading] = useState(false);
  
  const [tempData, setTempData] = useState<any[]>([]);
  const [electrodesData, setElectrodesData] = useState<any>(null);

  // REFERENCIAS MOCK
  const calibrationRefs = {
    1: [{ value: 35, label: 'CC', color: Colors.primary }, { value: 15, label: 'PMP', color: Colors.error }],
    2: [{ value: 32, label: 'CC', color: Colors.primary }, { value: 14, label: 'PMP', color: Colors.error }],
    3: []
  };

  useEffect(() => { loadData(); }, [range, unit]);

  // GENERADOR MOCK (Resumido para ahorrar espacio, es el mismo de antes)
  const generateDataForRange = (timeRange: TimeRange, baseValue: number, currentUnit: UnitType) => {
    const data = [];
    let points = timeRange === '12h' ? 24 : 24; 
    // ... (Lógica de generación igual al anterior) ...
    for (let i = 0; i < points; i++) {
      data.push({ value: Math.max(0, baseValue + (Math.random() * 5 - 2.5)), label: `${i}` });
    }
    return data;
  };

  const calculateStats = (data: any[]) => {
    const vals = data.map(d => d.value);
    if (!vals.length) return { min: 0, max: 0, avg: 0 };
    return { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length };
  };

  const loadData = async () => {
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 400));
    // Simulación rápida de carga
    const e1 = generateDataForRange(range, 25, unit);
    const e2 = generateDataForRange(range, 18, unit);
    const e3 = generateDataForRange(range, 10, unit);
    setTempData(generateDataForRange(range, 22, '% θ'));
    setElectrodesData({
      1: { data: e1, stats: calculateStats(e1) },
      2: { data: e2, stats: calculateStats(e2) },
      3: { data: e3, stats: calculateStats(e3) },
    });
    setIsLoading(false);
  };

  // --- HANDLERS (PLACEHOLDERS) ---
  const handleSync = () => Alert.alert("Sincronizar", "Lógica futura: Guardar datos RAW en base de datos local.");
  const handleExportExcel = () => Alert.alert("Exportar Excel", "Lógica futura: Generar .csv/.xlsx y compartir.");
  const handleExportImage = () => Alert.alert("Exportar Imagen", "Lógica futura: Capturar ViewShot y compartir.");

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Memoria SD</Text>
          <Text style={styles.subtitle}>{id}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* FILTROS */}
        <View style={styles.filterContainer}>
          {['12h', '1D', '7D', '1M', '1A'].map((r) => (
            <TouchableOpacity key={r} style={[styles.filterBtn, range === r && styles.filterBtnActive]} onPress={() => setRange(r as TimeRange)}>
              <Text style={[styles.filterText, range === r && styles.filterTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ paddingHorizontal: 16 }}>
           <SegmentedControl 
             options={['% θ (Vol)', '% ω (Grav)', 'mV']} 
             selectedIndex={unit === '% θ' ? 0 : unit === '% ω' ? 1 : 2} 
             onChange={(i) => setUnit(i === 0 ? '% θ' : i === 1 ? '% ω' : 'mV')} 
           />
        </View>

        {isLoading || !electrodesData ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 50 }} />
        ) : (
          <View style={styles.content}>
            
            <Text style={styles.sectionTitle}>Temperatura de Suelo</Text>
            <StatPanel stats={calculateStats(tempData)} unit="°C" />
            <SensorChart data={tempData} type="line" unit="°C" color={Colors.secondary} />

            {[1, 2, 3].map((num) => {
              const elec = electrodesData[num];
              // @ts-ignore
              const refs = (unit === '% θ') ? (calibrationRefs[num] || []) : [];
              return (
                <View key={num} style={{ marginTop: 25 }}>
                  <Text style={styles.sectionTitle}>Electrodo {num}</Text>
                  <StatPanel stats={elec.stats} unit={unit} />
                  <SensorChart 
                    data={elec.data} 
                    type={(range === '1M' || range === '1A') ? 'bar' : 'line'} 
                    unit={unit} 
                    color={Colors.primary} 
                    referenceLines={refs} 
                  />
                </View>
              );
            })}

            {/* --- SECCIÓN DE BOTONES DE ACCIÓN --- */}
            <View style={styles.actionSection}>
              <Text style={styles.actionTitle}>Gestión y Exportación</Text>
              
              {/* 1. SINCRONIZAR (Principal) */}
              <TouchableOpacity style={styles.syncButton} onPress={handleSync}>
                <MaterialCommunityIcons name="database-sync" size={24} color="#fff" />
                <View style={{marginLeft: 10}}>
                   <Text style={styles.syncBtnText}>Sincronizar y Guardar</Text>
                   <Text style={styles.syncBtnSub}>Vincular datos crudos a la App</Text>
                </View>
              </TouchableOpacity>

              {/* Botones Secundarios en Fila */}
              <View style={styles.secondaryActionsRow}>
                
                {/* 2. EXCEL */}
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleExportExcel}>
                  <MaterialCommunityIcons name="file-excel" size={24} color={Colors.success} />
                  <Text style={styles.secondaryBtnText}>Excel / CSV</Text>
                </TouchableOpacity>

                {/* 3. IMAGEN */}
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleExportImage}>
                  <MaterialCommunityIcons name="image-area" size={24} color={Colors.primary} />
                  <Text style={styles.secondaryBtnText}>Imagen PNG</Text>
                </TouchableOpacity>
                
              </View>
            </View>

          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  backButton: { marginRight: 15 },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'monospace' },
  
  filterContainer: { flexDirection: 'row', justifyContent: 'space-around', padding: 10, marginVertical: 5 },
  filterBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#e0e0e0' },
  filterBtnActive: { backgroundColor: Colors.primary },
  filterText: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  filterTextActive: { color: '#fff' },

  content: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 8, marginTop: 5 },

  // --- ESTILOS NUEVOS DE BOTONES ---
  actionSection: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 20,
    paddingBottom: 20
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    marginBottom: 15,
    textTransform: 'uppercase'
  },
  
  // Botón Sincronizar (Grande)
  syncButton: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 15,
    elevation: 3
  },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  syncBtnSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },

  // Fila de Botones Secundarios
  secondaryActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10
  },
  secondaryBtn: {
    flex: 1, // Ocupan 50% cada uno
    flexDirection: 'column',
    backgroundColor: '#fff',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    elevation: 1
  },
  secondaryBtnText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary
  }
});