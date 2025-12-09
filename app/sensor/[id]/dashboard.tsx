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

  // ESTADO DE CONEXIÓN (MOCK)
  // false = Botón de descarga deshabilitado
  // true = Botón de descarga habilitado
  const isConnected = false; 

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 1. Panel Superior */}
      <SensorStatusPanel
        batteryMv={data.batteryMv}
        soilTemp={data.soilTemp}
        status={data.status}
        showSoilTemp={!isClimateSensor}
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
        {/* TARJETAS DE DATOS */}
        {isClimateSensor ? (
          // === VISTA C01 (En Fila) ===
          <View style={styles.rowContainer}>
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

        {/* === ZONA DE ACCIONES === */}
        <View style={{ marginTop: 20 }}>
          
          {/* 1. DESCARGAR DATOS (SD) - Requiere Conexión */}
          <TouchableOpacity
            style={[styles.actionButton, !isConnected && styles.btnDisabled]}
            disabled={!isConnected}
            onPress={() => {
              if (isClimateSensor) {
                router.push(`/sensor/${sensorIdStr}/sd-data-climate`);
              } else {
                router.push(`/sensor/${sensorIdStr}/sd-data`);
              }
            }}
          >
            <View
              style={[
                styles.iconCircle,
                !isConnected && { backgroundColor: "#ccc" },
              ]}
            >
              <MaterialCommunityIcons name="download" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.btnTitle,
                  !isConnected && { color: "#999" },
                ]}
              >
                Descargar Tarjeta SD
              </Text>
              <Text style={styles.btnSub}>
                {isConnected
                  ? "Sincronizar nuevas lecturas"
                  : "Sensor desconectado"}
              </Text>
            </View>
            {isConnected && (
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color="#ccc"
              />
            )}
          </TouchableOpacity>

          {/* 2. VER DATOS GUARDADOS (LOCAL) - Siempre Disponible */}
          <TouchableOpacity
            style={[styles.actionButton, styles.btnLocal]}
            onPress={() => router.push(`/sensor/${sensorIdStr}/local-data`)}
          >
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: Colors.secondary },
              ]}
            >
              <MaterialCommunityIcons
                name="database-search"
                size={24}
                color="#fff"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.btnTitle}>Ver Datos Guardados</Text>
              <Text style={styles.btnSub}>Consultar historial offline</Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color="#ccc"
            />
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1, backgroundColor: "#f2f2f2" },
  scrollContent: { padding: 12 },

  rowContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },

  // ESTILOS BOTONES DE ACCIÓN
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    marginTop: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eee",
  },
  btnLocal: { marginTop: 10 }, // Margen entre botones
  btnDisabled: {
    backgroundColor: "#f9f9f9",
    elevation: 0,
    borderColor: "#eee",
  },

  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  btnTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  btnSub: { fontSize: 12, color: Colors.textSecondary },
});