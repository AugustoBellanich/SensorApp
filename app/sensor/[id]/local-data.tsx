import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
// @ts-ignore
import * as FileSystem from "expo-file-system/legacy";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as XLSX from "xlsx";

// DB
import { db } from "../../../database/DatabaseInit";

// Componentes
import SegmentedControl from "../../../components/global/SegmentedControl";
import SensorChart from "../../../components/sensor/SensorChart";
import StatPanel from "../../../components/sensor/StatPanel";
import { Colors } from "../../../constants/Colors";

// Lógica
import { getElectrodesBySensor } from "../../../database/ElectrodeRepository";
import { deleteReadingsRange } from "../../../database/ReadingsRepository";
import { getSensorById } from "../../../database/SensorRepository";
import { ElectrodeEntity, LinearSegment, SensorEntity } from "../../../database/types";

// Utils
import { calculateMoistureFromSegments } from "../../../utils/calibration";
// Importamos funciones optimizadas
import { calculateMedian, downsampleData, fillTimeGaps, formatChartData, formatForExcel } from "../../../utils/dataProcessing";
import { getAgronomicLines } from "../../../utils/referenceLines";

type UnitType = "% Hv" | "% Hg" | "mV";
type ViewMode = "optimized" | "real";

const CLIMATE_LINES = [
  { value: 0, label: 'Helada', color: '#4FC3F7' },     
  { value: 7.2, label: 'Hora Frío', color: '#1E88E5' }, 
  { value: 35, label: 'Calor Ext.', color: '#FF7043' }  
];

