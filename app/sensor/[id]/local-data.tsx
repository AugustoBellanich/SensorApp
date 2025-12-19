import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- COMPONENTES ---
import SegmentedControl from '../../../components/global/SegmentedControl';
import SensorChart from '../../../components/sensor/SensorChart';
import StatPanel from '../../../components/sensor/StatPanel';
import { Colors } from '../../../constants/Colors';

// --- LÓGICA Y CONTEXTO ---
import { useBle } from '../../../context/BleContext';
import { getElectrodesBySensor } from '../../../database/ElectrodeRepository';
import { insertReadingsB01, insertReadingsC01 } from '../../../database/ReadingsRepository';
import { getSensorById } from '../../../database/SensorRepository';
import { LinearSegment, SensorEntity } from '../../../database/types';

// --- HOOKS Y UTILS ---
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
  
  // Hook de descarga
  const { 
    startDownload, cancelDownload, status, progressMsg, 
    fileProgress, totalFiles, filesProcessed, resetStatus 
  } = useSDDownloader();

  // --- ESTADOS ---
  const [range, setRange] = useState<TimeRange>('Hoy');
  const [unit, setUnit] = useState<UnitType>('% Hv');
  
  // Estado Maestro de Carga (Bloquea la pantalla)
  const [isBusy, setIsBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');

  // Fechas Custom (Lógica igual a tu ejemplo LocalDataScreen)
  const [dateStart, setDateStart] = useState(new Date());
  const [dateEnd, setDateEnd] = useState(new Date());
  const [showPicker, setShowPicker] = useState<'start' | 'end' | null>(null);

  // Datos
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);
  const [electrodeConfig, setElectrodeConfig] = useState<Record<number, LinearSegment[]>>({});
  
  // Datos Crudos (Para guardar en DB)
  const [downloadedData, setDownloadedData] = useState<any[]>([]); 
  
  // Datos Procesados (Para visualizar)
  const [electrodesData, setElectrodesData] = useState<any>(null);
  const [soilTempData, setSoilTempData] = useState<any>(null); 
  const [climateChartData, setClimateChartData] = useState<any>(null);

  // 1. CARGA INICIAL
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
  }, [sensorId, resetStatus]);

  // 2. LOGICA DE DESCARGA (SIN USEEFFECT PARA EVITAR BUCLES)
  const handleStartDownload = async () => {
      if (!connectedDevice || !sensorDb) {
          Alert.alert("Error", "Sensor no conectado.");
          return;
      }
      
      // A. BLOQUEAR PANTALLA
      setIsBusy(true);
      setBusyMessage("Iniciando descarga...");

      // B. DESCARGAR
      const data = await startDownload(connectedDevice, sensorDb.type, range, dateStart, dateEnd);
      
      // C. PROCESAR RESULTADO
      if (data && data.length > 0) {
          setDownloadedData(data); // Guardar crudos
          
          setBusyMessage(`Procesando ${data.length} puntos...`);
          
          // D. CALCULAR GRÁFICAS (Imperativo, para no usar useEffect)
          // Usamos un pequeño timeout para que el UI thread respire
          setTimeout(() => {
              processVisualization(data);
              setIsBusy(false); // DESBLOQUEAR
          }, 100);

      } else {
          setIsBusy(false); // DESBLOQUEAR ERROR
          if (status !== 'error') {
             Alert.alert("Aviso", "No se encontraron datos en el periodo seleccionado.");
          }
      }
  };

  const handleCancel = () => {
      cancelDownload();
      setIsBusy(false);
  };

  // 3. CAMBIO DE UNIDAD (Solo re-calcula si ya tenemos datos descargados)
  useEffect(() => {
      if (downloadedData.length > 0 && !isBusy) {
          setIsBusy(true);
          setBusyMessage("Actualizando unidades...");
          setTimeout(() => {
              processVisualization(downloadedData);
              setIsBusy(false);
          }, 50);
      }
  }, [unit]); // Dependencia única: unit

  // 4. PROCESAMIENTO DE VISUALIZACIÓN
  const processVisualization = (rawData: any[]) => {
    if (!sensorDb) return;
    const isB01 = sensorDb.type === 'B01';
    
    // A. Pre-procesar valores
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

    // B. Intervalo
    let intervalMs = 3600 * 1000; 
    if (range === '7D') intervalMs = 6 * 3600 * 1000; 
    else if (range === '30D') intervalMs = 24 * 3600 * 1000; 
    else if (range === 'Custom') {
        const diffDays = Math.ceil(Math.abs(dateEnd.getTime() - dateStart.getTime()) / 86400000);
        if (diffDays <= 2) intervalMs = 3600 * 1000; 
        else if (diffDays <= 10) intervalMs = 6 * 3600 * 1000; 
        else intervalMs = 24 * 3600 * 1000;
    }

    // C. Downsampling
    if (isB01) {
        const e1 = downsampleData(processedRaw, 'v1', intervalMs);
        const e2 = downsampleData(processedRaw, 'v2', intervalMs);
        const e3 = downsampleData(processedRaw, 'v3', intervalMs);
        const tSoil = downsampleData(processedRaw, 'soil_temp', intervalMs);

        setElectrodesData({
            1: { data: formatForChart(e1, range), stats: calculateStats(e1) },
            2: { data: formatForChart(e2, range), stats: calculateStats(e2) },
            3: { data: formatForChart(e3, range), stats: calculateStats(e3) },
        });
        setSoilTempData({
            data: formatForChart(tSoil, range),
            stats: calculateStats(tSoil)
        });
    } else {
        const tData = downsampleData(processedRaw, 'air_temp', intervalMs);
        const hData = downsampleData(processedRaw, 'humidity', intervalMs);
        
        setClimateChartData({
            temp: { data: formatForChart(tData, range), stats: calculateStats(tData) },
            hum: { data: formatForChart(hData, range), stats: calculateStats(hData) }
        });
    }
  };

  const formatForChart = (arr: any[], currentRange: TimeRange) => arr.map(p => {
      const d = new Date(p.timestamp);
      let label = (currentRange === 'Hoy' || currentRange === '1D') 
        ? d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        : `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}h`;
      return { value: p.value, label };
  });

  const calculateStats = (arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map(d => d.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const med = calculateMedian(vals); 
    return { min, max, avg: med }; 
  };

  // 5. GUARDAR DB
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
                
                Alert.alert("Éxito", `Agregados: ${added}. Duplicados ignorados: ${dataToInsert.length - added}.`, [{ 
                    text: "OK", 
                    onPress: () => {
                        resetStatus();
                        setDownloadedData([]);
                        setTimeout(() => { if (router.canGoBack()) router.back(); }, 100);
                    }
                }]);
            } catch(e) { console.error(e); Alert.alert("Error DB", "Fallo al guardar."); }
        }}
    ]);
  };

  // --- DATE PICKER CORREGIDO (Lógica de LocalDataScreen) ---
  const onDateChange = (event: any, selectedDate?: Date) => {
      const type = showPicker; // Capturamos el tipo ANTES de cerrar
      setShowPicker(null);     // Cerramos inmediatamente el modal

      if (event.type === 'dismissed' || !selectedDate) return;

      if (type === 'start') {
          setDateStart(selectedDate);
          // Si Inicio > Fin, movemos Fin para que coincida (o sea un intervalo de 0 días)
          if (selectedDate > dateEnd) setDateEnd(selectedDate);
      } else if (type === 'end') {
          // Si Fin < Inicio, damos error (o podríamos ajustar inicio, según prefieras)
          if (selectedDate < dateStart) {
              Alert.alert("Error", "La fecha final no puede ser anterior a la inicial.");
          } else {
              setDateEnd(selectedDate);
          }
      }
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

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* PANEL CONTROL */}
        <View style={styles.controlPanel}>
            <Text style={styles.label}>Intervalo:</Text>
            <View style={styles.filterContainer}>
            {(['Hoy', '1D', '7D', '30D', 'Custom'] as TimeRange[]).map((r) => (
                <TouchableOpacity key={r} style={[styles.filterBtn, range === r && styles.filterBtnActive]} onPress={() => setRange(r)}>
                <Text style={[styles.filterText, range === r && styles.filterTextActive]}>{r}</Text>
                </TouchableOpacity>
            ))}
            </View>

            {range === 'Custom' && (
                <View style={styles.customDateRow}>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker('start')}>
                        <Text style={styles.dateLabel}>Desde</Text>
                        <Text style={styles.dateValue}>{dateStart.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    <MaterialCommunityIcons name="arrow-right" size={20} color="#ccc" />
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker('end')}>
                        <Text style={styles.dateLabel}>Hasta</Text>
                        <Text style={styles.dateValue}>{dateEnd.toLocaleDateString()}</Text>
                    </TouchableOpacity>
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
                                    <Text style={{fontWeight:'bold'}}>{downloadedData.length}</Text> registros raw procesados.
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

        {/* DATE PICKER */}
        {showPicker && (
            <DateTimePicker
                value={showPicker === 'start' ? dateStart : dateEnd}
                mode="date"
                display="default"
                onChange={onDateChange}
                maximumDate={new Date()}
            />
        )}
      </ScrollView>

      {/* --- OVERLAY DE CARGA BLOQUEANTE --- */}
      {isBusy && (
        <View style={styles.loadingOverlay}>
            <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingTitle}>Procesando...</Text>
                
                <Text style={styles.loadingText}>{busyMessage || progressMsg}</Text>
                
                {/* Barra de progreso solo si estamos en etapa de descarga */}
                {status === 'downloading' && totalFiles > 0 && (
                    <>
                        <Text style={styles.loadingSub}>
                            Archivo {filesProcessed + 1} de {totalFiles}
                        </Text>
                        <View style={styles.progressBarBg}>
                            <View style={[styles.progressBarFill, { width: `${fileProgress}%` }]} />
                        </View>
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
  customDateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15, paddingHorizontal: 5 },
  dateBtn: { flex: 1, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  dateLabel: { fontSize: 10, color: '#888', marginBottom: 2 },
  dateValue: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  downloadButton: { flexDirection: 'row', backgroundColor: Colors.secondary, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  downloadText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },
  
  // Overlay Styles
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