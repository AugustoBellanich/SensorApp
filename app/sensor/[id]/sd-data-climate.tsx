import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    InteractionManager,
    Keyboard,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
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
import { TimeRange, useSDDownloader } from '../../../hooks/useSDDownloader';
import { calculateMedian, downsampleData, fillTimeGaps, formatChartData, formatForExcel } from '../../../utils/dataProcessing';

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
    yAxisMax?: number;
    spacing?: number;
}

const ExportableChartCard = ({ 
    title, stats, data, unit, color, sensorId, sensorName, sensorLocation, dateRangeLabel, 
    yAxisMax, spacing = 40 
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
                    format: 'png',
                    quality: 1,
                    result: 'tmpfile',
                });

                const safeName = (sensorName || sensorId).replace(/[^a-zA-Z0-9]/g, '');
                const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '');
                const safeDate = dateRangeLabel.replace(/\//g, '-').replace(/ /g, '_');
                const fileName = `${safeName}_${safeTitle}_${safeDate}.png`;
                
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
                        type="line" 
                        unit={unit} 
                        color={color} 
                        spacing={spacing} 
                        yAxisMax={yAxisMax}
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
                </View>
            </View>
        </View>
    );
};

// =====================================================================
// PANTALLA PRINCIPAL (CLIMA - C01)
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

  // Estados
  const [range, setRange] = useState<TimeRange>('Hoy');
  const [customDays, setCustomDays] = useState('3'); 
  const [isBusy, setIsBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');

  // Datos
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);
  const [downloadedData, setDownloadedData] = useState<any[]>([]); 
  
  // Gráficas y Stats
  const [climateChartData, setClimateChartData] = useState<any>(null);
  const [agroStats, setAgroStats] = useState({ chill: 0, frost: 0, heat: 0 });

  // Configuración Dinámica
  const [chartSettings, setChartSettings] = useState({ 
      intervalMs: 3600000, 
      spacing: 40, 
      labelFormat: 'hour' 
  });

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

  // Optimización de Gráfico
  const optimizeChartData = (rawData: any[]) => {
      if (!rawData || rawData.length === 0) {
          return { intervalMs: 3600000, spacing: 40, labelFormat: 'hour' };
      }

      const timestamps = rawData.map(d => d.timestamp);
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const totalDurationMs = maxTs - minTs;

      const TARGET_POINTS = 70; 
      let calculatedInterval = totalDurationMs / TARGET_POINTS;

      const MIN_15 = 15 * 60 * 1000;
      const HOUR_1 = 60 * 60 * 1000;
      const HOUR_4 = 4 * HOUR_1;
      const HOUR_12 = 12 * HOUR_1;
      const DAY_1 = 24 * HOUR_1;

      let finalInterval = HOUR_1; 
      let labelFmt = 'hour';
      let spacing = 40;

      if (calculatedInterval <= MIN_15) {
          finalInterval = MIN_15; 
          labelFmt = 'hour';
          spacing = 50; 
      } else if (calculatedInterval <= HOUR_1) {
          finalInterval = HOUR_1; 
          labelFmt = 'hour';
          spacing = 40;
      } else if (calculatedInterval <= HOUR_4) {
          finalInterval = HOUR_4; 
          labelFmt = 'day-hour'; 
          spacing = 35;
      } else if (calculatedInterval <= HOUR_12) {
          finalInterval = HOUR_12; 
          labelFmt = 'day'; 
          spacing = 30;
      } else {
          finalInterval = DAY_1; 
          labelFmt = 'date'; 
          spacing = 25; 
      }

      if (rawData.length < 10) spacing = 60;

      return { intervalMs: finalInterval, spacing, labelFormat: labelFmt };
  };

  const calculateStats = (arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map(d => d.value);
    return { min: Math.min(...vals), max: Math.max(...vals), avg: calculateMedian(vals) }; 
  };

  // Procesamiento
  const processVisualization = useCallback((rawData: any[]) => {
    if (!sensorDb || rawData.length === 0) return;
    
    // --- 1. CÁLCULO DE HORAS AGRONÓMICAS (Sobre datos crudos) ---
    // Asumimos intervalo de 15 min (0.25h) para cada registro de SD
    const intervalHours = 0.25; 
    let chill = 0, frost = 0, heat = 0;

    rawData.forEach(d => {
        const t = d.air_temp;
        if (t !== undefined && t !== null && !isNaN(t)) {
            if (t <= 7.2) chill += intervalHours;
            if (t <= 0) frost += intervalHours;
            if (t >= 35) heat += intervalHours;
        }
    });

    setAgroStats({
        chill: Number(chill.toFixed(1)),
        frost: Number(frost.toFixed(1)),
        heat: Number(heat.toFixed(1))
    });

    // --- 2. OPTIMIZACIÓN DE GRÁFICO ---
    const settings = optimizeChartData(rawData);
    setChartSettings(settings);
    const { intervalMs, labelFormat } = settings;

    const timestamps = rawData.map(d => d.timestamp);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const startDate = new Date(Math.floor(minTs / intervalMs) * intervalMs);
    const endDate = new Date(Math.ceil(maxTs / intervalMs) * intervalMs);

    const prepare = (dataKey: string, arr: any[]) => {
        // Reducción (Mediana)
        const downsampled = downsampleData(arr, dataKey, intervalMs);
        // Stats Visuales
        const stats = calculateStats(downsampled);
        // Relleno
        const filled = fillTimeGaps(downsampled, intervalMs, startDate, endDate);
        // Formato
        const data = formatChartData(filled, labelFormat);

        return { data, stats };
    };

    setClimateChartData({
        temp: prepare('air_temp', rawData),
        hum: prepare('humidity', rawData),
    });

  }, [sensorDb]); 

  // Acciones
  const handleStartDownload = async () => {
      Keyboard.dismiss(); 
      if (!connectedDevice || !sensorDb) { Alert.alert("Error", "Sensor no conectado."); return; }
      setIsBusy(true); setBusyMessage("Iniciando descarga...");
      const now = new Date(); let start = new Date();
      
      if (range === 'Custom') { 
          const daysToSubtract = parseInt(customDays) || 1; 
          start.setDate(now.getDate() - daysToSubtract); 
      } else if (range === '1D') start.setDate(now.getDate() - 1);
      else if (range === '7D') start.setDate(now.getDate() - 7);
      else if (range === '30D') start.setDate(now.getDate() - 30);
      else start.setHours(0,0,0,0);

      const data = await startDownload(connectedDevice, sensorDb.type, range, start, now);
      if (data && data.length > 0) {
          setDownloadedData(data); setBusyMessage(`Procesando ${data.length} registros...`);
          setTimeout(() => { processVisualization(data); setIsBusy(false); }, 100);
      } else { setIsBusy(false); if (status !== 'error') Alert.alert("Aviso", "No se encontraron datos."); }
  };

  const handleCancel = () => { cancelDownload(); setIsBusy(false); };

  const handleExportExcel = async () => {
    if (downloadedData.length === 0) { Alert.alert("Sin datos", "No hay datos."); return; }
    try {
        setIsBusy(true); setBusyMessage("Generando Excel...");
        const dataToExport = downloadedData.map(item => {
            const row: any = { "Fecha y Hora": formatForExcel(item.timestamp) };
            const batMv = item.battery_mv || 0;
            row["Batería (%)"] = Math.round(Math.max(0, Math.min(100, ((batMv - 3300) / (4200 - 3300)) * 100)));
            row["Temp. Aire (°C)"] = item.air_temp; 
            row["Humedad Rel. (%)"] = item.humidity; 
            return row;
        });
        
        const ws = XLSX.utils.json_to_sheet(dataToExport); 
        ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 15 }, { wch: 15 }]; 
        const wb = XLSX.utils.book_new(); 
        XLSX.utils.book_append_sheet(wb, ws, "Datos Clima");
        const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        
        // @ts-ignore
        const fs = FileSystem; const dir = fs.documentDirectory || fs.cacheDirectory;
        const uri = dir + `Clima_${sensorId}_${new Date().toISOString().slice(0,10)}.xlsx`;
        await fs.writeAsStringAsync(uri, wbout, { encoding: 'base64' });
        setIsBusy(false);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Exportar Excel', UTI: 'com.microsoft.excel.xlsx' });
    } catch { setIsBusy(false); Alert.alert("Error", "No se pudo generar el Excel."); }
  };

  const handleSync = async () => {
    if (downloadedData.length === 0) return;
    Alert.alert("Guardar", `Se procesarán ${downloadedData.length} registros.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: async () => {
            setIsBusy(true); setBusyMessage("Guardando en base de datos...");
            try {
                await new Promise(r => setTimeout(r, 100));
                const dataToInsert = downloadedData.map(p => ({
                    ...p, 
                    sensor_id: String(sensorId).trim(), 
                    timestamp: new Date(p.timestamp).toISOString(), 
                    is_synced: 0, 
                    updated_at: new Date().toISOString(), 
                    air_temp: p.air_temp || 0,
                    humidity: p.humidity || 0,
                }));
                
                const added = await insertReadingsC01(dataToInsert as any);
                setIsBusy(false);
                Alert.alert("Éxito", `Agregados: ${added}. Nuevos.`, [{ text: "OK", onPress: () => { resetStatus(); setDownloadedData([]); if(router.canGoBack()) router.back(); }}]);
            } catch { 
                setIsBusy(false); 
                Alert.alert("Error DB", "No se pudo guardar la información."); 
            }
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
        <View><Text style={styles.title}>Descargar SD (Clima)</Text></View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        <View style={styles.controlPanel}>
            <Text style={styles.label}>Intervalo:</Text>
            <View style={styles.filterContainer}>
            {(['Hoy', '1D', '7D', '30D', 'Custom'] as TimeRange[]).map((r) => (
                <TouchableOpacity key={r} style={[styles.filterBtn, range === r && styles.filterBtnActive]} onPress={() => setRange(r)}>
                <Text style={[styles.filterText, range === r && styles.filterTextActive]}>{r === 'Custom' ? 'Manual' : r}</Text>
                </TouchableOpacity>
            ))}
            </View>
            {range === 'Custom' && (
                <View style={styles.customInputRow}>
                    <Text style={styles.customLabel}>Descargar últimos:</Text>
                    <View style={styles.inputWrapper}>
                        <TextInput style={styles.input} value={customDays} onChangeText={setCustomDays} keyboardType="number-pad" maxLength={3} selectTextOnFocus />
                        <Text style={styles.inputUnit}>Días</Text>
                    </View>
                    <Text style={styles.helperText}>(Desde {new Date(new Date().setDate(new Date().getDate() - (parseInt(customDays)||0))).toLocaleDateString()} hasta Hoy)</Text>
                </View>
            )}
            <TouchableOpacity style={styles.downloadButton} onPress={handleStartDownload}>
                <MaterialCommunityIcons name="download" size={24} color="#fff" />
                <Text style={styles.downloadText}>INICIAR DESCARGA</Text>
            </TouchableOpacity>
        </View>

        {!isBusy && downloadedData.length > 0 && climateChartData && (
            <View>
                <View style={{paddingHorizontal: 16, marginTop: 10}}>
                    <View style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                                <MaterialCommunityIcons name="database-check" size={24} color={Colors.success} />
                                <View style={{marginLeft: 10}}>
                                    <Text style={styles.summaryTitle}>Datos: {downloadedData.length}</Text>
                                    <Text style={styles.summaryText}>registros descargados.</Text>
                                </View>
                            </View>
                            <TouchableOpacity style={styles.toolButton} onPress={handleExportExcel}>
                                <MaterialCommunityIcons name="microsoft-excel" size={22} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* --- PANEL AGRO (NUEVO) --- */}
                <View style={styles.agroPanel}>
                    <View style={styles.agroItem}>
                        <MaterialCommunityIcons name="snowflake" size={24} color="#1E88E5" />
                        <Text style={styles.agroValue}>{agroStats.chill} h</Text>
                        <Text style={styles.agroLabel}>Frío (&lt;7.2°)</Text>
                    </View>
                    <View style={styles.dividerVertical} />
                    <View style={styles.agroItem}>
                        <MaterialCommunityIcons name="thermometer-alert" size={24} color="#4FC3F7" />
                        <Text style={styles.agroValue}>{agroStats.frost} h</Text>
                        <Text style={styles.agroLabel}>Helada (&lt;0°)</Text>
                    </View>
                    <View style={styles.dividerVertical} />
                    <View style={styles.agroItem}>
                        <MaterialCommunityIcons name="white-balance-sunny" size={24} color="#FF7043" />
                        <Text style={styles.agroValue}>{agroStats.heat} h</Text>
                        <Text style={styles.agroLabel}>Calor (&gt;35°)</Text>
                    </View>
                </View>

                <View style={styles.content}>
                    <ExportableChartCard 
                        title="Temperatura Aire" 
                        stats={climateChartData.temp.stats} 
                        data={climateChartData.temp.data} 
                        unit="°C" 
                        color={Colors.secondary}
                        sensorId={String(sensorId)} 
                        sensorName={sensorDb?.alias || ''} 
                        sensorLocation={sensorDb?.location || ''} 
                        dateRangeLabel={getDateRangeLabel()}
                        spacing={chartSettings.spacing}
                    />
                    <ExportableChartCard 
                        title="Humedad Relativa" 
                        stats={climateChartData.hum.stats} 
                        data={climateChartData.hum.data} 
                        unit="%" 
                        color={Colors.primary}
                        sensorId={String(sensorId)} 
                        sensorName={sensorDb?.alias || ''} 
                        sensorLocation={sensorDb?.location || ''} 
                        dateRangeLabel={getDateRangeLabel()}
                        spacing={chartSettings.spacing}
                    />
                </View>

                <View style={[styles.content, {marginTop: 20}]}>
                    <TouchableOpacity style={styles.syncButton} onPress={handleSync}>
                        <Text style={styles.syncBtnText}>Confirmar e Importar a App</Text>
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

  summaryCard: { backgroundColor: '#e8f5e9', padding: 12, borderRadius: 12, borderLeftWidth: 5, borderLeftColor: Colors.success },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  summaryText: { fontSize: 12, color: Colors.textSecondary },
  
  toolButton: {
      width: 40, height: 40,
      borderRadius: 8,
      backgroundColor: '#217346', // Excel Green
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 2
  },

  content: { paddingHorizontal: 16 },
  
  syncButton: { flexDirection: 'row', backgroundColor: Colors.success, paddingVertical: 14, justifyContent: 'center', borderRadius: 12, alignItems: 'center', marginBottom: 15, elevation: 3, gap: 10 },
  syncBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // --- ESTILOS TARJETA ---
  chartCardContainer: { marginTop: 20 },
  chartHeader: { 
      flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', 
      marginBottom: -20, zIndex: 10, paddingRight: 5
  },
  miniExportButton: {
      padding: 8, backgroundColor: '#fff', borderRadius: 20,
      borderWidth: 1, borderColor: '#eee', elevation: 3,
  },
  captureContainer: {
      backgroundColor: '#fff', borderRadius: 16, padding: 15,
      borderWidth: 1, borderColor: '#eee', elevation: 2,
      shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: {width:0, height:2},
  },
  innerHeader: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingBottom: 8, marginBottom: 10 },
  chartTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  sensorSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardFooter: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  footerRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'center' },
  footerLabel: { fontSize: 10, color: '#999', fontWeight: '600', width: 60 },
  footerValue: { fontSize: 10, color: '#555', fontWeight: 'bold' },
  footerTiny: { fontSize: 8, color: '#aaa', marginTop: 4, textAlign: 'right' },

  // --- ESTILOS PANEL AGRO (COPIADOS DE LOCALDATA) ---
  agroPanel: { 
      flexDirection: 'row', 
      backgroundColor: '#fff', 
      borderRadius: 16, 
      padding: 15, 
      elevation: 2, 
      marginBottom: 5, 
      marginHorizontal: 16, 
      marginTop: 20,
      borderWidth: 1, 
      borderColor: '#eee', 
      justifyContent: 'space-between' 
  },
  agroItem: { flex: 1, alignItems: 'center' },
  agroValue: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginVertical: 4 },
  agroLabel: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary },
  dividerVertical: { width: 1, backgroundColor: '#eee', height: '80%', alignSelf: 'center' },
});