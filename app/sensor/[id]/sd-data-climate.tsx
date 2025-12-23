import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

// --- LIBRERÍAS ---
// @ts-ignore
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import * as XLSX from 'xlsx';

// Componentes
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';
import { Colors } from '../../../constants/Colors';

// Lógica
import { useBle } from '../../../context/BleContext';
import { insertReadingsC01 } from '../../../database/ReadingsRepository';
import { getSensorById } from '../../../database/SensorRepository';
import { SensorEntity } from '../../../database/types';

// Utils
import { useSDDownloader } from '../../../hooks/useSDDownloader';
import { downsampleData } from '../../../utils/dataProcessing';

// Definimos el tipo localmente para evitar conflictos con el del Hook general
type ClimateTimeRange = '12h' | '1D' | '7D' | '1M' | '1A';

// --- CONSTANTES AGRONÓMICAS ---
const CLIMATE_LINES = [
  { value: 0, label: 'Helada', color: '#4FC3F7' },     // Azul claro
  { value: 7.2, label: 'Hora Frío', color: '#1E88E5' }, // Azul medio
  { value: 35, label: 'Calor Ext.', color: '#FF7043' }  // Naranja
];

// --- HELPER PARA FECHAS LOCALES ---
const toLocalISOString = (date: Date) => {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localTime = new Date(date.getTime() - tzOffset);
  return localTime.toISOString().slice(0, -1);
};

// =====================================================================
// COMPONENTE TARJETA EXPORTABLE
// =====================================================================
interface ExportableCardProps {
  title: string;
  stats: any;
  data: any[];
  unit: string;
  color: string;
  sensorId: string;
  sensorName: string;
  sensorLocation: string;
  dateRangeLabel: string;
  type?: 'line' | 'bar';
  referenceLines?: any[];
}

