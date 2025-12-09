import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "../../../constants/Colors";

import ClimateCard from "../../../components/sensor/ClimateCard";
import ElectrodeCard from "../../../components/sensor/ElectrodeCard";
import SensorInfoBar from "../../../components/sensor/SensorInfoBar";
import SensorStatusPanel from "../../../components/sensor/SensorStatusPanel";

// MOCKS
const MOCK_B01_DATA = {
  batteryMv: 4050,
  soilTemp: 23.8,
  status: { sd: true, lora: true, rtc: true },
  electrodes: [
    { num: 1, depth: 10, hv: 15.1, hg: 12.6, mv: 1147, calibrated: true },
    { num: 2, depth: 30, hv: 22.4, hg: 18.2, mv: 1020, calibrated: true },
    { num: 3, depth: 60, hv: 0, hg: 0, mv: 850, calibrated: false },
  ],
};

const MOCK_C01_DATA = {
  batteryMv: 4120,
  soilTemp: 0,
  status: { sd: true, lora: true, rtc: true },
  climate: {
    temp: 26.5,
    hum: 48.2,
  },
};

export default function SensorDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;
  const isClimateSensor = sensorIdStr.includes("C01");
  const data = isClimateSensor ? MOCK_C01_DATA : MOCK_B01_DATA;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 1. Panel Superior (Sin Temp Suelo si es C01) */}
      <SensorStatusPanel
        batteryMv={data.batteryMv}
        soilTemp={data.soilTemp}
        status={data.status}
        showSoilTemp={!isClimateSensor} // <--- OCULTAR SI ES C01
      />

      {/* 2. Info Bar */}
      <SensorInfoBar
        id={sensorIdStr}
        alias={isClimateSensor ? "Estación Casco" : "Nogales Lote 1"}
        location={isClimateSensor ? "Techo Galpón" : "Finca Experimental"}
        onEditPress={() => router.push(`/sensor/${sensorIdStr}/info`)}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {isClimateSensor ? (
          // === VISTA C01 (En Fila) ===
          <View style={styles.rowContainer}>
            {/* Usamos un View flexible para cada tarjeta */}
            <ClimateCard type="temp" value={MOCK_C01_DATA.climate.temp} />
            <ClimateCard type="hum" value={MOCK_C01_DATA.climate.hum} />
          </View>
        ) : (
          // === VISTA B01 (En Columna) ===
          <View>
            {MOCK_B01_DATA.electrodes.map((e) => (
              <ElectrodeCard
                key={e.num}
                number={e.num as 1 | 2 | 3}
                depthCm={e.depth}
                volumetricMoisture={e.hv}
                gravimetricMoisture={e.hg}
                voltageMv={e.mv}
                isCalibrated={e.calibrated}
                onCalibratePress={() =>
                  router.push(
                    `/sensor/${sensorIdStr}/calibration?electrode=${e.num}`
                  )
                }
              />
            ))}
          </View>
        )}

        {/* BOTÓN DESCARGA */}
        <TouchableOpacity
          style={styles.historyButton}
          // LÓGICA DE NAVEGACIÓN CONDICIONAL
          onPress={() => {
            if (isClimateSensor) {
              router.push(`/sensor/${sensorIdStr}/sd-data-climate`);
            } else {
              router.push(`/sensor/${sensorIdStr}/sd-data`);
            }
          }}
        >
          <MaterialCommunityIcons name="download" size={24} color="#fff" />
          <Text style={styles.historyBtnTitle}>Descargar Datos</Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color="rgba(255,255,255,0.6)"
            style={{ marginLeft: "auto" }}
          />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: "#f2f2f2" },
  scrollContent: { padding: 12 },

  // Estilo para fila
  rowContainer: {
    flexDirection: "row", // Lado a lado
    justifyContent: "space-between",
    gap: 4, // Pequeña separación extra si hace falta
  },

  historyButton: {
    flexDirection: "row",
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 15,
    marginBottom: 10,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  historyBtnTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 12,
    letterSpacing: 0.5,
  },
});
