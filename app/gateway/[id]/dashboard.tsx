import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Buffer } from "buffer";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import SensorInfoBar from "../../../components/sensor/SensorInfoBar";
import { BLE_UUIDS } from "../../../constants/BleUUIDs";
import { Colors } from "../../../constants/Colors";
import { useBle } from "../../../context/BleContext";
import { getSensorById } from "../../../database/SensorRepository";
import { SensorEntity } from "../../../database/types";

export default function GatewayDashboard() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorIdStr = Array.isArray(id) ? id[0] : id;

    const { connectedDevice, sensorData, diagnosisStatus, isBusy } = useBle();
    const isConnected = !!connectedDevice;
    const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);

    // Cargar datos de DB
    useEffect(() => {
        const load = async () => {
            if (sensorIdStr) {
                const data = await getSensorById(sensorIdStr);
                setDbSensor(data);
            }
        };
        load();
    }, [sensorIdStr]);

    // Estados específicos del Gateway
    const wifiStatus = diagnosisStatus.wifiStatus || 'UNKNOWN';
    const isWifiOnline = wifiStatus === 'ONLINE';
    const batteryPercent = isConnected ? (sensorData.battery ?? 0) : 0;

    // Acción rápida: Forzar Subida
    const handleForceSync = async () => {
        if (!connectedDevice) return;
        try {
            const base64Val = Buffer.from("1").toString("base64");
            await connectedDevice.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG,
                BLE_UUIDS.CONFIG.SEND_NOW,
                base64Val
            );
            Alert.alert("Comando Enviado", "El Gateway intentará subir los datos pendientes ahora.");
        } catch (e) {
            Alert.alert("Error", "No se pudo enviar el comando.");
        }
    };

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* HEADER DE ESTADO */}
            <View style={[styles.headerPanel, { paddingTop: 50 }]}>
                <View style={styles.headerRow}>
                    <View>
                         <Text style={styles.headerTitle}>Gateway N01</Text>
                         <View style={{flexDirection:'row', alignItems:'center', gap: 5}}>
                            <View style={[styles.dot, {backgroundColor: isConnected ? Colors.success : Colors.error}]}/>
                            <Text style={styles.headerSub}>{isConnected ? "Conectado por BLE" : "Desconectado"}</Text>
                         </View>
                    </View>
                    <View style={styles.batteryBadge}>
                         <MaterialCommunityIcons name="battery" size={20} color={isConnected ? Colors.success : '#ccc'} />
                         <Text style={{fontWeight:'bold', color: '#555'}}>{isConnected ? `${batteryPercent}%` : '--'}</Text>
                    </View>
                </View>
            </View>

            {/* BARRA DE INFO (CORREGIDA LA RUTA) */}
            <SensorInfoBar
                id={sensorIdStr}
                alias={dbSensor?.alias || "Cargando..."}
                location={dbSensor?.location || "Sin ubicación"}
                // --- AQUÍ ESTABA EL ERROR, AHORA APUNTA A GATEWAY ---
                onEditPress={() => router.push(`/gateway/${sensorIdStr}/info`)} 
                isOffline={!isConnected}
            />

            <ScrollView style={styles.content} contentContainerStyle={{padding: 16}}>
                
                {/* 1. ESTADO DE RED */}
                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Estado de Conectividad</Text>
                    
                    <View style={styles.statusRow}>
                        <View style={styles.statusIcon}>
                            <MaterialCommunityIcons name="wifi" size={24} color={isWifiOnline ? Colors.success : (wifiStatus === 'LOCAL' ? Colors.warning : Colors.textSecondary)} />
                        </View>
                        <View style={{flex:1}}>
                            <Text style={styles.statusLabel}>Conexión WiFi</Text>
                            <Text style={styles.statusValue}>{wifiStatus}</Text>
                        </View>
                    </View>

                    <View style={[styles.divider]} />

                    <View style={styles.statusRow}>
                        <View style={styles.statusIcon}>
                            <MaterialCommunityIcons name="cloud-upload" size={24} color={diagnosisStatus.syncStatus === 'SENDING' ? Colors.primary : Colors.textSecondary} />
                        </View>
                        <View style={{flex:1}}>
                            <Text style={styles.statusLabel}>Sincronización Nube</Text>
                            <Text style={styles.statusValue}>
                                {diagnosisStatus.syncStatus === 'SENDING' ? 'Subiendo datos...' : (diagnosisStatus.syncStatus || 'IDLE')}
                            </Text>
                            <Text style={styles.lastSync}>Última: {diagnosisStatus.lastSync || 'Nunca'}</Text>
                        </View>
                    </View>
                </View>

                {/* 2. ACCIONES DE CONTROL */}
                <Text style={styles.sectionHeader}>Controles</Text>

                <View style={styles.grid}>
                    {/* Configurar WiFi */}
                    <TouchableOpacity 
                        style={[styles.actionCard, !isConnected && styles.disabledCard]} 
                        disabled={!isConnected}
                        onPress={() => router.push(`/gateway/${sensorIdStr}/config`)}
                    >
                        <View style={[styles.iconCircle, {backgroundColor: '#e8f5e9'}]}>
                            <MaterialCommunityIcons name="wifi-cog" size={28} color="#2e7d32" />
                        </View>
                        <Text style={styles.actionTitle}>Configurar WiFi</Text>
                        <Text style={styles.actionSub}>Credenciales y API</Text>
                    </TouchableOpacity>

                    {/* Enviar Ahora */}
                    <TouchableOpacity 
                        style={[styles.actionCard, !isConnected && styles.disabledCard]} 
                        disabled={!isConnected || isBusy}
                        onPress={handleForceSync}
                    >
                        <View style={[styles.iconCircle, {backgroundColor: '#e3f2fd'}]}>
                            {diagnosisStatus.syncStatus === 'SENDING' ? 
                                <ActivityIndicator color={Colors.primary} /> :
                                <MaterialCommunityIcons name="send" size={28} color={Colors.primary} />
                            }
                        </View>
                        <Text style={styles.actionTitle}>Forzar Subida</Text>
                        <Text style={styles.actionSub}>Enviar datos pendientes</Text>
                    </TouchableOpacity>
                </View>

                {/* 3. SENSORES LOCALES */}
                <Text style={styles.sectionHeader}>Lecturas Locales</Text>
                <View style={styles.sectionCard}>
                      <View style={styles.readingRow}>
                        <Text style={styles.readingLabel}>Temp. Suelo</Text>
                        <Text style={styles.readingValue}>
                            {isConnected && sensorData.soilTemp ? `${sensorData.soilTemp.toFixed(1)}°C` : '--'}
                        </Text>
                      </View>
                      <View style={[styles.divider]} />
                      <View style={styles.readingRow}>
                        <Text style={styles.readingLabel}>Humedad (Ref)</Text>
                        <Text style={styles.readingValue}>
                            {isConnected && sensorData.moisture1 ? `${sensorData.moisture1} mV` : '--'}
                        </Text>
                      </View>
                </View>

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f2f2f2' },
    headerPanel: { backgroundColor: '#fff', paddingBottom: 20, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: '#eee' },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    headerTitle: { fontSize: 24, fontWeight: 'bold', color: Colors.textPrimary },
    headerSub: { fontSize: 14, color: Colors.textSecondary },
    dot: { width: 8, height: 8, borderRadius: 4 },
    batteryBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 6, borderRadius: 12, gap: 4 },
    
    content: { flex: 1 },
    sectionCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 20, elevation: 2 },
    sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 15 },
    sectionHeader: { fontSize: 14, fontWeight: 'bold', color: Colors.textSecondary, marginBottom: 10, marginLeft: 4, textTransform: 'uppercase' },

    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 15 },
    statusIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f9f9f9', justifyContent: 'center', alignItems: 'center' },
    statusLabel: { fontSize: 14, color: Colors.textSecondary },
    statusValue: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
    lastSync: { fontSize: 12, color: '#999', marginTop: 2 },
    divider: { height: 1, backgroundColor: '#eee', marginVertical: 15 },

    grid: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    actionCard: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16, alignItems: 'center', elevation: 2 },
    disabledCard: { opacity: 0.6, backgroundColor: '#f0f0f0' },
    iconCircle: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
    actionTitle: { fontWeight: 'bold', color: Colors.textPrimary, fontSize: 14 },
    actionSub: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },

    readingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    readingLabel: { fontSize: 16, color: Colors.textSecondary },
    readingValue: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
});