const ExportableChartCard = ({ 
  title, stats, data, unit, color, sensorId, sensorName, sensorLocation, dateRangeLabel, 
  type = 'line', referenceLines = []
}: ExportableCardProps) => {
  const viewRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);

  const handleCapture = async () => {
    if (saving) return;
    setSaving(true);

    InteractionManager.runAfterInteractions(async () => {
      try {
        await new Promise(r => setTimeout(r, 200));
        if (!viewRef.current) throw new Error("Vista no montada");

        const uri = await captureRef(viewRef, {
          format: 'png', quality: 1, result: 'tmpfile',
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
      <View style={styles.chartHeader}>
        <View style={{flex: 1}} /> 
        <TouchableOpacity 
          style={styles.miniExportButton} 
          onPress={handleCapture}
          disabled={saving}
        >
          {saving ? <ActivityIndicator size="small" color={Colors.primary} /> : <MaterialCommunityIcons name="camera-outline" size={22} color={Colors.textSecondary} />}
        </TouchableOpacity>
      </View>

      <View ref={viewRef} collapsable={false} style={styles.captureContainer}>
        <View style={styles.innerHeader}>
          <Text style={styles.chartTitle}>{title}</Text>
          <Text style={styles.sensorSubtitle}>{sensorName || sensorId}</Text>
        </View>
        
        <StatPanel stats={stats} unit={unit} />
        
        <View style={{marginTop: 10, overflow: 'hidden'}}>
           <SensorChart 
             data={data} 
             type={type} 
             unit={unit} 
             color={color} 
             spacing={type === 'bar' ? 40 : 60} 
             referenceLines={referenceLines}
           />
        </View>
        
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
// PANTALLA PRINCIPAL CLIMA
// =====================================================================
export default function SDDataClimateScreen() {
  const { id } = useLocalSearchParams();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { connectedDevice } = useBle();
  
  const { 
    startDownload, cancelDownload, status, progressMsg, 
    fileProgress, totalFiles, filesProcessed, resetStatus 
  } = useSDDownloader();

  // Estados con el tipo local correcto
  const [range, setRange] = useState<ClimateTimeRange>('1D'); 
  const [isBusy, setIsBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');

  // Datos
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);
  const [downloadedData, setDownloadedData] = useState<any[]>([]); 
  
  // Gráficas
  const [climateChartData, setClimateChartData] = useState<any>(null);
  const [agroStats, setAgroStats] = useState({ chillHours: 0, frostHours: 0, heatStressHours: 0 });

  // Inicialización
  useEffect(() => {
    const init = async () => {
      const s = await getSensorById(sensorId);
      setSensorDb(s);
    };
    init();
    return () => resetStatus();
  }, [sensorId, resetStatus]); 

  // Helpers
  const getDateRangeLabel = () => {
      if (!downloadedData || downloadedData.length === 0) return range;
      const times = downloadedData.map(d => new Date(d.timestamp).getTime());
      const minDate = new Date(Math.min(...times));
      const maxDate = new Date(Math.max(...times));
      const fmt = (d: Date) => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      if (minDate.toDateString() === maxDate.toDateString()) return fmt(minDate);
      return `${fmt(minDate)} al ${fmt(maxDate)}`;
  };

  const formatForChart = (arr: any[], daysLoaded: number) => arr.map(p => {
      const d = new Date(p.timestamp);
      let label = (daysLoaded <= 2) 
        ? d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        : `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}h`;
      return { value: p.value, label };
  });

  const calculateStats = (arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map(d => d.value);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min: Math.min(...vals), max: Math.max(...vals), avg }; 
  };

  // Cálculo de indicadores agronómicos
  const calculateAgro = (rawData: any[]) => {
     let chill = 0;
     let frost = 0;
     let heat = 0;
     
     for (let i = 1; i < rawData.length; i++) {
        const t1 = new Date(rawData[i-1].timestamp).getTime();
        const t2 = new Date(rawData[i].timestamp).getTime();
        const hours = (t2 - t1) / 3600000; // Diferencia en horas
        
        if (hours > 24) continue;

        const temp = rawData[i].air_temp;
        
        if (temp > 0 && temp <= 7.2) chill += hours;
        if (temp <= 0) frost += hours;
        if (temp >= 35) heat += hours;
     }
     
     return { chillHours: chill, frostHours: frost, heatStressHours: heat };
  };

  // Procesamiento
  const processVisualization = useCallback((rawData: any[]) => {
    if (!sensorDb) return;
    
    const processedRaw = rawData.map(d => ({ 
        timestamp: d.timestamp,
        air_temp: d.air_temp,
        humidity: d.humidity
    }));

    // Lógica corregida para los tipos de ClimateTimeRange
    let days = 1;
    if (range === '7D') days = 7;
    if (range === '1M') days = 30;
    if (range === '1A') days = 365;

    let intervalMs = 3600 * 1000; // 1h default
    if (days > 20) intervalMs = 24 * 3600 * 1000; // Diario si es > 20 días
    else if (days > 3) intervalMs = 6 * 3600 * 1000; // Cada 6h si es > 3 días

    const prepare = (dataKey: string) => ({
        data: formatForChart(downsampleData(processedRaw, dataKey, intervalMs), days),
        stats: calculateStats(downsampleData(processedRaw, dataKey, intervalMs))
    });

    setClimateChartData({
        temp: prepare('air_temp'),
        hum: prepare('humidity'),
    });

    setAgroStats(calculateAgro(processedRaw));

  }, [sensorDb, range]); 

  // Acciones
  const handleStartDownload = async () => {
      if (!connectedDevice || !sensorDb) { Alert.alert("Error", "Sensor no conectado."); return; }
      setIsBusy(true); setBusyMessage("Iniciando descarga...");
      
      const now = new Date(); 
      let start = new Date();
      
      // Definir fecha inicio según ClimateTimeRange
      if (range === '12h') start.setHours(now.getHours() - 12);
      else if (range === '1D') start.setDate(now.getDate() - 1);
      else if (range === '7D') start.setDate(now.getDate() - 7);
      else if (range === '1M') start.setMonth(now.getMonth() - 1);
      else if (range === '1A') start.setFullYear(now.getFullYear() - 1);

      // Usamos 'Custom' internamente para el hook (que espera el tipo del hook, no el nuestro local)
      const data = await startDownload(connectedDevice, sensorDb.type, 'Custom', start, now);
      
      if (data && data.length > 0) {
          setDownloadedData(data); setBusyMessage(`Procesando ${data.length} registros...`);
          setTimeout(() => { processVisualization(data); setIsBusy(false); }, 100);
      } else { 
          setIsBusy(false); 
          if (status !== 'error') Alert.alert("Aviso", "No se encontraron datos en ese rango."); 
      }
  };

  const handleCancel = () => { cancelDownload(); setIsBusy(false); };

  const handleExportExcel = async () => {
    if (downloadedData.length === 0) { Alert.alert("Sin datos", "No hay datos."); return; }
    try {
        setIsBusy(true); setBusyMessage("Generando Excel...");
        const dataToExport = downloadedData.map(item => {
            const temp = item.air_temp;
            return {
                "Fecha y Hora": new Date(item.timestamp).toLocaleString('es-AR'),
                "Temp. Aire (°C)": temp,
                "Humedad Rel. (%)": item.humidity,
                "Hora Frío?": (temp > 0 && temp <= 7.2) ? "SÍ" : "NO",
                "Helada?": (temp <= 0) ? "SÍ" : "NO",
                "Batería (mV)": item.battery_mv || 0
            };
        });

        const ws = XLSX.utils.json_to_sheet(dataToExport); 
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Clima");
        const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        
        // @ts-ignore
        const fs = FileSystem; const dir = fs.documentDirectory || fs.cacheDirectory;
        const uri = dir + `Clima_${sensorId}_${range}.xlsx`;
        await fs.writeAsStringAsync(uri, wbout, { encoding: 'base64' });
        
        setIsBusy(false);
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { 
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
                dialogTitle: 'Exportar Clima', 
                UTI: 'com.microsoft.excel.xlsx' 
            });
        }
    } catch (_) { 
        setIsBusy(false); 
        Alert.alert("Error", "No se pudo generar el Excel."); 
    }
  };

  const handleSync = async () => {
    if (downloadedData.length === 0) return;
    Alert.alert("Importar", `Se guardarán ${downloadedData.length} registros en la App.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: async () => {
            setIsBusy(true); setBusyMessage("Guardando en base de datos...");
            try {
                await new Promise(r => setTimeout(r, 100));
                const dataToInsert = downloadedData.map(p => ({
                    ...p, 
                    sensor_id: String(sensorId), 
                    timestamp: toLocalISOString(new Date(p.timestamp)), 
                    is_synced: 0, 
                    updated_at: new Date().toISOString()
                }));
                
                const added = await insertReadingsC01(dataToInsert as any);
                setIsBusy(false);
                Alert.alert("Éxito", `Se importaron ${added} registros nuevos.`, [{ 
                    text: "OK", 
                    onPress: () => { 
                        resetStatus(); 
                        setDownloadedData([]); 
                        if(router.canGoBack()) router.back(); 
                    }
                }]);
            } catch (_) { 
                setIsBusy(false); 
                Alert.alert("Error DB", "No se pudo guardar la información."); 
            }
        }}
    ]);
  };

  const chartType = (range === '1M' || range === '1A') ? 'bar' : 'line';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View><Text style={styles.title}>Descargar Clima (SD)</Text></View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {/* Panel Control */}
        <View style={styles.controlPanel}>
            <Text style={styles.label}>Rango de descarga:</Text>
            <View style={styles.filterContainer}>
            {(['12h', '1D', '7D', '1M', '1A'] as ClimateTimeRange[]).map((r) => (
                <TouchableOpacity key={r} style={[styles.filterBtn, range === r && styles.filterBtnActive]} onPress={() => setRange(r)}>
                <Text style={[styles.filterText, range === r && styles.filterTextActive]}>{r}</Text>
                </TouchableOpacity>
            ))}
            </View>
            
            <TouchableOpacity style={styles.downloadButton} onPress={handleStartDownload}>
                <MaterialCommunityIcons name="cloud-download-outline" size={24} color="#fff" />
                <Text style={styles.downloadText}>DESCARGAR DATOS</Text>
            </TouchableOpacity>
        </View>

        {/* Visualización */}
        {!isBusy && downloadedData.length > 0 && climateChartData && (
            <View>
                {/* Resumen General */}
                <View style={{paddingHorizontal: 16, marginTop: 10}}>
                    <View style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                                <MaterialCommunityIcons name="database-check" size={24} color={Colors.success} />
                                <View style={{marginLeft: 10}}>
                                    <Text style={styles.summaryTitle}>Datos: {downloadedData.length}</Text>
                                    <Text style={styles.summaryText}>registros obtenidos.</Text>
                                </View>
                            </View>
                            <TouchableOpacity style={styles.toolButton} onPress={handleExportExcel}>
                                <MaterialCommunityIcons name="microsoft-excel" size={22} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Panel Agro */}
                <View style={{paddingHorizontal: 16, marginTop: 15}}>
                    <Text style={styles.sectionTitle}>Indicadores Calculados</Text>
                    <View style={styles.agroPanel}>
                      <View style={styles.agroItem}>
                        <MaterialCommunityIcons name="snowflake" size={24} color="#004aad" />
                        <Text style={styles.agroValue}>{Math.round(agroStats.chillHours)} h</Text>
                        <Text style={styles.agroLabel}>Horas Frío</Text>
                      </View>
                      <View style={styles.dividerVertical} />
                      <View style={styles.agroItem}>
                        <MaterialCommunityIcons name="alert-octagon" size={24} color={agroStats.frostHours > 0 ? Colors.error : '#ccc'} />
                        <Text style={[styles.agroValue, {color: agroStats.frostHours > 0 ? Colors.error : Colors.textPrimary}]}>
                          {Math.round(agroStats.frostHours)} h
                        </Text>
                        <Text style={styles.agroLabel}>Heladas</Text>
                      </View>
                      <View style={styles.dividerVertical} />
                      <View style={styles.agroItem}>
                        <MaterialCommunityIcons name="white-balance-sunny" size={24} color={Colors.warning} />
                        <Text style={styles.agroValue}>{Math.round(agroStats.heatStressHours)} h</Text>
                        <Text style={styles.agroLabel}>Calor Ext.</Text>
                      </View>
                    </View>
                </View>

                {/* Gráficos */}
                <View style={styles.content}>
                    <ExportableChartCard 
                        title="Temperatura Ambiente" 
                        stats={climateChartData.temp.stats} data={climateChartData.temp.data} 
                        unit="°C" color={Colors.secondary}
                        sensorId={String(sensorId)} sensorName={sensorDb?.alias || ''} sensorLocation={sensorDb?.location || ''} 
                        dateRangeLabel={getDateRangeLabel()}
                        referenceLines={CLIMATE_LINES} 
                        type={chartType}
                    />
                    
                    <ExportableChartCard 
                        title="Humedad Relativa" 
                        stats={climateChartData.hum.stats} data={climateChartData.hum.data} 
                        unit="%" color={Colors.primary}
                        sensorId={String(sensorId)} sensorName={sensorDb?.alias || ''} sensorLocation={sensorDb?.location || ''} 
                        dateRangeLabel={getDateRangeLabel()}
                        type={chartType}
                    />
                </View>

                {/* Botón Sincronizar */}
                <View style={[styles.content, {marginTop: 20}]}>
                    <TouchableOpacity style={styles.syncButton} onPress={handleSync}>
                        <MaterialCommunityIcons name="content-save" size={20} color="#fff" />
                        <Text style={styles.syncBtnText}>Guardar en Historial App</Text>
                    </TouchableOpacity>
                </View>
            </View>
        )}
      </ScrollView>

      {isBusy && (
        <View style={styles.loadingOverlay}>
            <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingTitle}>Procesando...</Text>
                <Text style={styles.loadingText}>{busyMessage || progressMsg}</Text>
                {status === 'downloading' && totalFiles > 0 && <><Text style={styles.loadingSub}>Archivo {filesProcessed + 1} de {totalFiles}</Text><View style={styles.progressBarBg}><View style={[styles.progressBarFill, { width: `${fileProgress}%` }]} /></View></>}
                {status === 'downloading' && <TouchableOpacity style={styles.cancelLink} onPress={handleCancel}><Text style={styles.cancelLinkText}>Cancelar</Text></TouchableOpacity>}
            </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  backButton: { marginRight: 15, padding: 5 },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  
  controlPanel: { backgroundColor: '#fff', padding: 16, marginBottom: 10, elevation: 2 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  filterContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, gap: 5 },
  filterBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#eee' },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  filterTextActive: { color: '#fff' },
  
  downloadButton: { flexDirection: 'row', backgroundColor: Colors.secondary, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  downloadText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },
  
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 },
  loadingBox: { width: '80%', backgroundColor: '#fff', borderRadius: 16, padding: 25, alignItems: 'center', elevation: 10 },
  loadingTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginTop: 15, marginBottom: 5 },
  loadingText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 5 },
  loadingSub: { fontSize: 12, color: '#888', marginBottom: 15 },
  progressBarBg: { width: '100%', height: 10, backgroundColor: '#eee', borderRadius: 5, overflow: 'hidden', marginBottom: 20 },
  progressBarFill: { height: '100%', backgroundColor: Colors.primary },
  cancelLink: { padding: 10 },
  cancelLinkText: { color: Colors.error, fontWeight: 'bold', fontSize: 14 },

  summaryCard: { backgroundColor: '#e8f5e9', padding: 12, borderRadius: 12, borderLeftWidth: 5, borderLeftColor: Colors.success },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  summaryText: { fontSize: 12, color: Colors.textSecondary },
  
  toolButton: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#217346', justifyContent: 'center', alignItems: 'center', elevation: 2 },

  content: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 10 },

  // Panel Agro
  agroPanel: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, padding: 15, elevation: 2, marginBottom: 15, borderWidth: 1, borderColor: '#eee', justifyContent: 'space-between' },
  agroItem: { flex: 1, alignItems: 'center' },
  agroValue: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginVertical: 4 },
  agroLabel: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary },
  dividerVertical: { width: 1, backgroundColor: '#eee', height: '80%', alignSelf: 'center' },

  syncButton: { flexDirection: 'row', backgroundColor: Colors.success, paddingVertical: 14, justifyContent: 'center', borderRadius: 12, alignItems: 'center', marginBottom: 30, elevation: 3, gap: 10 },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // Tarjetas Exportables
  chartCardContainer: { marginTop: 20 },
  chartHeader: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: -20, zIndex: 10, paddingRight: 5 },
  miniExportButton: { padding: 8, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#eee', elevation: 3 },
  captureContainer: { backgroundColor: '#fff', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: '#eee', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: {width:0, height:2} },
  innerHeader: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingBottom: 8, marginBottom: 10 },
  chartTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  sensorSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardFooter: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  footerRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'center' },
  footerLabel: { fontSize: 10, color: '#999', fontWeight: '600', width: 60 },
  footerValue: { fontSize: 10, color: '#555', fontWeight: 'bold' },
  footerTiny: { fontSize: 8, color: '#aaa', marginTop: 4, textAlign: 'right' }
});