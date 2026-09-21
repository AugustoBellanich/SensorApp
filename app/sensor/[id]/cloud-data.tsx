import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
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
import {
  calculateMedian,
  downsampleData,
  fillTimeGaps,
  formatChartData,
  formatForExcel,
  getOptimalInterval,
} from "../../../utils/dataProcessing";
import { getAgronomicLines } from "../../../utils/referenceLines";

// --- IMPORTANTE: CLIENTE SUPABASE ---
import { supabase } from "../../../lib/supabase";

type UnitType = "% Hv" | "% Hg" | "mV";

// --- CONSTANTES AGRONÓMICAS ---
const CLIMATE_LINES = [
  { value: 0, label: "Helada", color: "#4FC3F7" },
  { value: 7.2, label: "Hora Frío", color: "#1E88E5" },
  { value: 35, label: "Calor Ext.", color: "#FF7043" },
];

export default function CloudDataScreen() {
  const { id } = useLocalSearchParams();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Estados UI
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [sensorDb, setSensorDb] = useState<SensorEntity | null>(null);

  // Filtros Fecha (dateStart inicia vacío, dateEnd en hoy)
  const [dateStart, setDateStart] = useState<Date | null>(null);
  const [dateEnd, setDateEnd] = useState(new Date());
  const [showPicker, setShowPicker] = useState<"start" | "end" | null>(null);

  // Configs Visualización
  const [unit, setUnit] = useState<UnitType>("% Hv");

  // Configuración de Electrodos
  const [electrodesInfo, setElectrodesInfo] = useState<
    Record<number, ElectrodeEntity>
  >({});
  const [electrodeConfig, setElectrodeConfig] = useState<
    Record<number, LinearSegment[]>
  >({});

  // Datos
  const [cloudData, setCloudData] = useState<any[]>([]);
  const [electrodesData, setElectrodesData] = useState<any>(null);
  const [soilTempData, setSoilTempData] = useState<any>(null);
  const [climateData, setClimateData] = useState<any>(null);

  // Indicadores Agronómicos
  const [agroStats, setAgroStats] = useState({ chill: 0, frost: 0, heat: 0 });

  // 1. Init: Cargar Configuración Local del Sensor
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
    };
    loadConfig();
  }, [sensorId]);

  const calcStats = useCallback((arr: any[]) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const vals = arr.map((d) => Number(d.value) || 0);
    const min = vals.reduce((m, v) => (v < m ? v : m), vals[0]);
    const max = vals.reduce((m, v) => (v > m ? v : m), vals[0]);
    return { min, max, avg: calculateMedian(vals) };
  }, []);

  // --- PROCESAMIENTO B01 ---
  const processB01 = useCallback(
    (data: any[]) => {
      if (!dateStart) return;
      // 1. NORMALIZACIÓN DE FECHAS (Corrección del error de 1 día)
      const rangeStart = new Date(dateStart);
      rangeStart.setHours(0, 0, 0, 0);

      const rangeEnd = new Date(dateEnd);
      rangeEnd.setHours(23, 59, 59, 999);

      // 2. Configuración Óptima usando el rango expandido
      const settings = getOptimalInterval(rangeStart, rangeEnd);
      const { intervalMs, labelFormat } = settings;

      // 3. Selección de valores YA CALCULADOS por el trigger en Supabase
      const processed = data.map((d) => {
        let v1, v2, v3;

        if (unit === "mV") {
          v1 = Number(d.e1_mv);
          v2 = Number(d.e2_mv);
          v3 = Number(d.e3_mv);
        } else if (unit === "% Hg") {
          v1 = Number(d.e1_hg);
          v2 = Number(d.e2_hg);
          v3 = Number(d.e3_hg);
        } else {
          // "% Hv"
          v1 = Number(d.e1_hv);
          v2 = Number(d.e2_hv);
          v3 = Number(d.e3_hv);
        }

        return { ...d, v1, v2, v3 };
      });

      // 4. Definición de la Grilla Temporal (Usando las fechas expandidas)
      const startMs = rangeStart.getTime();
      const endMs = rangeEnd.getTime();

      const gridStart = new Date(Math.floor(startMs / intervalMs) * intervalMs);
      const gridEnd = new Date(Math.ceil(endMs / intervalMs) * intervalMs);

      const prep = (key: string) => {
        const validData = processed.filter((p) => {
          const v = p[key];
          return v !== undefined && v !== null && !isNaN(v) && v > 0;
        });

        // Siempre agrupamos por intervalo: mediana como línea central +
        // min/max del bucket para la banda de variación.
        const downsampled = downsampleData(validData, key, intervalMs);
        const stats = calcStats(downsampled);
        const filled = fillTimeGaps(
          downsampled,
          intervalMs,
          gridStart,
          gridEnd,
        );
        const finalData = formatChartData(filled, labelFormat);

        return { data: finalData, stats };
      };

      setElectrodesData({ 1: prep("v1"), 2: prep("v2"), 3: prep("v3") });
      setSoilTempData(prep("soil_temp"));
    },
    [unit, calcStats, dateStart, dateEnd],
  );

  // --- PROCESAMIENTO C01 ---
  const processC01 = useCallback(
    (data: any[]) => {
      if (!dateStart) return;
      // 1. NORMALIZACIÓN DE FECHAS
      const rangeStart = new Date(dateStart);
      rangeStart.setHours(0, 0, 0, 0);

      const rangeEnd = new Date(dateEnd);
      rangeEnd.setHours(23, 59, 59, 999);

      // Estadísticas Agronómicas (sobre datos crudos)
      let chill = 0,
        frost = 0,
        heat = 0;

      const sorted = [...data].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      for (let i = 1; i < sorted.length; i++) {
        const t1 = new Date(sorted[i - 1].timestamp).getTime();
        const t2 = new Date(sorted[i].timestamp).getTime();
        const hours = (t2 - t1) / 3600000;

        if (hours > 24) continue; // Ignorar huecos gigantes

        const t = Number(sorted[i].air_temp);
        if (t !== undefined && !isNaN(t)) {
          if (t > 0 && t <= 7.2) chill += hours;
          if (t <= 0) frost += hours;
          if (t >= 35) heat += hours;
        }
      }

      setAgroStats({
        chill: Number(chill.toFixed(1)),
        frost: Number(frost.toFixed(1)),
        heat: Number(heat.toFixed(1)),
      });

      // 2. Gráficos - Configuración Óptima con fechas expandidas
      const settings = getOptimalInterval(rangeStart, rangeEnd);
      const { intervalMs, labelFormat } = settings;

      // 3. Definición de la Grilla Temporal
      const startMs = rangeStart.getTime();
      const endMs = rangeEnd.getTime();

      const gridStart = new Date(Math.floor(startMs / intervalMs) * intervalMs);
      const gridEnd = new Date(Math.ceil(endMs / intervalMs) * intervalMs);

      const prep = (key: string) => {
        const validData = data.filter((p) => {
          const v = p[key];
          return v !== undefined && v !== null && !isNaN(v) && v > -50; // Permitir temp negativa
        });

        const downsampled = downsampleData(validData, key, intervalMs);
        const stats = calcStats(downsampled);
        const filled = fillTimeGaps(
          downsampled,
          intervalMs,
          gridStart,
          gridEnd,
        );
        const finalData = formatChartData(filled, labelFormat);

        return { data: finalData, stats };
      };

      setClimateData({ temp: prep("air_temp"), hum: prep("humidity") });
    },
    [calcStats, dateStart, dateEnd],
  );

  const processData = useCallback(
    (data: any[], type: "B01" | "C01") => {
      setLoading(true);
      setLoadingMessage("Procesando gráficos...");
      setTimeout(() => {
        if (type === "B01") processB01(data);
        else processC01(data);
        setLoading(false);
      }, 50);
    },
    [processB01, processC01],
  );

  // --- CONSULTA A SUPABASE ---
  const handleSearchData = useCallback(
    async (sensor: SensorEntity, start: Date, end: Date) => {
      if (sensor.type !== "B01" && sensor.type !== "C01") return;

      setLoading(true);
      setLoadingMessage("Descargando historial completo...");

      try {
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        const type = sensor.type as "B01" | "C01";
        const tableName = type === "B01" ? "readings_b01" : "readings_c01";

        let allData: any[] = [];
        let from = 0;
        const PAGE_SIZE = 1000;
        let fetchMore = true;

        while (fetchMore) {
          const { data, error } = await supabase
            .from(tableName)
            .select("*")
            .eq("sensor_id", sensorId)
            .gte("timestamp", s.toISOString())
            .lte("timestamp", e.toISOString())
            .order("timestamp", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

          if (error) throw error;

          if (data && data.length > 0) {
            allData = [...allData, ...data];
            from += PAGE_SIZE;
            if (data.length < PAGE_SIZE) fetchMore = false;
          } else {
            fetchMore = false;
          }
        }

        // SOLO guardamos la data. El useEffect se encargará de graficar.
        if (allData.length > 0) {
          setCloudData(allData);
        } else {
          setCloudData([]);
          Alert.alert(
            "Aviso",
            "No se encontraron datos en la nube para este periodo.",
          );
        }
      } catch {
        Alert.alert("Error", "Falló la descarga de datos.");
      } finally {
        setLoading(false);
      }
    },
    [sensorId],
  );

  useEffect(() => {
    // Escucha automáticamente cuando llega data nueva
    if (cloudData.length > 0 && sensorDb && dateStart) {
      processData(cloudData, sensorDb.type as "B01" | "C01");
    }
  }, [unit, cloudData, sensorDb, processData, dateStart]);

  // --- EXPORTAR EXCEL ---
  const handleExportExcel = async () => {
    if (cloudData.length === 0)
      return Alert.alert("Sin datos", "No hay datos para exportar.");
    try {
      setLoading(true);
      setLoadingMessage("Generando Excel...");
      await new Promise((r) => setTimeout(r, 100));

      const isB01 = sensorDb?.type === "B01";
      const dataToExport = cloudData.map((item) => {
        const row: any = {
          Fecha: formatForExcel(item.timestamp),
        };
        if (isB01) {
          row["Temp. Suelo"] = item.soil_temp;
          [1, 2, 3].forEach((idx) => {
            row[`E${idx} mV`] = item[`e${idx}_mv`];
            row[`E${idx} Hv`] = item[`e${idx}_hv`];
            row[`E${idx} Hg`] = item[`e${idx}_hg`];
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
      const fs = FileSystem;
      const dir = fs.documentDirectory || fs.cacheDirectory;
      const uri = dir + `Nube_${sensorId}.xlsx`;
      await fs.writeAsStringAsync(uri, wbout, { encoding: "base64" });

      setLoading(false);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      setLoading(false);
      Alert.alert("Error", "Falló la exportación");
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const type = showPicker;
    setShowPicker(null);
    if (event.type === "dismissed" || !selectedDate) return;

    let newStart = dateStart;
    let newEnd = dateEnd;

    if (type === "start") {
      newStart = selectedDate;
      if (newStart > newEnd) newEnd = newStart;
    } else {
      if (dateStart && selectedDate < dateStart) {
        Alert.alert("Error", "La fecha 'Hasta' no puede ser menor a 'Desde'");
        return;
      }
      newEnd = selectedDate;
    }

    setDateStart(newStart);
    setDateEnd(newEnd);

    // Limpiar gráficos y datos viejos al instante para que la UI no se deforme
    setCloudData([]);
    setElectrodesData(null);
    setSoilTempData(null);
    setClimateData(null);

    // Si tenemos ambas fechas (y el sensor cargó), buscar automáticamente
    if (newStart && newEnd && sensorDb) {
      handleSearchData(sensorDb, newStart, newEnd);
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
          <Text style={styles.title}>Historial en Nube</Text>
          <Text style={styles.subtitle}>{sensorDb?.alias || sensorId}</Text>
        </View>
        <MaterialCommunityIcons
          name="cloud-check"
          size={28}
          color={Colors.primary}
          style={{ marginLeft: "auto", marginRight: 10 }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        scrollEnabled={!loading}
      >
        {/* Filtros */}
        <View style={styles.filterCard}>
          {/* Le quitamos el marginBottom: 15 que tenía porque ya no hay botón abajo */}
          <View style={[styles.dateRow, { marginBottom: 0 }]}>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowPicker("start")}
            >
              <Text style={styles.dateLabel}>Desde</Text>
              <Text style={styles.dateVal}>
                {dateStart ? dateStart.toLocaleDateString() : "Seleccionar..."}
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

          {/* ELIMINA POR COMPLETO el <TouchableOpacity style={styles.searchButton}> que estaba acá */}
        </View>

        {/* Toolbar */}
        {cloudData.length > 0 && (
          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolBtn, { backgroundColor: "#E8F5E9", flex: 1 }]}
              onPress={handleExportExcel}
              disabled={loading}
            >
              <MaterialCommunityIcons
                name="microsoft-excel"
                size={22}
                color="#2E7D32"
              />
              <Text style={[styles.toolText, { color: "#2E7D32" }]}>
                Exportar Excel
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Controles Visualización */}
        {cloudData.length > 0 && sensorDb?.type === "B01" && (
          <View style={styles.controlsContainer}>
            <SegmentedControl
              options={["% Hv", "% Hg", "mV"]}
              selectedIndex={unit === "% Hv" ? 0 : unit === "% Hg" ? 1 : 2}
              onChange={(i) =>
                setUnit(i === 0 ? "% Hv" : i === 1 ? "% Hg" : "mV")
              }
            />
          </View>
        )}

        {/* PANEL AGRO (C01) */}
        {sensorDb?.type === "C01" && cloudData.length > 0 && (
          <View style={styles.agroPanel}>
            <View style={styles.agroItem}>
              <MaterialCommunityIcons
                name="snowflake"
                size={24}
                color="#1E88E5"
              />
              <Text style={styles.agroValue}>
                {Math.round(agroStats.chill)} h
              </Text>
              <Text style={styles.agroLabel}>Horas Frío</Text>
            </View>
            <View style={styles.dividerVertical} />
            <View style={styles.agroItem}>
              <MaterialCommunityIcons
                name="alert-octagon"
                size={24}
                color={agroStats.frost > 0 ? Colors.error : "#ccc"}
              />
              <Text
                style={[
                  styles.agroValue,
                  {
                    color:
                      agroStats.frost > 0 ? Colors.error : Colors.textPrimary,
                  },
                ]}
              >
                {Math.round(agroStats.frost)} h
              </Text>
              <Text style={styles.agroLabel}>Heladas</Text>
            </View>
            <View style={styles.dividerVertical} />
            <View style={styles.agroItem}>
              <MaterialCommunityIcons
                name="white-balance-sunny"
                size={24}
                color={Colors.warning}
              />
              <Text style={styles.agroValue}>
                {Math.round(agroStats.heat)} h
              </Text>
              <Text style={styles.agroLabel}>Calor Ext.</Text>
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
                <SensorChart
                  data={soilTempData.data}
                  type="line"
                  unit="°C"
                  color={Colors.secondary}
                />
              </View>
            )}
            {[1, 2, 3].map((num) => {
              const refLines = getAgronomicLines(electrodesInfo[num], unit);
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
                    yAxisMax={maxY}
                  />
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
              <SensorChart
                data={climateData.temp.data}
                type="line"
                unit="°C"
                color={Colors.secondary}
                referenceLines={CLIMATE_LINES}
              />
            </View>
            <View style={styles.chartBox}>
              <Text style={styles.sectionTitle}>Humedad (%)</Text>
              <SensorChart
                data={climateData.hum.data}
                type="line"
                unit="%"
                color={Colors.primary}
              />
            </View>
          </View>
        )}

        {showPicker && (
          <DateTimePicker
            value={showPicker === "start" ? dateStart || new Date() : dateEnd}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </ScrollView>

      {/* Overlay de Carga */}
      <Modal transparent={true} animationType="fade" visible={loading}>
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>
              {loadingMessage || "Cargando..."}
            </Text>
          </View>
        </View>
      </Modal>
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

  toolbar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 15,
    gap: 10,
  },
  toolBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 10,
    gap: 5,
  },
  toolText: { fontWeight: "bold", fontSize: 14 },

  controlsContainer: { paddingHorizontal: 16, marginBottom: 15 },

  content: { paddingHorizontal: 16 },
  chartBox: { marginBottom: 25 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
    marginBottom: 8,
  },

  agroPanel: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 15,
    elevation: 2,
    marginBottom: 25,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: "#eee",
    justifyContent: "space-between",
  },
  agroItem: { flex: 1, alignItems: "center" },
  agroValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.textPrimary,
    marginVertical: 4,
  },
  agroLabel: { fontSize: 11, fontWeight: "bold", color: Colors.textSecondary },
  dividerVertical: {
    width: 1,
    backgroundColor: "#eee",
    height: "80%",
    alignSelf: "center",
  },

  loadingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContainer: {
    backgroundColor: "#fff",
    padding: 25,
    borderRadius: 12,
    alignItems: "center",
    elevation: 5,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
  },
});
