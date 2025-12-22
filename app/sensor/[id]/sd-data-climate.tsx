import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- LIBRERÍAS (FIX SDK 54) ---
// @ts-ignore
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import * as XLSX from 'xlsx';

// Componentes
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';
import { Colors } from '../../../constants/Colors';

// Tipos
type TimeRange = '12h' | '1D' | '7D' | '1M' | '1A';

// =====================================================================
// COMPONENTE INTERNO: TARJETA EXPORTABLE (Reutilizado)
// =====================================================================
interface ExportableCardProps {
    title: string;
    stats: any;
    data: any[];
    unit: string;
    color: string;
    sensorId: string;
    type: 'line' | 'bar';
    // Metadata
    sensorName?: string;
    sensorLocation?: string;
    dateRangeLabel: string;
}

const ExportableChartCard = ({ 
    title, stats, data, unit, color, sensorId, type, sensorName, sensorLocation, dateRangeLabel 
}: ExportableCardProps) => {
    const viewRef = useRef<View>(null);
    const [saving, setSaving] = useState(false);

    const handleCapture = async () => {
        if (saving) return;
        setSaving(true);
        
        InteractionManager.runAfterInteractions(async () => {
            try {
                // Espera para asegurar renderizado
                await new Promise(r => setTimeout(r, 200));

                if (!viewRef.current) throw new Error("Vista no montada");

                const uri = await captureRef(viewRef, {
                    format: 'png',
                    quality: 1,
                    result: 'tmpfile',
                });

                const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
                const fileName = `${sensorId}_${cleanTitle}_${Date.now()}.png`;
                
                // @ts-ignore
                const fs = FileSystem;
                const newPath = (fs.documentDirectory || fs.cacheDirectory) + fileName;

                await fs.moveAsync({ from: uri, to: newPath });

                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(newPath, {
                        mimeType: 'image/png',
                        dialogTitle: `Gráfico ${title}`
                    });
                } else {
                    Alert.alert("Guardado", "Imagen guardada.");
                }
            } catch (e) {
                console.error("Error al capturar:", e);
                Alert.alert("Error", "No se pudo guardar la imagen.");
            } finally {
                setSaving(false);
            }
        });
    };

    return (
        <View style={styles.chartCardContainer}>
            {/* Header visible solo en app */}
            <View style={styles.chartHeader}>
                <Text style={styles.chartTitle}>{title}</Text>
                <TouchableOpacity 
                    style={styles.miniExportButton} 
                    onPress={handleCapture}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                        <MaterialCommunityIcons name="camera-outline" size={20} color={Colors.textSecondary} />
                    )}
                </TouchableOpacity>
            </View>

            {/* === ÁREA DE CAPTURA === */}
            <View 
                ref={viewRef} 
                collapsable={false} 
                style={styles.captureContainer}
            >
                {/* 1. Encabezado Interno */}
                <View style={{borderBottomWidth:1, borderBottomColor:'#eee', paddingBottom:5, marginBottom:10}}>
                    <Text style={{fontSize:14, fontWeight:'bold', color:Colors.textPrimary}}>{title}</Text>
                    <Text style={{fontSize:12, color:Colors.textSecondary}}>Estación: {sensorName || sensorId}</Text>
                </View>
                
                {/* 2. Estadísticas */}
                <StatPanel stats={stats} unit={unit} />
                
                {/* 3. Gráfico (Visible) */}
                <View style={{marginTop: 10, overflow: 'hidden'}}>
                     <SensorChart 
                        data={data} 
                        type={type} 
                        unit={unit} 
                        color={color} 
                        // Líneas de referencia solo para temperatura
                        referenceLines={unit === '°C' ? [{value:0, label:'0°C', color:'#00bfa5'}, {value:7.2, label:'7.2°C', color:'#004aad'}] : []}
                     />
                </View>
                
                {/* 4. Footer Metadata */}
                <View style={styles.cardFooter}>
                    <View style={styles.footerRow}>
                        <Text style={styles.footerLabel}>📍 Ubicación:</Text>
                        <Text style={styles.footerValue}>{sensorLocation || 'N/A'}</Text>
                    </View>
                    <View style={styles.footerRow}>
                        <Text style={styles.footerLabel}>📅 Datos del:</Text>
                        <Text style={styles.footerValue}>{dateRangeLabel}</Text>
                    </View>
                    
                    <Text style={styles.footerTiny}>
                        Generado el {new Date().toLocaleDateString('es-AR')} a las {new Date().toLocaleTimeString('es-AR')}
                    </Text>
                </View>
            </View>
        </View>
    );
};

