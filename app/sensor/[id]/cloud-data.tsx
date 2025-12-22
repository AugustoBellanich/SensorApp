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
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as XLSX from "xlsx";

// Componentes
import SegmentedControl from "../../../components/global/SegmentedControl";
import SensorChart from "../../../components/sensor/SensorChart";
import StatPanel from "../../../components/sensor/StatPanel";
import { Colors } from "../../../constants/Colors";

// Lógica Local (Configuración se lee local)
import { getElectrodesBySensor } from "../../../database/ElectrodeRepository";
import { getSensorById } from "../../../database/SensorRepository";
import {
    ElectrodeEntity,
    LinearSegment,
    SensorEntity,
} from "../../../database/types";

// Utils
import { calculateMoistureFromSegments } from "../../../utils/calibration";
import { calculateMedian, downsampleData } from "../../../utils/dataProcessing";
import { getAgronomicLines } from "../../../utils/referenceLines";

// --- IMPORTANTE: CLIENTE SUPABASE ---
import { supabase } from "../../../lib/supabase";

type UnitType = "% Hv" | "% Hg" | "mV";
type ViewMode = "optimized" | "real";

export default function CloudDataScreen() {
  const { id } = useLocalSearchParams();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Estados UI
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);

  // Filtros Fecha
  const [dateStart, setDateStart] = useState(
    new Date(new Date().setDate(new Date().getDate() - 1))
  );
  const [dateEnd, setDateEnd] = useState(new Date());
  const [showPicker, setShowPicker] = useState<"start" | "end" | null>(null);

  // Configs Visualización
  const [viewMode, setViewMode] = useState<ViewMode>("optimized");
  const [unit, setUnit] = useState<UnitType>("% Hv");
  const [spacing, setSpacing] = useState<number>(30);

  // Configuración de Electrodos (La leemos local para aplicar calibración a los datos nube)
  const [electrodesInfo, setElectrodesInfo] = useState<Record<number, ElectrodeEntity>>({});
  const [electrodeConfig, setElectrodeConfig] = useState<Record<number, LinearSegment[]>>({});
  const [densities, setDensities] = useState<Record<number, number>>({});
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // Datos
  const [cloudData, setCloudData] = useState<any[]>([]); // Renombrado a cloudData
  const [electrodesData, setElectrodesData] = useState<any>(null);
  const [soilTempData, setSoilTempData] = useState<any>(null);
  const [climateData, setClimateData] = useState<any>(null);
  const [agroStats, setAgroStats] = useState<any>(null);

  // 1. Init: Cargar Configuración Local del Sensor
  useEffect(() => {
    const loadConfig = async () => {
      const s = await getSensorById(sensorId);
      setSensorDb(s);

      if (s?.type === "B01") {
        const elecs = await getElectrodesBySensor(sensorId);
        const infoMap: Record<number, ElectrodeEntity> = {};
        const configMap: Record<number, LinearSegment[]> = {};
        const densityMap: Record<number, number> = {};

        elecs.forEach((e) => {
          infoMap[e.electrode_index] = e;
          if (e.equations_json) {
            try {
              configMap[e.electrode_index] = JSON.parse(e.equations_json);
            } catch {}
          }
          densityMap[e.electrode_index] =
            e.density && e.density > 0 ? e.density : 1.3;
        });
        setElectrodesInfo(infoMap);
        setElectrodeConfig(configMap);
        setDensities(densityMap);
      }
      setIsConfigLoaded(true);
    };
    loadConfig();
  }, [sensorId]);

  // --- HELPERS VISUALES (Iguales a LocalData) ---
  const formatChart = useCallback(
    (arr: any[]) => {
      if (!arr || arr.length === 0) return [];
      const pixelsPerLabel = 60;
      let step = Math.ceil(pixelsPerLabel / spacing);
      if (step < 1) step = 1;
      let lastDateString = "";

      return arr.map((p, index) => {
        const val = Number(p.value);
        if (isNaN(val)) return { value: 0, label: "" };
        const ts = new Date(p.timestamp).getTime();
        const d = new Date(ts);
        let label = "";
        if (index % step === 0 || index === arr.length - 1) {
          const dateStr = d.getDate() + "/" + (d.getMonth() + 1);
          const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          if (dateStr !== lastDateString) {
            label = `${dateStr}\n${timeStr}`;
            lastDateString = dateStr;
          } else {
            label = timeStr;
          }
        }
        return { value: val, label };
      });
    },
    [spacing]
  );

  const calcStats = useCallback((arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map((d) => Number(d.value) || 0);
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: calculateMedian(vals),
    };
  }, []);

  // --- PROCESAMIENTO B01 ---
  const processB01 = useCallback(
    (data: any[]) => {
      const processed = data.map((d) => {
        const mv1 = Number(d.e1_mv);
        const mv2 = Number(d.e2_mv);
        const mv3 = Number(d.e3_mv);
        let v1 = mv1, v2 = mv2, v3 = mv3;
        
        if (unit !== "mV") {
          const rho1 = electrodesInfo[1]?.density || 1.3;
          const rho2 = electrodesInfo[2]?.density || 1.3;
          const rho3 = electrodesInfo[3]?.density || 1.3;
          if (electrodeConfig[1]) v1 = calculateMoistureFromSegments(mv1, electrodeConfig[1]);
          if (electrodeConfig[2]) v2 = calculateMoistureFromSegments(mv2, electrodeConfig[2]);
          if (electrodeConfig[3]) v3 = calculateMoistureFromSegments(mv3, electrodeConfig[3]);
          if (unit === "% Hg") {
            v1 /= rho1; v2 /= rho2; v3 /= rho3;
          }
        }
        return { ...d, v1, v2, v3 };
      });

      const prep = (key: string) => {
        let finalData;
        const validData = processed.filter((p) => {
          const v = p[key];
          return v !== undefined && v !== null && !isNaN(v) && v > 0;
        });

        if (viewMode === "optimized") {
          const interval = 3600 * 1000;
          finalData = downsampleData(validData, key, interval);
        } else {
          finalData = validData.map((p) => ({ timestamp: p.timestamp, value: p[key] }));
        }
        return { data: formatChart(finalData), stats: calcStats(finalData) };
      };

      setElectrodesData({ 1: prep("v1"), 2: prep("v2"), 3: prep("v3") });
      setSoilTempData(prep("soil_temp"));
    },
    [unit, electrodesInfo, electrodeConfig, formatChart, calcStats, viewMode]
  );

  // --- PROCESAMIENTO C01 ---
  const processC01 = useCallback(
    (data: any[]) => {
      const prep = (key: string) => {
        let finalData;
        const validData = data.filter((p) => {
          const v = p[key];
          return v !== undefined && v !== null && !isNaN(v) && v > 0; 
        });

        if (viewMode === "optimized") {
          const interval = 3600 * 1000;
          finalData = downsampleData(validData, key, interval);
        } else {
          finalData = validData.map((p) => ({ timestamp: p.timestamp, value: p[key] }));
        }
        return { data: formatChart(finalData), stats: calcStats(finalData) };
      };
      setClimateData({ temp: prep("air_temp"), hum: prep("humidity") });
    },
    [formatChart, calcStats, viewMode]
  );

  const processData = useCallback(
    (data: any[], type: "B01" | "C01") => {
      if (data.length > 500) { 
          setLoading(true);
          setLoadingMessage("Procesando gráficos...");
          setTimeout(() => {
              if (type === "B01") processB01(data);
              else processC01(data);
              setLoading(false);
          }, 50);
      } else {
          if (type === "B01") processB01(data);
          else processC01(data);
      }
    },
    [processB01, processC01]
  );

  // --- CONSULTA A SUPABASE (NUBE) ---
  const handleSearchData = useCallback(
    async (sensor: SensorEntity, start: Date, end: Date) => {
      if (sensor.type !== "B01" && sensor.type !== "C01") return;
      
      setLoading(true);
      setLoadingMessage("Descargando desde la Nube...");
      
      try {
        const s = new Date(start); s.setHours(0, 0, 0, 0);
        const e = new Date(end); e.setHours(23, 59, 59, 999);
        const type = sensor.type as "B01" | "C01";
        const tableName = type === 'B01' ? 'readings_b01' : 'readings_c01';

        // Consulta a Supabase
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('sensor_id', sensorId)
            .gte('timestamp', s.toISOString())
            .lte('timestamp', e.toISOString())
            .order('timestamp', { ascending: true })
            .limit(2000); // Límite de seguridad para no explotar la memoria

        if (error) throw error;
        
        if (data && data.length > 0) {
          setCloudData(data);
          processData(data, type);
        } else {
          setCloudData([]);
          setElectrodesData(null);
          setClimateData(null);
          Alert.alert("Aviso", "No se encontraron datos en la nube para este periodo.");
        }
      } catch (err: any) {
        console.error(err);
        Alert.alert("Error de Conexión", err.message || "No se pudo conectar con el servidor.");
      } finally {
        setLoading(false);
      }
    },
    [sensorId, processData]
  );

  useEffect(() => {
    if (isConfigLoaded && sensorDb)
      handleSearchData(sensorDb, dateStart, dateEnd);
  }, [isConfigLoaded, dateStart, dateEnd, handleSearchData, sensorDb]);

  useEffect(() => {
    if (cloudData.length > 0 && sensorDb) {
        processData(cloudData, sensorDb.type as "B01" | "C01");
    }
  }, [unit, viewMode, cloudData, sensorDb, processData]);

  // --- EXPORTAR EXCEL ---
  const handleExportExcel = async () => {
    if (cloudData.length === 0)
      return Alert.alert("Sin datos", "No hay datos para exportar.");
    try {
      setLoading(true);
      setLoadingMessage("Generando Excel...");
      await new Promise(r => setTimeout(r, 100));

      const isB01 = sensorDb?.type === "B01";
      const dataToExport = cloudData.map((item) => {
        const row: any = {
          Fecha: new Date(item.timestamp).toLocaleString("es-AR"),
        };
        if (isB01) {
          row["Temp. Suelo"] = item.soil_temp;
          [1, 2, 3].forEach((idx) => {
            const mv = item[`e${idx}_mv`];
            row[`E${idx} mV`] = mv;
            const segs = electrodeConfig[idx];
            let hv = 0;
            if (segs) hv = calculateMoistureFromSegments(mv, segs);
            row[`E${idx} Hv`] = Number(hv.toFixed(2));
          });
        } else {
          row["Temp"] = item.air_temp;
          row["Hum"] = item.humidity;
        }
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Datos Nube");
      const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      // @ts-ignore
      const uri = FileSystem.cacheDirectory + `Nube_${sensorId}.xlsx`;
      await FileSystem.writeAsStringAsync(uri, wbout, { encoding: "base64" });
      
      setLoading(false);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch (e) {
      setLoading(false);
      Alert.alert("Error", "Falló la exportación");
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const type = showPicker;
    setShowPicker(null);
    if (event.type === "dismissed" || !selectedDate) return;
    if (type === "start") {
      setDateStart(selectedDate);
      if (selectedDate > dateEnd) setDateEnd(selectedDate);
    } else {
      if (selectedDate < dateStart) Alert.alert("Error", "Fecha inválida");
      else setDateEnd(selectedDate);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Historial en Nube</Text>
          <Text style={styles.subtitle}>{sensorDb?.alias || sensorId}</Text>
        </View>
        <MaterialCommunityIcons name="cloud-check" size={28} color={Colors.primary} style={{marginLeft: 'auto', marginRight: 10}} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} scrollEnabled={!loading}>
        {/* Filtros */}
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
              <>
                <MaterialCommunityIcons name="cloud-search" size={24} color="#fff" />
                <Text style={styles.searchBtnText}>Consultar Nube</Text>
              </>
          </TouchableOpacity>
        </View>

        {/* Toolbar (Solo Excel, sin borrar) */}
        {cloudData.length > 0 && (
          <View style={styles.toolbar}>
            <TouchableOpacity style={[styles.toolBtn, { backgroundColor: "#E8F5E9", flex: 1 }]} onPress={handleExportExcel} disabled={loading}>
              <MaterialCommunityIcons name="microsoft-excel" size={22} color="#2E7D32" />
              <Text style={[styles.toolText, { color: "#2E7D32" }]}>Exportar Excel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Controles Visualización */}
        {cloudData.length > 0 && (
          <View style={styles.controlsContainer}>
            {sensorDb?.type === "B01" && (
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
                <Text style={styles.sliderText}>Zoom</Text>
                <MaterialCommunityIcons name="magnify-plus-outline" size={20} color={Colors.textSecondary} />
              </View>
              <Slider
                style={{ width: "100%", height: 40 }}
                minimumValue={5} maximumValue={80} step={5} value={spacing} onValueChange={setSpacing}
                minimumTrackTintColor={Colors.primary} maximumTrackTintColor="#d3d3d3" thumbTintColor={Colors.primary}
              />
            </View>
          </View>
        )}

        {/* Gráficos B01 */}
        {sensorDb?.type === "B01" && electrodesData && (
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

        {/* Gráficos C01 */}
        {sensorDb?.type === "C01" && climateData && (
          <View style={styles.content}>
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Temperatura (°C)</Text>
              <SensorChart data={climateData.temp.data} type="line" unit="°C" color={Colors.secondary} spacing={spacing} />
            </View>
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Humedad (%)</Text>
              <SensorChart data={climateData.hum.data} type="line" unit="%" color={Colors.primary} spacing={spacing} />
            </View>
          </View>
        )}

        {showPicker && <DateTimePicker value={showPicker === "start" ? dateStart : dateEnd} mode="date" display="default" onChange={onDateChange} />}
      </ScrollView>

      {/* Overlay de Carga */}
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

  searchButton: { flexDirection: "row", backgroundColor: Colors.secondary, padding: 12, borderRadius: 10, justifyContent: "center", alignItems: "center", gap: 8 },
  searchBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },

  toolbar: { flexDirection: "row", paddingHorizontal: 16, marginBottom: 15, gap: 10 },
  toolBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10, gap: 5 },
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
  
  loadingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  loadingContainer: { backgroundColor: '#fff', padding: 25, borderRadius: 12, alignItems: 'center', elevation: 5 },
  loadingText: { marginTop: 15, fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary }
});