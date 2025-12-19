import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    ScrollView,
    StyleSheet,
    Text,
    TextInput, // <--- Usamos esto en vez de DateTimePicker
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Componentes
import SegmentedControl from '../../../components/global/SegmentedControl';
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';
import { Colors } from '../../../constants/Colors';

// Lógica
import { useBle } from '../../../context/BleContext';
import { getElectrodesBySensor } from '../../../database/ElectrodeRepository';
import { insertReadingsB01, insertReadingsC01 } from '../../../database/ReadingsRepository';
import { getSensorById } from '../../../database/SensorRepository';
import { LinearSegment, SensorEntity } from '../../../database/types';

// Utils
import { TimeRange, useSDDownloader } from '../../../hooks/useSDDownloader';
import { calculateMoistureFromSegments } from '../../../utils/calibration';
import { calculateMedian, downsampleData } from '../../../utils/dataProcessing';

type UnitType = '% Hv' | '% Hg' | 'mV';

export default function SDDataScreen() {
  const { id } = useLocalSearchParams();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { connectedDevice } = useBle();
  
  const { 
    startDownload, cancelDownload, status, progressMsg, 
    fileProgress, totalFiles, filesProcessed, resetStatus 
  } = useSDDownloader();

  // Estados UI
  const [range, setRange] = useState<TimeRange>('Hoy');
  const [unit, setUnit] = useState<UnitType>('% Hv');
  
  // Estado Carga
  const [isBusy, setIsBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');

  // --- REEMPLAZO DEL DATEPICKER ---
  // En lugar de fechas complejas, usamos un número simple de días
  const [customDays, setCustomDays] = useState('3'); // Por defecto 3 días

  // Datos
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);
  const [electrodeConfig, setElectrodeConfig] = useState<Record<number, LinearSegment[]>>({});
  const [downloadedData, setDownloadedData] = useState<any[]>([]); 
  const [electrodesData, setElectrodesData] = useState<any>(null);
  const [soilTempData, setSoilTempData] = useState<any>(null); 
  const [climateChartData, setClimateChartData] = useState<any>(null);

  // Inicialización
  useEffect(() => {
    const init = async () => {
      const s = await getSensorById(sensorId);
      setSensorDb(s);
      if (s?.type === 'B01') {
          const elecs = await getElectrodesBySensor(sensorId);
          const configMap: Record<number, LinearSegment[]> = {};
          elecs.forEach(e => {
             if (e.equations_json) {
                 try { configMap[e.electrode_index] = JSON.parse(e.equations_json); } catch {}
             }
          });
          setElectrodeConfig(configMap);
      }
    };
    init();
    return () => resetStatus();
  }, [sensorId]); 

  // --- LOGICA DE DESCARGA ---
  const handleStartDownload = async () => {
      Keyboard.dismiss(); // Cerrar teclado si está abierto
      if (!connectedDevice || !sensorDb) {
          Alert.alert("Error", "Sensor no conectado.");
          return;
      }
      
      setIsBusy(true);
      setBusyMessage("Iniciando descarga...");

      // Calcular fechas basadas en el Input Numérico o el Botón
      const now = new Date();
      let start = new Date();
      
      if (range === 'Custom') {
          // Si eligió custom, restamos los días que escribió en el input
          const daysToSubtract = parseInt(customDays) || 1;
          start.setDate(now.getDate() - daysToSubtract);
      } else {
          // El hook ya maneja 'Hoy', '1D', '7D', etc. 
          // Pero para consistencia podemos pasarle las fechas nosotros si queremos
          // Dejemos que el hook maneje los predeterminados, y solo pasamos fechas en Custom
      }

      // Llamada al hook
      // Nota: Si range no es 'Custom', los parametros dateStart/End son ignorados por el hook (según tu lógica anterior)
      // Si range ES 'Custom', usamos la fecha calculada aquí.
      const data = await startDownload(connectedDevice, sensorDb.type, range, start, now);
      
      if (data && data.length > 0) {
          setDownloadedData(data);
          setBusyMessage(`Procesando ${data.length} registros...`);
          setTimeout(() => {
              processVisualization(data);
              setIsBusy(false);
          }, 100);
      } else {
          setIsBusy(false);
          if (status !== 'error') {
             Alert.alert("Aviso", "No se encontraron datos en el periodo.");
          }
      }
  };

  const handleCancel = () => {
      cancelDownload();
      setIsBusy(false);
  };

  // Cambio de Unidad
  useEffect(() => {
      if (downloadedData.length > 0 && !isBusy) {
          setIsBusy(true);
          setBusyMessage("Actualizando unidades...");
          setTimeout(() => {
              processVisualization(downloadedData);
              setIsBusy(false);
          }, 50);
      }
  }, [unit]);

  // --- PROCESAMIENTO ---
  const processVisualization = (rawData: any[]) => {
    if (!sensorDb) return;
    const isB01 = sensorDb.type === 'B01';
    
    const processedRaw = rawData.map(d => {
        let v1 = d.e1_mv, v2 = d.e2_mv, v3 = d.e3_mv;
        if (isB01 && unit !== 'mV') {
            const rho = 1.3; 
            if (electrodeConfig[1]) v1 = calculateMoistureFromSegments(d.e1_mv, electrodeConfig[1]);
            if (electrodeConfig[2]) v2 = calculateMoistureFromSegments(d.e2_mv, electrodeConfig[2]);
            if (electrodeConfig[3]) v3 = calculateMoistureFromSegments(d.e3_mv, electrodeConfig[3]);
            if (unit === '% Hg') { v1/=rho; v2/=rho; v3/=rho; }
        }
        return { ...d, v1, v2, v3 };
    });

    // Calcular intervalo dinámico basado en la cantidad de días
    const days = range === 'Custom' ? (parseInt(customDays) || 1) : (range === '30D' ? 30 : range === '7D' ? 7 : 1);
    
    let intervalMs = 3600 * 1000; // 1h default
    if (days > 20) intervalMs = 24 * 3600 * 1000; // >20 días -> 1 dato por día
    else if (days > 3) intervalMs = 6 * 3600 * 1000; // >3 días -> cada 6h

    if (isB01) {
        const e1 = downsampleData(processedRaw, 'v1', intervalMs);
        const e2 = downsampleData(processedRaw, 'v2', intervalMs);
        const e3 = downsampleData(processedRaw, 'v3', intervalMs);
        const tSoil = downsampleData(processedRaw, 'soil_temp', intervalMs);

        setElectrodesData({
            1: { data: formatForChart(e1, days), stats: calculateStats(e1) },
            2: { data: formatForChart(e2, days), stats: calculateStats(e2) },
            3: { data: formatForChart(e3, days), stats: calculateStats(e3) },
        });
        setSoilTempData({
            data: formatForChart(tSoil, days),
            stats: calculateStats(tSoil)
        });
    } else {
        const tData = downsampleData(processedRaw, 'air_temp', intervalMs);
        const hData = downsampleData(processedRaw, 'humidity', intervalMs);
        setClimateChartData({
            temp: { data: formatForChart(tData, days), stats: calculateStats(tData) },
            hum: { data: formatForChart(hData, days), stats: calculateStats(hData) }
        });
    }
  };

  const formatForChart = (arr: any[], daysLoaded: number) => arr.map(p => {
      const d = new Date(p.timestamp);
      // Si son pocos días mostramos la hora, si son muchos mostramos Fecha
      let label = (daysLoaded <= 2) 
        ? d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        : `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}h`;
      return { value: p.value, label };
  });

  const calculateStats = (arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map(d => d.value);
    return { 
        min: Math.min(...vals), 
        max: Math.max(...vals), 
        avg: calculateMedian(vals) 
    }; 
  };

  // Guardar en DB
  const handleSync = async () => {
    if (downloadedData.length === 0) return;
    Alert.alert("Guardar", `Se procesarán ${downloadedData.length} registros.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: async () => {
            try {
                const dataToInsert = downloadedData.map(p => ({
                    ...p, sensor_id: sensorId, timestamp: new Date(p.timestamp).toISOString(), 
                    is_synced: 0, updated_at: new Date().toISOString(),
                    e1_hv: 0, e1_hg: 0, e2_hv: 0, e2_hg: 0, e3_hv: 0, e3_hg: 0,
                }));
                let added = 0;
                if (sensorDb?.type === 'B01') added = await insertReadingsB01(dataToInsert as any); 
                else added = await insertReadingsC01(dataToInsert as any);
                Alert.alert("Éxito", `Agregados: ${added}. Nuevos.`, [{ text: "OK", onPress: () => { resetStatus(); setDownloadedData([]); if(router.canGoBack()) router.back(); }}]);
            } catch(e) { console.error(e); Alert.alert("Error DB"); }
        }}
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View><Text style={styles.title}>Descargar SD</Text></View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        
        <View style={styles.controlPanel}>
            <Text style={styles.label}>Intervalo:</Text>
            <View style={styles.filterContainer}>
            {/* Botones Estándar */}
            {(['Hoy', '1D', '7D', '30D', 'Custom'] as TimeRange[]).map((r) => (
                <TouchableOpacity key={r} style={[styles.filterBtn, range === r && styles.filterBtnActive]} onPress={() => setRange(r)}>
                <Text style={[styles.filterText, range === r && styles.filterTextActive]}>
                    {r === 'Custom' ? 'Manual' : r}
                </Text>
                </TouchableOpacity>
            ))}
            </View>

            {/* INPUT MANUAL DE DÍAS (Sin DatePicker que falla) */}
            {range === 'Custom' && (
                <View style={styles.customInputRow}>
                    <Text style={styles.customLabel}>Descargar últimos:</Text>
                    <View style={styles.inputWrapper}>
                        <TextInput 
                            style={styles.input}
                            value={customDays}
                            onChangeText={setCustomDays}
                            keyboardType="number-pad"
                            maxLength={3}
                            selectTextOnFocus
                        />
                        <Text style={styles.inputUnit}>Días</Text>
                    </View>
                    <Text style={styles.helperText}>
                        (Desde {new Date(new Date().setDate(new Date().getDate() - (parseInt(customDays)||0))).toLocaleDateString()} hasta Hoy)
                    </Text>
                </View>
            )}

            <TouchableOpacity style={styles.downloadButton} onPress={handleStartDownload}>
                <MaterialCommunityIcons name="download" size={24} color="#fff" />
                <Text style={styles.downloadText}>INICIAR DESCARGA</Text>
            </TouchableOpacity>
        </View>

        {/* VISUALIZACIÓN */}
        {!isBusy && downloadedData.length > 0 && (
            <View>
                <View style={{paddingHorizontal: 16, marginTop: 10}}>
                    <View style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <MaterialCommunityIcons name="database-check" size={24} color={Colors.success} />
                            <View style={{marginLeft: 10}}>
                                <Text style={styles.summaryTitle}>Datos Recuperados</Text>
                                <Text style={styles.summaryText}>
                                    <Text style={{fontWeight:'bold'}}>{downloadedData.length}</Text> registros procesados.
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {sensorDb?.type === 'B01' && electrodesData && (
                    <View style={styles.content}>
                        <View style={{ marginTop: 15 }}>
                            <SegmentedControl options={['% Hv', '% Hg', 'mV']} selectedIndex={unit === '% Hv' ? 0 : unit === '% Hg' ? 1 : 2} onChange={(i) => setUnit(i === 0 ? '% Hv' : i === 1 ? '% Hg' : 'mV')} />
                        </View>
                        {soilTempData && (
                            <View style={{ marginTop: 25 }}>
                                <Text style={styles.sectionTitle}>Temperatura Suelo</Text>
                                <StatPanel stats={soilTempData.stats} unit="°C" />
                                <SensorChart data={soilTempData.data} type="line" unit="°C" color={Colors.secondary} />
                            </View>
                        )}
                        {[1, 2, 3].map((num) => (
                            <View key={num} style={{ marginTop: 25 }}>
                                <Text style={styles.sectionTitle}>Electrodo {num}</Text>
                                <StatPanel stats={electrodesData[num]?.stats} unit={unit} />
                                <SensorChart data={electrodesData[num]?.data} type="line" unit={unit} color={Colors.primary} />
                            </View>
                        ))}
                    </View>
                )}

                {sensorDb?.type === 'C01' && climateChartData && (
                    <View style={styles.content}>
                         <View style={{ marginTop: 25 }}>
                            <Text style={styles.sectionTitle}>Temperatura</Text>
                            <StatPanel stats={climateChartData.temp.stats} unit="°C" />
                            <SensorChart data={climateChartData.temp.data} type="line" unit="°C" color={Colors.secondary} />
                         </View>
                         <View style={{ marginTop: 25 }}>
                            <Text style={styles.sectionTitle}>Humedad</Text>
                            <StatPanel stats={climateChartData.hum.stats} unit="%" />
                            <SensorChart data={climateChartData.hum.data} type="line" unit="%" color={Colors.primary} />
                         </View>
                    </View>
                )}
                
                <View style={styles.content}>
                    <TouchableOpacity style={styles.syncButton} onPress={handleSync}>
                        <Text style={styles.syncBtnText}>Confirmar e Importar</Text>
                    </TouchableOpacity>
                </View>
            </View>
        )}
      </ScrollView>

      {/* OVERLAY */}
      {isBusy && (
        <View style={styles.loadingOverlay}>
            <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingTitle}>Procesando...</Text>
                <Text style={styles.loadingText}>{busyMessage || progressMsg}</Text>
                
                {status === 'downloading' && totalFiles > 0 && (
                    <>
                        <Text style={styles.loadingSub}>Archivo {filesProcessed + 1} de {totalFiles}</Text>
                        <View style={styles.progressBarBg}><View style={[styles.progressBarFill, { width: `${fileProgress}%` }]} /></View>
                    </>
                )}
                <TouchableOpacity style={styles.cancelLink} onPress={handleCancel}>
                    <Text style={styles.cancelLinkText}>Cancelar</Text>
                </TouchableOpacity>
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
  
  // Custom Input Styles (Reemplaza al DatePicker)
  customInputRow: { alignItems: 'center', marginVertical: 15, backgroundColor: '#f9f9f9', padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#eee' },
  customLabel: { fontSize: 14, color: Colors.textSecondary, marginBottom: 10 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { 
      backgroundColor: '#fff', width: 80, height: 50, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary,
      textAlign: 'center', fontSize: 24, fontWeight: 'bold', color: Colors.textPrimary 
  },
  inputUnit: { fontSize: 16, fontWeight: 'bold', color: Colors.textSecondary },
  helperText: { marginTop: 8, fontSize: 12, color: '#888', fontStyle: 'italic' },

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

  summaryCard: { backgroundColor: '#e8f5e9', padding: 15, borderRadius: 12, borderLeftWidth: 5, borderLeftColor: Colors.success },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  summaryText: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  content: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 8, marginTop: 5 },
  actionSection: { marginTop: 40, borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingTop: 20, paddingBottom: 30 },
  syncButton: { flexDirection: 'row', backgroundColor: Colors.success, paddingVertical: 14, justifyContent: 'center', borderRadius: 12, alignItems: 'center', marginBottom: 15, elevation: 3, gap: 10 },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});