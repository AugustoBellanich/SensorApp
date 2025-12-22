import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

// Componentes
import SegmentedControl from "../../../components/global/SegmentedControl";
import SensorChart from "../../../components/sensor/SensorChart";
import StatPanel from "../../../components/sensor/StatPanel";
import { Colors } from "../../../constants/Colors";

// DB & Lógica
import { getElectrodesBySensor } from "../../../database/ElectrodeRepository";
import { getReadingsInRange } from "../../../database/ReadingsRepository";
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

type UnitType = "% Hv" | "% Hg" | "mV";
type ViewMode = "optimized" | "real";

export default function LocalDataScreen() {
  const { id } = useLocalSearchParams();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Estados
  const [loading, setLoading] = useState(false);
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);

  // Filtros
  const [dateStart, setDateStart] = useState(
    new Date(new Date().setDate(new Date().getDate() - 1))
  );
  const [dateEnd, setDateEnd] = useState(new Date());
  const [showPicker, setShowPicker] = useState<"start" | "end" | null>(null);

  // Configs
  const [viewMode, setViewMode] = useState<ViewMode>("optimized");
  const [unit, setUnit] = useState<UnitType>("% Hv");
  const [spacing, setSpacing] = useState<number>(30); // Zoom por defecto

  const [electrodesInfo, setElectrodesInfo] = useState<
    Record<number, ElectrodeEntity>
  >({});
  const [electrodeConfig, setElectrodeConfig] = useState<
    Record<number, LinearSegment[]>
  >({});
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // Datos
  const [localData, setLocalData] = useState<any[]>([]);
  const [electrodesData, setElectrodesData] = useState<any>(null);
  const [soilTempData, setSoilTempData] = useState<any>(null);
  const [climateData, setClimateData] = useState<any>(null);
  const [agroStats, setAgroStats] = useState<any>(null);

  // 1. Init
  useEffect(() => {
    const loadConfig = async () => {
      const s = await getSensorById(sensorId);
      setSensorDb(s);

      if (s?.type === "B01") {
        const elecs = await getElectrodesBySensor(sensorId);
        const infoMap: Record<number, ElectrodeEntity> = {};
        const configMap: Record<number, LinearSegment[]> = {};
        elecs.forEach((e) => {
          infoMap[e.electrode_index] = e;
          if (e.equations_json) {
            try {
              configMap[e.electrode_index] = JSON.parse(e.equations_json);
            } catch {}
          }
        });
        setElectrodesInfo(infoMap);
        setElectrodeConfig(configMap);
      }
      setIsConfigLoaded(true);
    };
    loadConfig();
  }, [sensorId]);

  // --- HELPERS VISUALES (BLINDADOS) ---
  const formatChart = useCallback(
    (arr: any[]) => {
      if (!arr || arr.length === 0) return [];

      // Control de etiquetas según zoom
      const pixelsPerLabel = 60;
      let step = Math.ceil(pixelsPerLabel / spacing);
      if (step < 1) step = 1;

      let lastDateString = "";

      return arr.map((p, index) => {
        // BLINDAJE CONTRA NaN
        const val = Number(p.value);
        if (isNaN(val)) return { value: 0, label: "" };

        const ts = new Date(p.timestamp).getTime();
        const d = new Date(ts);
        let label = "";

        // Mostrar etiqueta si toca el paso o es el último punto
        if (index % step === 0 || index === arr.length - 1) {
          const dateStr = d.getDate() + "/" + (d.getMonth() + 1);
          const timeStr = d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
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

        let v1 = mv1,
          v2 = mv2,
          v3 = mv3;
        if (unit !== "mV") {
          const rho1 = electrodesInfo[1]?.density || 1.3;
          const rho2 = electrodesInfo[2]?.density || 1.3;
          const rho3 = electrodesInfo[3]?.density || 1.3;

          if (electrodeConfig[1])
            v1 = calculateMoistureFromSegments(mv1, electrodeConfig[1]);
          if (electrodeConfig[2])
            v2 = calculateMoistureFromSegments(mv2, electrodeConfig[2]);
          if (electrodeConfig[3])
            v3 = calculateMoistureFromSegments(mv3, electrodeConfig[3]);

          if (unit === "% Hg") {
            v1 /= rho1;
            v2 /= rho2;
            v3 /= rho3;
          }
        }
        return { ...d, v1, v2, v3 };
      });

      const prep = (key: string) => {
        let finalData;

        // Lógica del SWITCH Optimizado/Real
        if (viewMode === "optimized") {
          const interval = 3600 * 1000; // 1h
          // downsample devuelve {value, timestamp}
          finalData = downsampleData(processed, key, interval);
        } else {
          // Real: Mapeo directo
          finalData = processed.map((p) => ({
            timestamp: p.timestamp,
            value: p[key],
          }));
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
        if (viewMode === "optimized") {
          const interval = 3600 * 1000;
          finalData = downsampleData(data, key, interval);
        } else {
          finalData = data.map((p) => ({
            timestamp: p.timestamp,
            value: p[key],
          }));
        }
        return { data: formatChart(finalData), stats: calcStats(finalData) };
      };
      setClimateData({ temp: prep("air_temp"), hum: prep("humidity") });
      let chill = 0,
        frost = 0,
        heat = 0;
      data.forEach((d) => {
        const t = Number(d.air_temp);
        if (t > 0 && t <= 7.2) chill += 0.5;
        if (t <= 0) frost += 0.5;
        if (t >= 35) heat += 0.5;
      });
      setAgroStats({ chill, frost, heat });
    },
    [formatChart, calcStats, viewMode]
  );

  const processData = useCallback(
    (data: any[], type: "B01" | "C01") => {
      if (type === "B01") processB01(data);
      else processC01(data);
    },
    [processB01, processC01]
  );

  // DB Call
  const handleSearchData = useCallback(
    async (sensor: SensorEntity, start: Date, end: Date) => {
      if (sensor.type !== "B01" && sensor.type !== "C01") return;
      setLoading(true);
      try {
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        const type = sensor.type as "B01" | "C01";
        const data = await getReadingsInRange(sensorId, type, s, e);
        if (data && data.length > 0) {
          setLocalData(data);
          processData(data, type);
        } else {
          setLocalData([]);
          setElectrodesData(null);
          setClimateData(null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [sensorId, processData]
  );

  // Efectos
  useEffect(() => {
    if (isConfigLoaded && sensorDb)
      handleSearchData(sensorDb, dateStart, dateEnd);
  }, [isConfigLoaded, dateStart, dateEnd, handleSearchData, sensorDb]);
  useEffect(() => {
    if (localData.length > 0 && sensorDb)
      processData(localData, sensorDb.type as "B01" | "C01");
  }, [unit, viewMode, localData, sensorDb, processData]);

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
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={Colors.textPrimary}
          />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Historial Local</Text>
          <Text style={styles.subtitle}>{sensorDb?.alias || sensorId}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        scrollEnabled={true}
      >
        {/* Filtros */}
        <View style={styles.filterCard}>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowPicker("start")}
            >
              <Text style={styles.dateLabel}>Desde</Text>
              <Text style={styles.dateVal}>
                {dateStart.toLocaleDateString()}
              </Text>
            </TouchableOpacity>
            <MaterialCommunityIcons name="arrow-right" size={20} color="#ccc" />
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowPicker("end")}
            >
              <Text style={styles.dateLabel}>Hasta</Text>
              <Text style={styles.dateVal}>{dateEnd.toLocaleDateString()}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() =>
              sensorDb && handleSearchData(sensorDb, dateStart, dateEnd)
            }
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="magnify" size={24} color="#fff" />
                <Text style={styles.searchBtnText}>Consultar Datos</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Controles */}
        {localData.length > 0 && (
          <View style={styles.controlsContainer}>
            {sensorDb?.type === "B01" && (
              <View style={{ marginBottom: 15 }}>
                <SegmentedControl
                  options={["% Hv", "% Hg", "mV"]}
                  selectedIndex={unit === "% Hv" ? 0 : unit === "% Hg" ? 1 : 2}
                  onChange={(i) =>
                    setUnit(i === 0 ? "% Hv" : i === 1 ? "% Hg" : "mV")
                  }
                />
              </View>
            )}

            <View style={styles.viewModeToggleRow}>
              <Text
                style={[
                  styles.viewModeLabel,
                  viewMode === "optimized" && styles.activeModeText,
                ]}
              >
                Optimizado
              </Text>
              <Switch
                value={viewMode === "real"}
                onValueChange={(val) => setViewMode(val ? "real" : "optimized")}
                trackColor={{ false: "#e0e0e0", true: Colors.primary }}
                thumbColor={"#fff"}
              />
              <Text
                style={[
                  styles.viewModeLabel,
                  viewMode === "real" && styles.activeModeText,
                ]}
              >
                Real
              </Text>
            </View>

            <View style={styles.sliderContainer}>
              <View style={styles.sliderLabels}>
                <MaterialCommunityIcons
                  name="magnify-minus-outline"
                  size={20}
                  color={Colors.textSecondary}
                />
                <Text style={styles.sliderText}>Zoom</Text>
                <MaterialCommunityIcons
                  name="magnify-plus-outline"
                  size={20}
                  color={Colors.textSecondary}
                />
              </View>
              <Slider
                style={{ width: "100%", height: 40 }}
                minimumValue={5}
                maximumValue={80}
                step={5}
                value={spacing}
                onValueChange={setSpacing}
                minimumTrackTintColor={Colors.primary}
                maximumTrackTintColor="#d3d3d3"
                thumbTintColor={Colors.primary}
              />
            </View>
          </View>
        )}

        {/* SUELO B01 */}
        {sensorDb?.type === "B01" && electrodesData && (
          <View style={styles.content}>
            {soilTempData && (
              <View style={styles.chartBox}>
                <Text style={styles.sectionTitle}>Temp. Suelo (°C)</Text>
                <StatPanel stats={soilTempData.stats} unit="°C" />
                <SensorChart
                  data={soilTempData.data}
                  type="line"
                  unit="°C"
                  color={Colors.secondary}
                  spacing={spacing}
                />
              </View>
            )}

            {[1, 2, 3].map((num) => {
              const refLines = getAgronomicLines(electrodesInfo[num], unit);

              // DEBUG: Verifica si se están generando las líneas
              if (num === 1)
                console.log(`[DEBUG LÍNEAS E1]`, JSON.stringify(refLines));

              let maxY = undefined;
              const satLine = refLines.find((l) => l.label === "SAT");
              if (satLine && satLine.value > 0) maxY = satLine.value + 5;

              return (
                <View key={num} style={styles.chartBox}>
                  <Text style={styles.sectionTitle}>
                    Electrodo {num} ({unit})
                  </Text>
                  <StatPanel stats={electrodesData[num]?.stats} unit={unit} />

                  <SensorChart
                    data={electrodesData[num]?.data}
                    type="line"
                    unit={unit}
                    color={Colors.primary}
                    referenceLines={refLines}
                    spacing={spacing}
                    yAxisMax={maxY}
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* CLIMA C01 */}
        {sensorDb?.type === "C01" && climateData && (
          <View style={styles.content}>
            {/* Agro Panel... */}
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Temperatura (°C)</Text>
              <SensorChart
                data={climateData.temp.data}
                type="line"
                unit="°C"
                color={Colors.secondary}
                spacing={spacing}
              />
            </View>
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Humedad (%)</Text>
              <SensorChart
                data={climateData.hum.data}
                type="line"
                unit="%"
                color={Colors.primary}
                spacing={spacing}
              />
            </View>
          </View>
        )}

        {showPicker && (
          <DateTimePicker
            value={showPicker === "start" ? dateStart : dateEnd}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  backButton: { marginRight: 15 },
  title: { fontSize: 18, fontWeight: "bold", color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary },

  filterCard: {
    backgroundColor: "#fff",
    margin: 16,
    padding: 15,
    borderRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eee",
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  dateBtn: {
    flex: 1,
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  dateLabel: { fontSize: 10, color: "#888" },
  dateVal: { fontSize: 14, fontWeight: "bold", color: "#333" },

  searchButton: {
    flexDirection: "row",
    backgroundColor: Colors.primary,
    padding: 12,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  searchBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },

  controlsContainer: { paddingHorizontal: 16, marginBottom: 15 },

  viewModeToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
    gap: 10,
  },
  viewModeLabel: { fontSize: 14, color: "#999" },
  activeModeText: { color: Colors.primary, fontWeight: "bold" },

  sliderContainer: {
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  sliderText: { fontSize: 12, color: Colors.textSecondary, fontWeight: "600" },

  content: { paddingHorizontal: 16 },
  chartBox: { marginBottom: 25 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  unitSuffix: {
    fontSize: 12,
    fontWeight: "normal",
    color: Colors.textSecondary,
  },

  agroPanel: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#eee",
    justifyContent: "space-between",
  },
});
