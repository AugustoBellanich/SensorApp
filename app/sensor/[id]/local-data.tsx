import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../../constants/Colors';

// Componentes Reutilizables
import SegmentedControl from '../../../components/global/SegmentedControl';
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';

// Importamos repositorios (simulados por ahora dentro del componente)
// import { getReadingsB01, getReadingsC01 } from '../../../database/DataRepository'; 

export default function LocalDataScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;
  const isC01 = sensorIdStr.includes('C01');

  // --- ESTADO DE FECHAS ---
  const [dateStart, setDateStart] = useState(new Date());
  const [dateEnd, setDateEnd] = useState<Date | null>(null); // Null = Solo un día
  const [showPicker, setShowPicker] = useState<'start' | 'end' | null>(null);

  // --- ESTADO DE DATOS ---
  const [isLoading, setIsLoading] = useState(false);
  const [unit, setUnit] = useState(0); // 0: Vol/Temp, 1: Grav/Hum, 2: mV
  const [data, setData] = useState<any>(null);

  // Cargar datos al cambiar fechas
  useEffect(() => {
    fetchLocalData();
  }, [dateStart, dateEnd]);

  // --- SIMULACIÓN DE DB (MOCK) ---
  // Aquí luego conectarás con SQLite real usando las fechas seleccionadas
  const fetchLocalData = async () => {
    setIsLoading(true);
    // Simular delay de query SQL
    await new Promise(r => setTimeout(r, 600)); 
    
    // Generar datos falsos para visualizar
    const points = dateEnd ? 50 : 24; // Más puntos si es rango
    const generate = (base: number) => Array.from({length: points}, (_, i) => ({
      value: base + Math.random() * 10 - 5,
      label: dateEnd ? `D${i}` : `${i}:00`
    }));

    if (isC01) {
      setData({
        temp: generate(20),
        hum: generate(60),
        // Stats Agro calculados al vuelo
        agro: { chillHours: 12, frostHours: 0, heatStressHours: 4 }
      });
    } else {
      setData({
        temp: generate(22),
        e1: generate(25),
        e2: generate(18),
        e3: generate(10),
      });
    }
    setIsLoading(false);
  };

  // --- HANDLERS DE FECHA ---
  const onDateChange = (event: any, selectedDate?: Date) => {
    const type = showPicker;
    setShowPicker(null); // Cerrar picker
    if (event.type === 'dismissed' || !selectedDate) return;

    if (type === 'start') {
      setDateStart(selectedDate);
      // Si la fecha inicio es mayor que fin, reseteamos fin
      if (dateEnd && selectedDate > dateEnd) setDateEnd(null);
    } else {
      // Validar que fin no sea menor que inicio
      if (selectedDate < dateStart) return alert("La fecha final no puede ser anterior a la inicial.");
      setDateEnd(selectedDate);
    }
  };

  const formatDate = (d: Date) => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  // --- CALCULADORA DE ESTADÍSTICAS SIMPLES ---
  const calcStats = (arr: any[]) => {
    if (!arr || !arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map((d:any) => d.value);
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length
    };
  };

  // --- RENDER ---
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{padding:4}}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={{marginLeft: 10}}>
          <Text style={styles.title}>Datos Guardados</Text>
          <Text style={styles.subtitle}>Base de Datos Local (Offline)</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* FILTROS DE FECHA */}
        <View style={styles.dateFilterContainer}>
          
          {/* FECHA INICIO */}
          <View style={styles.dateBox}>
            <Text style={styles.dateLabel}>DEL DÍA</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker('start')}>
              <MaterialCommunityIcons name="calendar" size={20} color={Colors.primary} />
              <Text style={styles.dateText}>{formatDate(dateStart)}</Text>
            </TouchableOpacity>
          </View>

          <MaterialCommunityIcons name="arrow-right" size={20} color="#ccc" style={{marginTop: 15}} />

          {/* FECHA FIN */}
          <View style={styles.dateBox}>
            <Text style={styles.dateLabel}>AL DÍA</Text>
            {dateEnd ? (
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker('end')}>
                 <Text style={styles.dateText}>{formatDate(dateEnd)}</Text>
                 <TouchableOpacity onPress={() => setDateEnd(null)}>
                    <MaterialCommunityIcons name="close-circle" size={18} color={Colors.textSecondary} />
                 </TouchableOpacity>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.dateBtn, styles.dateBtnEmpty]} onPress={() => setShowPicker('end')}>
                <Text style={styles.datePlaceholder}>Seleccionar rango...</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* SELECTOR DE UNIDADES (Solo si es B01, para C01 no hace falta) */}
        {!isC01 && (
           <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
             <SegmentedControl 
               options={['% Vol', '% Grav', 'mV']} 
               selectedIndex={unit} 
               onChange={setUnit} 
             />
           </View>
        )}

        {isLoading || !data ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 50 }} />
        ) : (
          <View style={styles.content}>
            
            {/* ================= VISTA C01 (CLIMA) ================= */}
            {isC01 && (
              <>
                 {/* Panel Agro Resumido */}
                 <View style={styles.agroRow}>
                    <View style={styles.agroItem}>
                       <Text style={styles.agroVal}>{data.agro.chillHours}h</Text>
                       <Text style={styles.agroLbl}>Frío</Text>
                    </View>
                    <View style={[styles.agroItem, {borderLeftWidth:1, borderRightWidth:1, borderColor:'#eee'}]}>
                       <Text style={[styles.agroVal, {color: Colors.error}]}>{data.agro.frostHours}h</Text>
                       <Text style={styles.agroLbl}>Helada</Text>
                    </View>
                    <View style={styles.agroItem}>
                       <Text style={[styles.agroVal, {color: Colors.warning}]}>{data.agro.heatStressHours}h</Text>
                       <Text style={styles.agroLbl}>Calor</Text>
                    </View>
                 </View>

                 <Text style={styles.sectionTitle}>Temperatura</Text>
                 <StatPanel stats={calcStats(data.temp)} unit="°C" />
                 <SensorChart data={data.temp} type="line" unit="°C" color={Colors.secondary} />
                 
                 <Text style={styles.sectionTitle}>Humedad</Text>
                 <SensorChart data={data.hum} type="line" unit="%" color={Colors.primary} />
              </>
            )}

            {/* ================= VISTA B01 (SUELO) ================= */}
            {!isC01 && (
              <>
                <Text style={styles.sectionTitle}>Temp. Suelo</Text>
                <StatPanel stats={calcStats(data.temp)} unit="°C" />
                <SensorChart data={data.temp} type="line" unit="°C" color={Colors.secondary} />

                {[1, 2, 3].map(num => (
                  <View key={num} style={{marginTop: 20}}>
                    <Text style={styles.sectionTitle}>Electrodo {num}</Text>
                    <StatPanel stats={calcStats(data[`e${num}`])} unit={unit===0?'%':unit===1?'%':'mV'} />
                    <SensorChart 
                      data={data[`e${num}`]} 
                      type="line" 
                      unit={unit===0?'% θ':unit===1?'% ω':'mV'} 
                      color={Colors.primary} 
                    />
                  </View>
                ))}
              </>
            )}

          </View>
        )}

        {/* MODAL DATE PICKER (Android/iOS logic) */}
        {showPicker && (
          <DateTimePicker
            value={showPicker === 'start' ? dateStart : (dateEnd || new Date())}
            mode="date"
            display="default"
            onChange={onDateChange}
            maximumDate={new Date()} // No futuro
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary },
  
  // DATE FILTER STYLES
  dateFilterContainer: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: '#fff', padding: 15, margin: 16, borderRadius: 12, elevation: 2 
  },
  dateBox: { flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 10, fontWeight: 'bold', color: '#999', marginBottom: 5 },
  dateBtn: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#f0f7ff', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, width: '100%' 
  },
  dateBtnEmpty: { backgroundColor: '#f5f5f5', borderStyle: 'dashed', borderWidth: 1, borderColor: '#ccc' },
  dateText: { fontWeight: 'bold', color: Colors.primary, fontSize: 14 },
  datePlaceholder: { color: '#999', fontSize: 12, fontStyle: 'italic' },

  content: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 8, marginTop: 15 },
  
  // C01 Mini Panel
  agroRow: { flexDirection: 'row', backgroundColor:'#fff', borderRadius:12, padding:10, marginBottom:10, elevation:1 },
  agroItem: { flex: 1, alignItems:'center' },
  agroVal: { fontWeight:'bold', fontSize:16, color: Colors.textPrimary },
  agroLbl: { fontSize:10, color:'#888', textTransform:'uppercase' },
});