// =====================================================================
// PANTALLA PRINCIPAL
// =====================================================================
export default function SDDataClimateScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [range, setRange] = useState<TimeRange>('12h');
  const [isLoading, setIsLoading] = useState(false);
  
  // Datos
  const [tempDataChart, setTempDataChart] = useState<any[]>([]);
  const [humDataChart, setHumDataChart] = useState<any[]>([]);
  const [tempDataRaw, setTempDataRaw] = useState<any[]>([]);
  const [humDataRaw, setHumDataRaw] = useState<any[]>([]);
  
  const [agroStats, setAgroStats] = useState({ chillHours: 0, frostHours: 0, heatStressHours: 0 });

  // Simulación de metadata (esto vendría de tu DB en una app real)
  const sensorInfo = {
      name: "Estación Norte",
      location: "Lote 4 - Sector Frutales"
  };

  useEffect(() => { loadData(); }, [range]);

  // --- HELPER FECHAS ---
  const getDateRangeLabel = () => {
      // Como usamos datos Mock, simulamos la fecha de hoy
      const now = new Date();
      if (range === '12h' || range === '1D') return now.toLocaleDateString('es-AR');
      
      const past = new Date();
      if (range === '7D') past.setDate(now.getDate() - 7);
      if (range === '1M') past.setMonth(now.getMonth() - 1);
      if (range === '1A') past.setFullYear(now.getFullYear() - 1);
      
      return `${past.toLocaleDateString('es-AR')} al ${now.toLocaleDateString('es-AR')}`;
  };

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

  // --- MOCK DATA ---
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
        if (timeRange === '1A' && i >= 4 && i <= 7) val = 4 + (Math.random() * 6 - 4); // Invierno
        else val = 15 + (Math.random() * 15 - 5);
      } else {
        val = 50 + (Math.random() * 40);
      }
      data.push({ value: val, label: timeLabelFn(i), timestamp: new Date().getTime() - (points - i) * 3600000 }); // Mock timestamp
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
    await new Promise(r => setTimeout(r, 500)); // Simulamos carga

    const tRaw = generateClimateData(range, 'temp');
    const hRaw = generateClimateData(range, 'hum');
    
    setTempDataRaw(tRaw);
    setHumDataRaw(hRaw);

    setTempDataChart(processDataForChart(tRaw, 'temp'));
    setHumDataChart(processDataForChart(hRaw, 'hum'));

    setAgroStats(calculateAgroStats(tRaw, range));
    setIsLoading(false);
  };

  // --- EXPORTAR EXCEL ---
  const handleExportExcel = async () => {
    try {
        const dataToExport = tempDataRaw.map((t, index) => {
            const h = humDataRaw[index] || { value: 0 };
            return {
                "Tiempo": t.label || index,
                "Temp (°C)": t.value.toFixed(1),
                "Humedad (%)": h.value.toFixed(1),
                "Es Hora Frío?": (t.value > 0 && t.value <= 7.2) ? "SÍ" : "NO",
                "Es Helada?": (t.value <= 0) ? "SÍ" : "NO"
            };
        });

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Clima");
        const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

        // @ts-ignore
        const fs = FileSystem; 
        const directory = fs.documentDirectory || fs.cacheDirectory;
        const fileName = `Clima_${id}_${range}.xlsx`;
        await fs.writeAsStringAsync(directory + fileName, wbout, { encoding: 'base64' });

        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(directory + fileName, {
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                dialogTitle: 'Exportar Datos Climáticos',
                UTI: 'com.microsoft.excel.xlsx' 
            });
        }
    } catch (e) {
        Alert.alert("Error", "No se pudo generar el Excel.");
    }
  };

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
              </View>
              <View style={styles.divider} />
              <View style={styles.agroItem}>
                <MaterialCommunityIcons name="alert-octagon" size={24} color={agroStats.frostHours > 0 ? Colors.error : '#ccc'} />
                <Text style={[styles.agroValue, {color: agroStats.frostHours > 0 ? Colors.error : Colors.textPrimary}]}>
                  {Math.round(agroStats.frostHours)} h
                </Text>
                <Text style={styles.agroLabel}>Heladas</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.agroItem}>
                <MaterialCommunityIcons name="white-balance-sunny" size={24} color={Colors.warning} />
                <Text style={styles.agroValue}>{Math.round(agroStats.heatStressHours)} h</Text>
                <Text style={styles.agroLabel}>Calor Ext.</Text>
              </View>
            </View>

            {/* TARJETAS EXPORTABLES */}
            <ExportableChartCard 
                title="Temperatura Ambiente" 
                stats={calculateStandardStats(tempDataRaw)} 
                data={tempDataChart} 
                unit="°C" 
                color={Colors.secondary} 
                sensorId={String(id)}
                type={chartType}
                // Metadata
                sensorName={sensorInfo.name}
                sensorLocation={sensorInfo.location}
                dateRangeLabel={getDateRangeLabel()}
            />

            <ExportableChartCard 
                title="Humedad Relativa" 
                stats={calculateStandardStats(humDataRaw)} 
                data={humDataChart} 
                unit="%" 
                color={Colors.primary} 
                sensorId={String(id)}
                type={chartType}
                // Metadata
                sensorName={sensorInfo.name}
                sensorLocation={sensorInfo.location}
                dateRangeLabel={getDateRangeLabel()}
            />

            {/* BOTÓN EXCEL */}
            <View style={{marginTop: 30}}>
                <TouchableOpacity style={styles.syncButton} onPress={handleExportExcel}>
                    <MaterialCommunityIcons name="file-excel" size={24} color="#fff" />
                    <Text style={styles.syncBtnText}>Descargar Reporte CSV/Excel</Text>
                </TouchableOpacity>
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
  divider: { width: 1, backgroundColor: '#eee', height: '80%', alignSelf: 'center' },

  // BOTÓN
  syncButton: { 
      flexDirection: 'row', 
      backgroundColor: '#217346', 
      paddingVertical: 14, 
      justifyContent: 'center', 
      borderRadius: 12, 
      alignItems: 'center', 
      marginBottom: 30, 
      elevation: 3, 
      gap: 10 
  },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // ESTILOS EXPORTABLE (Igual que en B01)
  chartCardContainer: { marginTop: 20 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, paddingHorizontal: 4 },
  chartTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  miniExportButton: { padding: 5, backgroundColor: '#f0f0f0', borderRadius: 6, borderWidth: 1, borderColor: '#eee' },
  
  captureContainer: { backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#eee' },
  
  cardFooter: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  footerRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'center' },
  footerLabel: { fontSize: 10, color: '#999', fontWeight: '600', width: 60 },
  footerValue: { fontSize: 10, color: '#555', fontWeight: 'bold' },
  footerTiny: { fontSize: 8, color: '#aaa', marginTop: 4, textAlign: 'right' }
});