export default function LocalDataScreen() {
  const { id } = useLocalSearchParams();
  const rawId = Array.isArray(id) ? id[0] : id;
  const sensorId = rawId?.trim() || "";
  
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Estados
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(""); 
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);

  // Filtros
  const [dateStart, setDateStart] = useState(new Date(new Date().setDate(new Date().getDate() - 7))); // Default 7 días
  const [dateEnd, setDateEnd] = useState(new Date());
  const [showPicker, setShowPicker] = useState<"start" | "end" | null>(null);

  // Configs
  const [viewMode, setViewMode] = useState<ViewMode>("optimized");
  const [unit, setUnit] = useState<UnitType>("% Hv");
  const [spacing, setSpacing] = useState<number>(40);

  // Nuevo estado para configuración dinámica del gráfico
  const [chartSettings, setChartSettings] = useState({ 
      intervalMs: 3600000, 
      labelFormat: 'hour' // 'hour' | 'day-hour' | 'day' | 'date'
  });

  const [electrodesInfo, setElectrodesInfo] = useState<Record<number, ElectrodeEntity>>({});
  const [electrodeConfig, setElectrodeConfig] = useState<Record<number, LinearSegment[]>>({});
  const [densities, setDensities] = useState<Record<number, number>>({});
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // Datos
  const [localData, setLocalData] = useState<any[]>([]);
  const [electrodesData, setElectrodesData] = useState<any>(null);
  const [soilTempData, setSoilTempData] = useState<any>(null);
  const [climateData, setClimateData] = useState<any>(null);
  
  // Agro Stats
  const [agroStats, setAgroStats] = useState({ chill: 0, frost: 0, heat: 0 });

  // 1. Init
  useEffect(() => {
    const loadConfig = async () => {
      if (!sensorId) return;
      const s = await getSensorById(sensorId);
      setSensorDb(s);

      if (s?.type.toUpperCase() === "B01") {
        const elecs = await getElectrodesBySensor(sensorId);
        const infoMap: Record<number, ElectrodeEntity> = {};
        const configMap: Record<number, LinearSegment[]> = {};
        const densityMap: Record<number, number> = {};

        elecs.forEach((e) => {
          infoMap[e.electrode_index] = e;
          if (e.equations_json) {
            try { configMap[e.electrode_index] = JSON.parse(e.equations_json); } catch {}
          }
          densityMap[e.electrode_index] = e.density && e.density > 0 ? e.density : 1.3;
        });
        setElectrodesInfo(infoMap);
        setElectrodeConfig(configMap);
        setDensities(densityMap);
      }
      setIsConfigLoaded(true);
    };
    loadConfig();
  }, [sensorId]);

  // --- LÓGICA DE OPTIMIZACIÓN DE DATOS (Igual que en SD) ---
  const optimizeChartSettings = (rawData: any[]) => {
      if (!rawData || rawData.length === 0) {
          return { intervalMs: 3600000, labelFormat: 'hour' };
      }

      // Convertimos timestamps de string ISO a number si es necesario
      const timestamps = rawData.map(d => new Date(d.timestamp).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const totalDurationMs = maxTs - minTs;

      // Objetivo: ~70 puntos en pantalla
      const TARGET_POINTS = 70; 
      let calculatedInterval = totalDurationMs / TARGET_POINTS;

      const MIN_15 = 15 * 60 * 1000;
      const HOUR_1 = 60 * 60 * 1000;
      const HOUR_4 = 4 * HOUR_1;
      const HOUR_12 = 12 * HOUR_1;
      const DAY_1 = 24 * HOUR_1;

      let finalInterval = HOUR_1; 
      let labelFmt = 'hour';

      if (calculatedInterval <= MIN_15) {
          finalInterval = MIN_15; 
          labelFmt = 'hour';
      } else if (calculatedInterval <= HOUR_1) {
          finalInterval = HOUR_1; 
          labelFmt = 'hour';
      } else if (calculatedInterval <= HOUR_4) {
          finalInterval = HOUR_4; 
          labelFmt = 'day-hour'; 
      } else if (calculatedInterval <= HOUR_12) {
          finalInterval = HOUR_12; 
          labelFmt = 'day'; 
      } else {
          finalInterval = DAY_1; 
          labelFmt = 'date'; 
      }

      return { intervalMs: finalInterval, labelFormat: labelFmt };
  };


  const calcStats = useCallback((arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map((d) => Number(d.value) || 0);
    return { min: Math.min(...vals), max: Math.max(...vals), avg: calculateMedian(vals) };
  }, []);

  // --- PROCESAMIENTO B01 ---
  const processB01 = useCallback((data: any[]) => {
      // 1. Calcular configuración óptima
      const settings = optimizeChartSettings(data);
      setChartSettings(settings);
      const { intervalMs, labelFormat } = settings;

      const processed = data.map((d: any) => {
        const mv1 = Number(d.e1_mv); const mv2 = Number(d.e2_mv); const mv3 = Number(d.e3_mv);
        let v1 = mv1, v2 = mv2, v3 = mv3;
        if (unit !== "mV") {
          const rho1 = electrodesInfo[1]?.density || 1.3;
          const rho2 = electrodesInfo[2]?.density || 1.3;
          const rho3 = electrodesInfo[3]?.density || 1.3;
          if (electrodeConfig[1]) v1 = calculateMoistureFromSegments(mv1, electrodeConfig[1]);
          if (electrodeConfig[2]) v2 = calculateMoistureFromSegments(mv2, electrodeConfig[2]);
          if (electrodeConfig[3]) v3 = calculateMoistureFromSegments(mv3, electrodeConfig[3]);
          if (unit === "% Hg") { v1 /= rho1; v2 /= rho2; v3 /= rho3; }
        }
        return { ...d, v1, v2, v3 };
      });

      // Grilla temporal
      const timestamps = processed.map(d => new Date(d.timestamp).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const startDate = new Date(Math.floor(minTs / intervalMs) * intervalMs);
      const endDate = new Date(Math.ceil(maxTs / intervalMs) * intervalMs);

      const prep = (key: string) => {
        let finalData: any[] = [];
        let stats;
        const validData = processed.filter((p) => {
          const v = p[key]; return v !== undefined && v !== null && !isNaN(v) && v > 0;
        });

        if (viewMode === "optimized") {
          // Reducción dinámica
          const downsampled = downsampleData(validData, key, intervalMs);
          stats = calcStats(downsampled);
          const filled = fillTimeGaps(downsampled, intervalMs, startDate, endDate);
          finalData = formatChartData(filled, labelFormat);
        } else {
          // Modo Real: Muestra todo (cuidado con muchos datos)
          const mapped = validData.map((p) => ({ timestamp: p.timestamp, value: p[key] }));
          finalData = formatChartData(mapped, 'hour'); // En real asumimos detalle hora
          stats = calcStats(mapped);
        }
        return { data: finalData, stats };
      };

      setElectrodesData({ 1: prep("v1"), 2: prep("v2"), 3: prep("v3") });
      setSoilTempData(prep("soil_temp"));
    }, [unit, electrodesInfo, electrodeConfig, formatChartData, calcStats, viewMode]);

  // --- PROCESAMIENTO C01 ---
  const processC01 = useCallback((data: any[]) => {
      // 1. Cálculo de Horas Agronómicas (Datos crudos)
      // Asumimos que los datos en DB vienen cada 15 min aprox o calculamos delta real
      // Para simplificar y consistencia con SD, usamos 0.25h por registro si es regular
      const intervalHours = 0.25; 
      let chill = 0, frost = 0, heat = 0;

      data.forEach(d => {
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

      // 2. Configuración Óptima
      const settings = optimizeChartSettings(data);
      setChartSettings(settings);
      const { intervalMs, labelFormat } = settings;

      // Grilla temporal
      const timestamps = data.map(d => new Date(d.timestamp).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const startDate = new Date(Math.floor(minTs / intervalMs) * intervalMs);
      const endDate = new Date(Math.ceil(maxTs / intervalMs) * intervalMs);

      const prep = (key: string) => {
        let finalData: any[] = [];
        let stats;
        const validData = data.filter((p: any) => {
          const v = p[key]; return v !== undefined && v !== null && !isNaN(v) && v > 0; 
        });

        if (viewMode === "optimized") {
          const downsampled = downsampleData(validData, key, intervalMs);
          stats = calcStats(downsampled);
          const filled = fillTimeGaps(downsampled, intervalMs, startDate, endDate);
          finalData = formatChartData(filled, labelFormat);
        } else {
          const mapped = validData.map((p) => ({ timestamp: p.timestamp, value: p[key] }));
          finalData = formatChartData(mapped, 'hour');
          stats = calcStats(mapped);
        }
        return { data: finalData, stats };
      };
      setClimateData({ temp: prep("air_temp"), hum: prep("humidity") });
    }, [formatChartData, calcStats, viewMode]);

  const processData = useCallback((data: any[], type: string) => {
      const safeType = type.toUpperCase();
      setLoading(true);
      setLoadingMessage("Procesando gráficos...");
      setTimeout(() => {
          if (safeType === "B01") processB01(data);
          else if (safeType === "C01") processC01(data);
          setLoading(false);
      }, 50);
    }, [processB01, processC01]);

  // --- BÚSQUEDA EN DB ---
  const handleSearchData = useCallback(async (sensor: SensorEntity, start: Date, end: Date) => {
      const type = sensor.type.toUpperCase();
      if (type !== "B01" && type !== "C01") return;
      
      setLoading(true);
      setLoadingMessage("Consultando base de datos...");
      
      try {
        const tableName = type === 'B01' ? 'readings_b01' : 'readings_c01';
        const s = start.toISOString();
        const e = end.toISOString();
        
        let results = await db.getAllAsync(
            `SELECT * FROM ${tableName} 
             WHERE sensor_id = ? 
             AND datetime(timestamp) >= datetime(?) 
             AND datetime(timestamp) <= datetime(?)
             ORDER BY timestamp ASC`,
            [sensorId, s, e]
        );

        if (results.length === 0) {
            const fallbackResults = await db.getAllAsync(
                `SELECT * FROM ${tableName} WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 500`,
                [sensorId]
            );
            if (fallbackResults.length > 0) {
                 results = fallbackResults.reverse();
                 Alert.alert("Aviso", "No se encontraron datos en el rango seleccionado. Mostrando los últimos registros disponibles.");
            }
        }

        if (results.length > 0) {
          setLocalData(results);
          processData(results, type);
        } else {
          setLocalData([]);
          setElectrodesData(null);
          setClimateData(null);
          Alert.alert("Info", `No hay datos del ${start.toLocaleDateString()} al ${end.toLocaleDateString()}.`);
        }
      } catch (err) {
        console.error("Error buscando datos locales:", err);
      } finally {
        setLoading(false);
      }
    }, [sensorId, processData]);

  // Efectos
  useEffect(() => {
    if (isConfigLoaded && sensorDb)
      handleSearchData(sensorDb, dateStart, dateEnd);
  }, [isConfigLoaded, dateStart, dateEnd, handleSearchData, sensorDb]);

  useEffect(() => {
    if (localData.length > 0 && sensorDb) {
        processData(localData, sensorDb.type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, viewMode]);

  const handleExportExcel = async () => {
    if (localData.length === 0) return Alert.alert("Sin datos", "No hay datos.");
    try {
      setLoading(true); setLoadingMessage("Generando Excel...");
      await new Promise(r => setTimeout(r, 100));

      const isB01 = sensorDb?.type === "B01";
      const dataToExport = localData.map((item) => {
        const row: any = { "Fecha y Hora": formatForExcel(item.timestamp) };
        const batMv = item.battery_mv || 0;
        row["Batería (%)"] = Math.round(Math.max(0, Math.min(100, ((batMv - 3300) / (4200 - 3300)) * 100)));

        if (isB01) {
          row["Temp. Suelo (°C)"] = item.soil_temp;
          [1, 2, 3].forEach((idx) => {
            const mv = item[`e${idx}_mv`]; row[`E${idx} (mV)`] = mv;
            const segs = electrodeConfig[idx]; let hv = 0;
            if (segs) hv = calculateMoistureFromSegments(mv, segs);
            row[`E${idx} Hv (%)`] = Number(hv.toFixed(2));
            const rho = densities[idx] || 1.3; const hg = hv / rho;
            row[`E${idx} Hg (%)`] = Number(hg.toFixed(2));
          });
        } else {
          row["Temp. Aire (°C)"] = item.air_temp;
          row["Humedad Rel. (%)"] = item.humidity;
        }
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(dataToExport); ws['!cols'] = [{ wch: 22 }, { wch: 15 }, { wch: 15 }]; 
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Datos");
      const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      
      // @ts-ignore
      const fs = FileSystem; const dir = fs.documentDirectory || fs.cacheDirectory;
      const uri = dir + `Sensor_${sensorId}_Local.xlsx`;
      await fs.writeAsStringAsync(uri, wbout, { encoding: "base64" });
      setLoading(false); 
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Exportar Excel', UTI: 'com.microsoft.excel.xlsx' });
    } catch { setLoading(false); Alert.alert("Error", "Falló la exportación"); }
  };

  const handleDeleteData = () => {
    Alert.alert("¿Eliminar datos?", `Se borrarán del ${dateStart.toLocaleDateString()} al ${dateEnd.toLocaleDateString()}.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: async () => {
            try {
              setLoading(true); setLoadingMessage("Eliminando...");
              await deleteReadingsRange(sensorId, sensorDb!.type, dateStart, dateEnd);
              handleSearchData(sensorDb!, dateStart, dateEnd);
              Alert.alert("Eliminado", "Datos borrados.");
            } catch { Alert.alert("Error", "No se pudo borrar."); } 
            finally { setLoading(false); }
          }
        }
    ]);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const type = showPicker; setShowPicker(null);
    if (event.type === "dismissed" || !selectedDate) return;
    if (type === "start") {
      setDateStart(selectedDate);
      if (selectedDate > dateEnd) setDateEnd(selectedDate);
    } else {
      if (selectedDate < dateStart) Alert.alert("Error", "Fecha inválida");
      else setDateEnd(selectedDate);
    }
  };

  const type = sensorDb?.type.toUpperCase();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Historial Local</Text>
          <Text style={styles.subtitle}>{sensorDb?.alias || sensorId}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} scrollEnabled={!loading}>
        <View style={styles.filterCard}>
          <View style={styles.dateRow}>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker("start")}>
              <Text style={styles.dateLabel}>Desde</Text>
              <Text style={styles.dateVal}>{dateStart.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <MaterialCommunityIcons name="arrow-right" size={20} color="#ccc" />
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker("end")}>
              <Text style={styles.dateLabel}>Hasta</Text>
              <Text style={styles.dateVal}>{dateEnd.toLocaleDateString()}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.searchButton} onPress={() => sensorDb && handleSearchData(sensorDb, dateStart, dateEnd)} disabled={loading}>
              <MaterialCommunityIcons name="magnify" size={24} color="#fff" />
              <Text style={styles.searchBtnText}>Consultar Datos</Text>
          </TouchableOpacity>
        </View>

        {localData.length > 0 && (
          <View style={styles.toolbar}>
            <TouchableOpacity style={[styles.toolBtn, { backgroundColor: "#E8F5E9" }]} onPress={handleExportExcel} disabled={loading}>
              <MaterialCommunityIcons name="microsoft-excel" size={22} color="#2E7D32" />
              <Text style={[styles.toolText, { color: "#2E7D32" }]}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { backgroundColor: "#FFEBEE" }]} onPress={handleDeleteData} disabled={loading}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#D32F2F" />
              <Text style={[styles.toolText, { color: "#D32F2F" }]}>Borrar</Text>
            </TouchableOpacity>
          </View>
        )}

        {localData.length > 0 && (
          <View style={styles.controlsContainer}>
            {type === "B01" && (
              <View style={{ marginBottom: 15 }}>
                <SegmentedControl options={["% Hv", "% Hg", "mV"]} selectedIndex={unit === "% Hv" ? 0 : unit === "% Hg" ? 1 : 2} onChange={(i) => setUnit(i === 0 ? "% Hv" : i === 1 ? "% Hg" : "mV")} />
              </View>
            )}
            <View style={styles.switchContainer}>
              <TouchableOpacity style={[styles.switchOption, viewMode === "optimized" && styles.switchActive]} onPress={() => setViewMode("optimized")}>
                <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={18} color={viewMode === "optimized" ? "#fff" : "#666"} />
                <Text style={[styles.switchText, viewMode === "optimized" && styles.switchTextActive]}>Optimizado</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.switchOption, viewMode === "real" && styles.switchActive]} onPress={() => setViewMode("real")}>
                <MaterialCommunityIcons name="chart-line-variant" size={18} color={viewMode === "real" ? "#fff" : "#666"} />
                <Text style={[styles.switchText, viewMode === "real" && styles.switchTextActive]}>Datos Reales</Text>
              </TouchableOpacity>
            </View>
             <View style={styles.sliderContainer}>
              <View style={styles.sliderLabels}>
                <MaterialCommunityIcons name="magnify-minus-outline" size={20} color={Colors.textSecondary} />
                <Text style={styles.sliderText}>Zoom Horizontal</Text>
                <MaterialCommunityIcons name="magnify-plus-outline" size={20} color={Colors.textSecondary} />
              </View>
              <Slider style={{ width: "100%", height: 40 }} minimumValue={10} maximumValue={100} step={5} value={spacing} onValueChange={setSpacing} minimumTrackTintColor={Colors.primary} maximumTrackTintColor="#d3d3d3" thumbTintColor={Colors.primary} />
            </View>
          </View>
        )}

        {/* PANEL AGRO PARA CLIMA (C01) */}
        {type === "C01" && localData.length > 0 && (
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
        )}

        {type === "B01" && electrodesData && (
          <View style={styles.content}>
            {soilTempData && (
              <View style={styles.chartBox}>
                <Text style={styles.sectionTitle}>Temp. Suelo (°C)</Text>
                <StatPanel stats={soilTempData.stats} unit="°C" />
                <SensorChart data={soilTempData.data} type="line" unit="°C" color={Colors.secondary} spacing={spacing} />
              </View>
            )}
            {[1, 2, 3].map((num) => {
              const refLines = getAgronomicLines(electrodesInfo[num], unit);
              let maxY = undefined;
              const satLine = refLines.find((l) => l.label === "SAT");
              if (satLine && satLine.value > 0) maxY = satLine.value + 5;
              return (
                <View key={num} style={styles.chartBox}>
                  <Text style={styles.sectionTitle}>Electrodo {num} ({unit})</Text>
                  <StatPanel stats={electrodesData[num]?.stats} unit={unit} />
                  <SensorChart data={electrodesData[num]?.data} type="line" unit={unit} color={Colors.primary} referenceLines={refLines} spacing={spacing} yAxisMax={maxY} />
                </View>
              );
            })}
          </View>
        )}

        {type === "C01" && climateData && (
          <View style={styles.content}>
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Temperatura (°C)</Text>
              <SensorChart data={climateData.temp.data} type="line" unit="°C" color={Colors.secondary} spacing={spacing} referenceLines={CLIMATE_LINES} />
            </View>
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Humedad (%)</Text>
              <SensorChart data={climateData.hum.data} type="line" unit="%" color={Colors.primary} spacing={spacing} />
            </View>
          </View>
        )}

        {showPicker && (
          <DateTimePicker value={showPicker === "start" ? dateStart : dateEnd} mode="date" display="default" onChange={onDateChange} />
        )}
      </ScrollView>
      
      <Modal transparent={true} animationType="fade" visible={loading}>
        <View style={styles.loadingOverlay}>
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>{loadingMessage || "Cargando..."}</Text>
            </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#eee" },
  backButton: { marginRight: 15 },
  title: { fontSize: 18, fontWeight: "bold", color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary },
  filterCard: { backgroundColor: "#fff", margin: 16, padding: 15, borderRadius: 12, elevation: 2, borderWidth: 1, borderColor: "#eee" },
  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 },
  dateBtn: { flex: 1, alignItems: "center", padding: 10, borderRadius: 8, backgroundColor: "#f5f5f5", borderWidth: 1, borderColor: "#e0e0e0" },
  dateLabel: { fontSize: 10, color: "#888" },
  dateVal: { fontSize: 14, fontWeight: "bold", color: "#333" },
  searchButton: { flexDirection: "row", backgroundColor: Colors.primary, padding: 12, borderRadius: 10, justifyContent: "center", alignItems: "center", gap: 8 },
  searchBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  toolbar: { flexDirection: "row", paddingHorizontal: 16, marginBottom: 15, gap: 10 },
  toolBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10, gap: 5 },
  toolText: { fontWeight: "bold", fontSize: 14 },
  controlsContainer: { paddingHorizontal: 16, marginBottom: 15 },
  switchContainer: { flexDirection: "row", backgroundColor: "#e0e0e0", borderRadius: 8, padding: 3, marginBottom: 15 },
  switchOption: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 6, gap: 6 },
  switchActive: { backgroundColor: Colors.primary, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
  switchText: { fontSize: 12, fontWeight: "600", color: "#666" },
  switchTextActive: { color: "#fff" },
  sliderContainer: { backgroundColor: "#fff", padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "#eee" },
  sliderLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  sliderText: { fontSize: 12, color: Colors.textSecondary, fontWeight: "600" },
  content: { paddingHorizontal: 16 },
  chartBox: { marginBottom: 25 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary, marginBottom: 8 },
  agroPanel: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, padding: 15, elevation: 2, marginBottom: 25, marginHorizontal: 16, borderWidth: 1, borderColor: '#eee', justifyContent: 'space-between' },
  agroItem: { flex: 1, alignItems: 'center' },
  agroValue: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginVertical: 4 },
  agroLabel: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary },
  dividerVertical: { width: 1, backgroundColor: '#eee', height: '80%', alignSelf: 'center' },
  loadingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  loadingContainer: { backgroundColor: '#fff', padding: 25, borderRadius: 12, alignItems: 'center', elevation: 5 },
  loadingText: { marginTop: 15, fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary }
});