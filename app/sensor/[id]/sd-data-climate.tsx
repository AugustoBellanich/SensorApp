import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';
import { Colors } from '../../../constants/Colors';

type TimeRange = '12h' | '1D' | '7D' | '1M' | '1A';

export default function SDDataClimateScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [range, setRange] = useState<TimeRange>('12h');
  const [isLoading, setIsLoading] = useState(false);
  
  // Datos procesados (ya con colores si corresponde)
  const [tempDataChart, setTempDataChart] = useState<any[]>([]);
  const [humDataChart, setHumDataChart] = useState<any[]>([]);
  // Datos crudos para estadísticas
  const [tempDataRaw, setTempDataRaw] = useState<any[]>([]);
  const [humDataRaw, setHumDataRaw] = useState<any[]>([]);
  
  const [agroStats, setAgroStats] = useState({
    chillHours: 0,
    frostHours: 0,
    heatStressHours: 0
  });

  const tempRefs = [
    { value: 7.2, label: 'Umbral Frío (7.2°)', color: '#004aad' }, 
    { value: 0, label: 'HELADA (0°)', color: '#00bfa5' },       
  ];

  useEffect(() => {
    loadData();
  }, [range]);

  // --- LÓGICA DE COLORES ---
  const getTempColor = (val: number) => {
    if (val < 0) return '#80deea'; 
    if (val <= 7.2) return '#004aad'; 
    if (val < 35) return '#ff7043'; 
    return '#d32f2f'; 
  };

  const getHumColor = (val: number) => {
    if (val < 40) return '#90caf9'; 
    if (val < 70) return '#42a5f5'; 
    if (val < 90) return '#1565c0'; 
    return '#0d47a1';               
  };

  const processDataForChart = (rawData: any[], type: 'temp' | 'hum') => {
    const isBarChart = range === '1M' || range === '1A';
    if (!isBarChart) return rawData;
    return rawData.map(d => ({
      ...d,
      frontColor: type === 'temp' ? getTempColor(d.value) : getHumColor(d.value)
    }));
  };

  // --- GENERADOR MOCK (CON ESTACIONES) ---
  const generateClimateData = (timeRange: TimeRange, type: 'temp' | 'hum') => {
    const data = [];
    let points = 24;
    let timeLabelFn: (i: number) => string = (i) => `${i}`;

    switch (timeRange) {
      case '12h': points = 24; timeLabelFn = (i) => i%2===0?`${8+Math.floor(i/2)}:${i%2?'30':'00'}`:''; break;
      case '1D':  points = 24; timeLabelFn = (i) => i%4===0?`${i}:00`:''; break;
      case '7D':  points = 28; timeLabelFn = (i) => i%4===0?`D${Math.floor(i/4)+1}`:''; break;
      case '1M':  points = 30; timeLabelFn = (i) => i%5===0?`D${i+1}`:''; break;
      case '1A':  points = 12; timeLabelFn = (i) => ['E','F','M','A','M','J','J','A','S','O','N','D'][i]; break;
    }

    for (let i = 0; i < points; i++) {
      let val = 0;

      if (type === 'temp') {
        // LÓGICA DE INVIERNO PARA TEST
        if (timeRange === '1A') {
          // Si son los meses de invierno (Mayo=4, Jun=5, Jul=6, Ago=7)
          if (i >= 4 && i <= 7) {
             // Generamos temperaturas entre -2°C y 8°C para probar Horas Frío y Heladas
             val = 4 + (Math.random() * 6 - 4); // Resultado: entre 0 y 8 aprox (con azar de bajar a negativo)
             // Forzamos una helada en Julio (i=6)
             if (i === 6) val = -1.5; 
             // Forzamos frío acumulable en Junio (i=5)
             if (i === 5) val = 5.0; 
          } else {
             // Verano/Primavera: entre 15°C y 32°C
             val = 22 + (Math.random() * 10 - 5);
          }
        } 
        else if (timeRange === '12h' || timeRange === '1D') {
          // Para rangos cortos, simulamos un día frío de invierno
          // Amanecer muy frío (puntos iniciales)
          if (i < 8) val = 2 + Math.random(); // 2°C a 3°C (Suma Horas Frío)
          else val = 12 + Math.random() * 5;  // Tarde más cálida
        }
        else {
          // Default aleatorio
          val = 15 + (Math.random() * 15 - 5);
        }
      } else {
        // Humedad (en invierno suele ser más baja o variable)
        val = 50 + (Math.random() * 40);
      }

      data.push({ value: val, label: timeLabelFn(i) });
    }
    return data;
  };

  const calculateStandardStats = (data: any[]) => {
    const vals = data.map(d => d.value);
    if (!vals.length) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length
    };
  };

  const calculateAgroStats = (tData: any[], timeRange: TimeRange) => {
    let chillCount = 0;
    let frostHoursCount = 0;
    let heatCount = 0;
    let hoursPerPoint = 1; 
    if (timeRange === '12h') hoursPerPoint = 0.5;
    if (timeRange === '1D') hoursPerPoint = 1;
    if (timeRange === '7D') hoursPerPoint = 6;
    if (timeRange === '1M') hoursPerPoint = 24;
    if (timeRange === '1A') hoursPerPoint = 24 * 30;

    tData.forEach(d => {
      const t = d.value;
      if (t > 0 && t <= 7.2) chillCount += hoursPerPoint;
      if (t <= 0) frostHoursCount += hoursPerPoint;
      if (t >= 35) heatCount += hoursPerPoint;
    });

    return { chillHours: chillCount, frostHours: frostHoursCount, heatStressHours: heatCount };
  };

  const loadData = async () => {
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 500));

    const tRaw = generateClimateData(range, 'temp');
    const hRaw = generateClimateData(range, 'hum');
    
    setTempDataRaw(tRaw);
    setHumDataRaw(hRaw);

    setTempDataChart(processDataForChart(tRaw, 'temp'));
    setHumDataChart(processDataForChart(hRaw, 'hum'));

    setAgroStats(calculateAgroStats(tRaw, range));
    setIsLoading(false);
  };

  // --- HANDLERS ---
  const handleSync = () => Alert.alert("Sincronizar", "Guardando datos climáticos en base de datos local...");
  const handleExportExcel = () => Alert.alert("Exportar Excel", "Generando archivo CSV de clima...");
  const handleExportImage = () => Alert.alert("Exportar Imagen", "Capturando gráfico climático...");

  const chartType = (range === '1M' || range === '1A') ? 'bar' : 'line';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Análisis Climático</Text>
          <Text style={styles.subtitle}>{id} • Estación Meteorológica</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        
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

        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 50 }} />
        ) : (
          <View style={styles.content}>
            
            {/* PANEL AGRO */}
            <Text style={styles.sectionTitle}>Indicadores Agronómicos</Text>
            <View style={styles.agroPanel}>
              <View style={styles.agroItem}>
                <MaterialCommunityIcons name="snowflake" size={24} color="#004aad" />
                <Text style={styles.agroValue}>{Math.round(agroStats.chillHours)} h</Text>
                <Text style={styles.agroLabel}>Horas Frío</Text>
                <Text style={styles.agroSub}>( 0° {'<'} T {'<='} 7.2° )</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.agroItem}>
                <MaterialCommunityIcons name="alert-octagon" size={24} color={agroStats.frostHours > 0 ? Colors.error : '#ccc'} />
                <Text style={[styles.agroValue, {color: agroStats.frostHours > 0 ? Colors.error : Colors.textPrimary}]}>
                  {Math.round(agroStats.frostHours)} h
                </Text>
                <Text style={styles.agroLabel}>Heladas</Text>
                <Text style={styles.agroSub}>( T {'<='} 0°C )</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.agroItem}>
                <MaterialCommunityIcons name="white-balance-sunny" size={24} color={Colors.warning} />
                <Text style={styles.agroValue}>{Math.round(agroStats.heatStressHours)} h</Text>
                <Text style={styles.agroLabel}>Calor Ext.</Text>
                <Text style={styles.agroSub}>( T {'>='} 35°C )</Text>
              </View>
            </View>


            {/* GRÁFICA TEMP */}
            <Text style={styles.sectionTitle}>Temperatura Ambiente</Text>
            <StatPanel stats={calculateStandardStats(tempDataRaw)} unit="°C" />
            <SensorChart 
              data={tempDataChart} 
              type={chartType}
              unit="°C" 
              color={Colors.secondary} 
              referenceLines={tempRefs} 
            />

            {/* GRÁFICA HUMEDAD */}
            <View style={{marginTop: 20}}>
              <Text style={styles.sectionTitle}>Humedad Relativa</Text>
              <StatPanel stats={calculateStandardStats(humDataRaw)} unit="%" />
              <SensorChart 
                data={humDataChart} 
                type={chartType}
                unit="%" 
                color={Colors.primary} 
              />
            </View>

            {/* --- SECCIÓN DE BOTONES DE ACCIÓN (IGUAL AL B01) --- */}
            <View style={styles.actionSection}>
              <Text style={styles.actionTitle}>Gestión y Exportación</Text>
              
              {/* 1. SINCRONIZAR */}
              <TouchableOpacity style={styles.syncButton} onPress={handleSync}>
                <MaterialCommunityIcons name="database-sync" size={24} color="#fff" />
                <View style={{marginLeft: 10}}>
                   <Text style={styles.syncBtnText}>Sincronizar y Guardar</Text>
                   <Text style={styles.syncBtnSub}>Vincular datos crudos a la App</Text>
                </View>
              </TouchableOpacity>

              {/* Botones Secundarios */}
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
  header: { 
    flexDirection: 'row', alignItems: 'center', 
    padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' 
  },
  backButton: { marginRight: 15 },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary },
  
  filterContainer: { flexDirection: 'row', justifyContent: 'space-around', padding: 10, marginVertical: 5 },
  filterBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#e0e0e0' },
  filterBtnActive: { backgroundColor: Colors.primary },
  filterText: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  filterTextActive: { color: '#fff' },

  content: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 8, marginTop: 15 },

  // PANEL AGRO
  agroPanel: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 15,
    elevation: 2,
    marginBottom: 10,
    borderWidth: 1, borderColor: '#eee',
    justifyContent: 'space-between'
  },
  agroItem: { flex: 1, alignItems: 'center' },
  agroValue: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary, marginVertical: 4 },
  agroLabel: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  agroSub: { fontSize: 10, color: '#999' },
  divider: { width: 1, backgroundColor: '#eee', height: '80%', alignSelf: 'center' },

  // --- ESTILOS DE BOTONES (ESTÁNDAR) ---
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

  secondaryActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10
  },
  secondaryBtn: {
    flex: 1,
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