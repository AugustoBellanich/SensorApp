import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { Colors } from "../../../constants/Colors";
import { SensorData, useBle } from "../../../context/BleContext";

// --- COMPONENTES ---
import ClimateCard from "../../../components/sensor/ClimateCard";
import ElectrodeCard from "../../../components/sensor/ElectrodeCard";
import SensorInfoBar from "../../../components/sensor/SensorInfoBar";

// --- BASE DE DATOS ---
import { getSensorById } from "../../../database/SensorRepository"; // <--- IMPORTANTE
import { SensorEntity } from "../../../database/types";

// MOCKS: Solo para la estructura física
const MOCK_B01_ELECTRODES_STATIC = [
    { num: 1, depth: 10, calibrated: true },
    { num: 2, depth: 30, calibrated: true },
    { num: 3, depth: 60, calibrated: false },
];

// --- ICONO DINÁMICO (ESTADO) ---
const StatusIcon = ({ name, active, enabled, warning, isConnected }: { name: any, active: boolean, enabled: boolean, warning?: boolean, isConnected: boolean }) => {
    
    // SI ESTÁ DESCONECTADO -> Todo Gris Muy Claro
    if (!isConnected) {
        return (
            <MaterialCommunityIcons 
                name={name} size={22} color={Colors.textSecondary} 
                style={{ opacity: 0.2, marginRight: 15 }} 
            />
        );
    }

    // 1. DESHABILITADO -> GRIS
    if (!enabled) {
        return (
            <MaterialCommunityIcons 
                name={name} size={22} color={Colors.textSecondary} 
                style={{ opacity: 0.3, marginRight: 15 }} 
            />
        );
    }

    // 2. WARNING -> AMARILLO
    if (warning) {
        return (
            <MaterialCommunityIcons 
                name={name} size={22} color={Colors.warning} 
                style={{ opacity: 1, marginRight: 15 }} 
            />
        );
    }

    // 3. ENERGÍA (Habilitado)
    if (active) {
        return (
            <MaterialCommunityIcons 
                name={name} size={22} color={Colors.success} 
                style={{ opacity: 1, marginRight: 15 }} 
            />
        );
    } else {
        return (
            <MaterialCommunityIcons 
                name={name} size={22} color={Colors.primary} 
                style={{ opacity: 1, marginRight: 15 }} 
            />
        );
    }
};

export default function SensorDashboard() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorIdStr = Array.isArray(id) ? id[0] : id;

    // Contexto BLE
    const { connectedDevice, sensorData, diagnosisStatus } = useBle();
    const isConnected = !!connectedDevice; 

    // Estado local para info del sensor (Base de Datos)
    const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);

    // --- CARGAR DATOS DE DB ---
    // Esto asegura que tengamos Nombre, Ubicación y Tipo aunque estemos Offline
    useEffect(() => {
        const loadSensorInfo = async () => {
            if (sensorIdStr) {
                const data = await getSensorById(sensorIdStr);
                setDbSensor(data);
            }
        };
        loadSensorInfo();
    }, [sensorIdStr]);

    // --- ELIMINADO: useEffect que te echaba al Home ---
    // Ahora permitimos quedarnos aquí aunque !connectedDevice

    // Detectar modelo (Prioridad: DB > ID string)
    // Si la DB ya cargó, usamos su tipo. Si no, inferimos por el ID.
    const modelType = dbSensor?.type || (sensorIdStr.includes("B01") ? 'B01' : 'C01');
    const isClimateSensor = modelType === 'C01';

    // --- DATOS (Solo si conectado) ---
    const batteryPercent = isConnected ? (sensorData.battery ?? 0) : 0;
    const currentSoilTemp = isConnected ? (sensorData.soilTemp ?? 0) : 0;
    const currentAirTemp = isConnected ? (sensorData.airTemp ?? 0) : 0;
    const currentHumidity = isConnected ? (sensorData.humidity ?? 0) : 0;

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* 1. PANEL SUPERIOR (HEADER ESTADO) */}
            <View style={[styles.statusPanelContainer, { paddingTop: 50 }]}>
                
                {/* IZQUIERDA: ICONOS (SD, LoRa, RTC) */}
                <View style={styles.modulesRow}>
                    <StatusIcon 
                        name="sd" 
                        active={diagnosisStatus.sdStatus}   
                        enabled={diagnosisStatus.sdEnabled} 
                        isConnected={isConnected} // Pasamos estado global
                    />
                    <StatusIcon 
                        name="radio-tower" 
                        active={diagnosisStatus.loraStatus}   
                        enabled={diagnosisStatus.loraEnabled} 
                        isConnected={isConnected}
                    />
                    <StatusIcon 
                        name="clock-outline" 
                        active={diagnosisStatus.rtcStatus !== 'ERROR'} 
                        enabled={true} 
                        warning={diagnosisStatus.rtcStatus === 'WARNING'} 
                        isConnected={isConnected}
                    />
                </View>

                {/* DERECHA: MÉTRICAS BÁSICAS */}
                <View style={styles.metricsRow}>
                    {!isClimateSensor && (
                        <View style={styles.metricItem}>
                            <MaterialCommunityIcons name="thermometer" size={20} color={isConnected ? Colors.secondary : '#ccc'} />
                            <Text style={[styles.metricText, !isConnected && { color: '#ccc' }]}>
                                {isConnected ? `${currentSoilTemp.toFixed(1)}°C` : '--'}
                            </Text>
                        </View>
                    )}

                    <View style={styles.metricItem}>
                        <MaterialCommunityIcons 
                            name={!isConnected ? "battery-unknown" : (batteryPercent > 20 ? "battery" : "battery-alert")} 
                            size={20} 
                            color={!isConnected ? '#ccc' : (batteryPercent > 20 ? Colors.success : Colors.error)} 
                        />
                        <Text style={[styles.metricText, { color: !isConnected ? '#ccc' : (batteryPercent > 20 ? Colors.success : Colors.error) }]}>
                            {isConnected ? `${batteryPercent.toFixed(0)}%` : '--'}
                        </Text>
                    </View>
                </View>
            </View>

            {/* 2. INFO BAR */}
            {/* Usamos dbSensor para mostrar info incluso desconectado */}
            <SensorInfoBar
                id={sensorIdStr}
                alias={dbSensor?.alias || "Cargando..."} 
                location={dbSensor?.location || "Ubicación desconocida"}
                onEditPress={() => router.push(`/sensor/${sensorIdStr}/info`)}
                isOffline={!isConnected} // Para mostrar visualmente el estado offline en la barra
            />

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                
                {/* 3. TARJETAS DE DATOS */}
                {isClimateSensor ? (
                    // C01 CLIMA
                    <View style={styles.rowContainer}>
                        <ClimateCard type="temp" value={isConnected ? currentAirTemp : null} /> 
                        <ClimateCard type="hum" value={isConnected ? currentHumidity : null} />
                    </View>
                ) : (
                    // B01 SUELO
                    <View>
                        {MOCK_B01_ELECTRODES_STATIC.map((e) => {
                             const rawMv = sensorData[`moisture${e.num}` as keyof SensorData] as number ?? 0;
                             let displayMv: number | string = rawMv;

                             // Lógica visual
                             if (!isConnected) displayMv = 0; // O puedes manejar null dentro de la Card para mostrar "--"
                             else if (rawMv === 0) displayMv = 0; 
                             else if (rawMv < 200) displayMv = "N/D"; 

                             return (
                                <ElectrodeCard
                                    key={e.num}
                                    number={e.num as 1 | 2 | 3}
                                    depthCm={e.depth}
                                    volumetricMoisture={0}
                                    gravimetricMoisture={0}
                                    voltageMv={displayMv} 
                                    isCalibrated={e.calibrated}
                                    // Deshabilitar calibración si desconectado
                                    onCalibratePress={() => {
                                        if (isConnected) router.push(`/sensor/${sensorIdStr}/calibration?electrode=${e.num}`);
                                    }}
                                    disabled={!isConnected} // Asumiendo que agregamos esta prop a ElectrodeCard
                                />
                             );
                        })}
                    </View>
                )}

                {/* 4. ACCIONES */}
                <View style={{ marginTop: 20 }}>
                    {/* BOTÓN DESCARGAR SD: DESHABILITADO SI OFFLINE */}
                    <TouchableOpacity
                        style={[styles.actionButton, !isConnected && styles.btnDisabled]}
                        disabled={!isConnected}
                        onPress={() => {
                            if (isClimateSensor) router.push(`/sensor/${sensorIdStr}/sd-data-climate`);
                            else router.push(`/sensor/${sensorIdStr}/sd-data`);
                        }}
                    >
                        <View style={[styles.iconCircle, !isConnected && { backgroundColor: "#ccc" }]}>
                            <MaterialCommunityIcons name="download" size={24} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.btnTitle, !isConnected && { color: "#999" }]}>Descargar Tarjeta SD</Text>
                            <Text style={styles.btnSub}>{isConnected ? "Sincronizar nuevas lecturas" : "Requiere conexión Bluetooth"}</Text>
                        </View>
                        {isConnected && <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />}
                    </TouchableOpacity>

                    {/* BOTÓN DATOS LOCALES: SIEMPRE HABILITADO */}
                    <TouchableOpacity
                        style={[styles.actionButton, styles.btnLocal]}
                        onPress={() => router.push(`/sensor/${sensorIdStr}/local-data`)}
                    >
                        <View style={[styles.iconCircle, { backgroundColor: Colors.secondary }]}>
                            <MaterialCommunityIcons name="database-search" size={24} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.btnTitle}>Ver Datos Guardados</Text>
                            <Text style={styles.btnSub}>Consultar historial offline</Text>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" size={24} color="#ccc" />
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
    rowContainer: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
    
    // Panel
    statusPanelContainer: { 
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: '#fff', paddingBottom: 16, paddingHorizontal: 20,
        borderBottomWidth: 1, borderBottomColor: '#e0e0e0', elevation: 4, zIndex: 10,
    },
    modulesRow: { flexDirection: 'row' },
    metricsRow: { flexDirection: 'row', gap: 20 }, 
    metricItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metricText: { fontWeight: 'bold', fontSize: 15, color: Colors.textPrimary },

    // Botones
    actionButton: {
        flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
        padding: 12, borderRadius: 12, marginTop: 10, elevation: 2,
        borderWidth: 1, borderColor: "#eee",
    },
    btnLocal: { marginTop: 10 },
    btnDisabled: { backgroundColor: "#f0f0f0", elevation: 0, borderColor: "#ddd" }, // Estilo visual deshabilitado
    iconCircle: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: Colors.primary,
        justifyContent: "center", alignItems: "center", marginRight: 12,
    },
    btnTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
    btnSub: { fontSize: 12, color: Colors.textSecondary },
});