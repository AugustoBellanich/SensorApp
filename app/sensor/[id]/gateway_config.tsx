import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Buffer } from "buffer";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import TimeIntervalInput from "../../../components/inputs/TimeIntervalInput";
import { BLE_UUIDS } from "../../../constants/BleUUIDs";
import { Colors } from "../../../constants/Colors";
import { useBle } from "../../../context/BleContext";
import { getSensorById, saveSensor } from "../../../database/SensorRepository";
import { SensorEntity } from "../../../database/types";

// --- UTILIDAD: PAUSA (Sleep) ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- DECLARACIÓN DE VARIABLES DE ENTORNO ---
const ENV_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const ENV_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// --- TIPOS DE ESTADO ---
interface LocalGatewayConfig {
    wifiSsid: string;
    wifiPass: string;
    supabaseUrl: string;
    anonKey: string;
    ingestToken: string;
    uploaderId: string;
    uploadInterval: number;
}
interface LocalGatewayStatus {
    wifiStatus: string;
    syncStatus: string;
    lastSync: string;
    sensorsList: string;
}
interface TimeIntervalInputProps {
    label: string;
    valueSeconds: number;
    onChangeSeconds: (v: number) => void;
    disabled: boolean;
}

export default function GatewayConfigScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorId = Array.isArray(id) ? id[0] : id;
    const insets = useSafeAreaInsets();

    const { connectedDevice, isBusy } = useBle();
    const isConnected = !!connectedDevice;

    const [loading, setLoading] = useState(true);
    const [isReadingStatus, setIsReadingStatus] = useState(false);
    const [isWritingConfig, setIsWritingConfig] = useState(false);
    const [metadata, setMetadata] = useState({ alias: "", location: "" });
    const [config, setConfig] = useState<LocalGatewayConfig>({
        wifiSsid: "",
        wifiPass: "",
        supabaseUrl: "",
        anonKey: "",
        ingestToken: "",
        uploaderId: sensorId || "",
        uploadInterval: 1800,
    });
    const [status, setStatus] = useState<LocalGatewayStatus>({
        wifiStatus: "DESCONECTADO",
        syncStatus: "IDLE",
        lastSync: "N/A",
        sensorsList: "{}",
    });

    // 1. CARGAR DATOS DB AL INICIO
    useEffect(() => {
        const loadData = async () => {
            if (!sensorId) return;
            try {
                const sensor = await getSensorById(sensorId);
                if (sensor) {
                    setMetadata({
                        alias: sensor.alias || sensorId,
                        location: sensor.location || "",
                    });

                    let loadedConfig: Partial<LocalGatewayConfig> = {};
                    if (sensor.config_json) {
                        try {
                            const parsedConfig = JSON.parse(sensor.config_json);
                            loadedConfig = parsedConfig.gateway || {};
                        } catch (_) { /* ignored */ }
                    }

                    // --- LÓGICA DE AUTOCOMPLETADO Y CONFIG. DB ---
                    setConfig((prev) => ({
                        ...prev,
                        ...loadedConfig,
                        uploaderId: sensorId,
                        supabaseUrl: loadedConfig.supabaseUrl || ENV_SUPABASE_URL,
                        anonKey: loadedConfig.anonKey || ENV_SUPABASE_ANON_KEY,
                    }));
                }
            } catch (error) {
                console.error("Error cargando sensor:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [sensorId]);

    // --- 2. GESTIÓN DE NOTIFICACIONES Y ESTADO DE LECTURA BLE ---
    const setupStatusMonitoring = useCallback(async () => {
        if (!connectedDevice || !isConnected) return;

        // Función Helper para leer y decodificar
        const readStatusChar = async (charUUID: string) => {
            // CORRECCIÓN CRÍTICA: Determinar el servicio por el segmento (300 o 400)
            const serviceCode = charUUID.substring(27, 28);
            const serviceUUID = serviceCode === "3" ? BLE_UUIDS.SVC_CONFIG : BLE_UUIDS.SVC_STATUS;

            try {
                const char = await connectedDevice.readCharacteristicForService(
                    serviceUUID,
                    charUUID
                );
                if (char.value) {
                    return Buffer.from(char.value, "base64").toString("utf8").trim();
                }
            } catch (_) { 
                // Ignoramos el error, ya que no queremos que la lectura de un solo campo falle toda la conexión.
                // console.log(`Error leyendo ${charUUID} del servicio ${serviceUUID}`);
            }
            return null;
        };

        // Función Helper para subscribirse
        const subscribeStatusChar = async (
            charUUID: string,
            key: keyof LocalGatewayStatus
        ) => {
            // En N01, las notificaciones siempre usan el servicio STATUS (400)
            await connectedDevice.monitorCharacteristicForService(
                BLE_UUIDS.SVC_STATUS, 
                charUUID,
                (error, char) => {
                    if (error) {
                        console.log(`Monitor error for ${key}:`, error);
                        return;
                    }
                    if (char?.value) {
                        const val = Buffer.from(char.value, "base64").toString("utf8").trim();
                        setStatus((prev) => ({ ...prev, [key]: val }));
                    }
                }
            );
        };

        setIsReadingStatus(true);
        try {
            // Leer estado inicial
            const [wifiS, syncS, lastS, listS] = await Promise.all([
                readStatusChar(BLE_UUIDS.STATUS.WIFI_STATUS), // USANDO UUID CONSOLIDADO
                readStatusChar(BLE_UUIDS.STATUS.SYNC_STATUS), // USANDO UUID CONSOLIDADO
                readStatusChar(BLE_UUIDS.STATUS.LAST_SYNC),   // USANDO UUID CONSOLIDADO
                readStatusChar(BLE_UUIDS.STATUS.SENSORS_LIST), // USANDO UUID CONSOLIDADO
            ]);

            setStatus((prev) => ({
                wifiStatus: wifiS || prev.wifiStatus,
                syncStatus: syncS || prev.syncStatus,
                lastSync: lastS || prev.lastSync,
                sensorsList: listS || prev.sensorsList,
            }));

            // Leer configuración guardada en el dispositivo (UPLOAD_INTERVAL)
            const intervalVal = await readStatusChar(
                BLE_UUIDS.CONFIG.UPLOAD_INTERVAL // USANDO UUID CONSOLIDADO
            );
            if (intervalVal) {
                setConfig((prev) => ({
                    ...prev,
                    uploadInterval: parseInt(intervalVal) || 1800,
                }));
            }

            // Subscribirse a los cambios (Notificaciones)
            await subscribeStatusChar(BLE_UUIDS.STATUS.WIFI_STATUS, "wifiStatus");
            await subscribeStatusChar(BLE_UUIDS.STATUS.SYNC_STATUS, "syncStatus");
        } catch (error) {
            console.error("Error setting up gateway monitoring:", error);
        } finally {
            setIsReadingStatus(false);
        }
    }, [isConnected, connectedDevice]);

    useEffect(() => {
        setupStatusMonitoring();
        return () => {
            // La desconexión del dispositivo se encarga de detener la monitorización.
        };
    }, [setupStatusMonitoring]);

    // --- 3. ESCRITURA DE CONFIGURACIÓN (SAVE) ---
    const writeConfigToSensor = async (configData: LocalGatewayConfig) => {
        if (!connectedDevice) return;
        setIsWritingConfig(true);
        Alert.alert(
            "Enviando Configuración",
            "Se enviarán las credenciales. Esto puede tardar unos segundos y reiniciar el WiFi del Gateway."
        );

        try {
            const commands = [
                // USANDO UUIDS CONSOLIDADOS
                { uuid: BLE_UUIDS.CONFIG.WIFI_SSID, val: configData.wifiSsid, desc: "WiFi SSID" },
                { uuid: BLE_UUIDS.CONFIG.WIFI_PASS, val: configData.wifiPass, desc: "WiFi Password" },
                { uuid: BLE_UUIDS.CONFIG.UPLOADER_ID, val: configData.uploaderId.replace("SEN-", ""), desc: "Uploader ID" },
                { uuid: BLE_UUIDS.CONFIG.SUPABASE_URL, val: configData.supabaseUrl, desc: "Supabase URL" },
                { uuid: BLE_UUIDS.CONFIG.ANON_KEY, val: configData.anonKey, desc: "Anon Key" },
                { uuid: BLE_UUIDS.CONFIG.INGEST_TOKEN, val: configData.ingestToken, desc: "Ingest Token" },
                { uuid: BLE_UUIDS.CONFIG.UPLOAD_INTERVAL, val: configData.uploadInterval.toString(), desc: "Upload Interval" },
            ];

            // Escribir comandos secuencialmente con PAUSA
            for (const cmd of commands) {
                console.log(
                    `[BLE-WRITE] Enviando ${cmd.desc}: ${cmd.val.length} chars`
                );
                const base64Val = Buffer.from(cmd.val).toString("base64");

                await connectedDevice.writeCharacteristicWithResponseForService(
                    BLE_UUIDS.SVC_CONFIG, // Servicio de Configuración (300)
                    cmd.uuid,
                    base64Val
                );
                await sleep(500); // Pausa crítica de 500ms
            }

            Alert.alert(
                "Éxito",
                "Configuración enviada al Gateway. Monitoreando estado de red."
            );
        } catch (error) {
            Alert.alert(
                "Error de Escritura",
                "Fallo al enviar la configuración BLE. Revise la conexión."
            );
            console.error(error);
        } finally {
            setIsWritingConfig(false);
        }
    };

    // --- 4. GUARDAR GENERAL (DB + BLE) ---
    const handleSave = async () => {
        if (!sensorId) return;

        // 1. Guardar Metadata local (DB)
        const sensor = await getSensorById(sensorId);
        if (sensor) {
            const now = new Date().toISOString();
            let configJson: any = {};
            if (sensor.config_json) configJson = JSON.parse(sensor.config_json);

            const updatedSensor: SensorEntity = {
                ...sensor,
                alias: metadata.alias,
                location: metadata.location,
                config_json: JSON.stringify({
                    ...configJson,
                    gateway: config,
                }),
                is_synced: 0, 
                updated_at: now,
            };
            await saveSensor(updatedSensor);
        }

        // 2. Si está conectado, enviamos por BLE
        if (isConnected) {
            Alert.alert(
                "Sincronizar Gateway",
                "¿Desea enviar la configuración de red y servidor al dispositivo?",
                [
                    {
                        text: "No, solo guardar local",
                        style: "cancel",
                        onPress: () => router.back(),
                    },
                    {
                        text: "Enviar por Bluetooth",
                        onPress: () => writeConfigToSensor(config),
                    },
                ]
            );
        } else {
            Alert.alert(
                "Guardado Local",
                "Información actualizada en la base de datos local. Conéctese al Gateway para enviarla."
            );
            router.back();
        }
    };

    // --- 5. ACCIONES MANUALES ---
    const handleSendNow = async () => {
        if (!isConnected || isBusy) return;
        try {
            const base64Val = Buffer.from("1").toString("base64");
            await connectedDevice!.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG,
                BLE_UUIDS.CONFIG.SEND_NOW, // USANDO UUID CONSOLIDADO
                base64Val
            );
            Alert.alert("Enviado", "Se ha forzado la subida de datos pendientes.");
        } catch (_) {
            Alert.alert("Error", "Fallo al forzar la subida.");
        }
    };

    if (loading) {
        return (
            <ActivityIndicator
                size="large"
                style={{ flex: 1, justifyContent: "center" }}
                color={Colors.primary}
            />
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* HEADER */}
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    disabled={isWritingConfig}
                >
                    <MaterialCommunityIcons
                        name="arrow-left"
                        size={24}
                        color={Colors.textPrimary}
                    />
                </TouchableOpacity>
                <Text style={styles.screenTitle}>{metadata.alias}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* --- 1. ESTADO ACTUAL (LECTURA) --- */}
                <StatusGroup
                    title="Estado del Gateway"
                    isConnected={isConnected}
                    isReading={isReadingStatus || isBusy}
                >
                    <StatusRow
                        icon="access-point"
                        label="WiFi Status"
                        value={status.wifiStatus}
                    />
                    <StatusRow
                        icon="server"
                        label="Sync Status"
                        value={status.syncStatus}
                    />
                    <StatusRow
                        icon="clock-outline"
                        label="Última Sincronización"
                        value={
                            status.lastSync.substring(11, 16) +
                            "h (" +
                            status.lastSync.substring(0, 10) +
                            ")"
                        }
                    />

                    <View style={styles.actionSection}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handleSendNow}
                            disabled={!isConnected || isWritingConfig}
                        >
                            <MaterialCommunityIcons
                                name="cloud-upload"
                                size={18}
                                color="#fff"
                            />
                            <Text style={styles.actionButtonText}>
                                Forzar Subida Ahora
                            </Text>
                        </TouchableOpacity>
                        <TimeIntervalInput
                            {...({
                                label: "Intervalo de Subida Automática",
                                valueSeconds: config.uploadInterval,
                                onChangeSeconds: (v: number) =>
                                    setConfig({ ...config, uploadInterval: v }),
                                disabled: !isConnected,
                            } as TimeIntervalInputProps)}
                        />
                    </View>
                </StatusGroup>

                {/* --- 2. CONFIGURACIÓN METADATA (DB) --- */}
                <ConfigGroup title="Metadatos Locales">
                    <InputLabel label="Alias del Gateway" />
                    <TextInput
                        style={styles.input}
                        value={metadata.alias}
                        onChangeText={(t) => setMetadata({ ...metadata, alias: t })}
                    />
                    <InputLabel label="Ubicación / Finca" />
                    <TextInput
                        style={styles.input}
                        value={metadata.location}
                        onChangeText={(t) => setMetadata({ ...metadata, location: t })}
                    />
                </ConfigGroup>

                {/* --- 3. CONFIGURACIÓN WIFI --- */}
                <ConfigGroup title="Credenciales de Red (WiFi)" disabled={!isConnected}>
                    <InputLabel label="WiFi SSID" />
                    <TextInput
                        style={styles.input}
                        value={config.wifiSsid}
                        onChangeText={(t) => setConfig({ ...config, wifiSsid: t })}
                        placeholder="Nombre de la red Wi-Fi"
                        editable={isConnected && !isWritingConfig}
                    />
                    <InputLabel label="Contraseña WiFi" />
                    <TextInput
                        style={styles.input}
                        value={config.wifiPass}
                        onChangeText={(t) => setConfig({ ...config, wifiPass: t })}
                        secureTextEntry
                        placeholder="Dejar vacío si no se desea cambiar"
                        editable={isConnected && !isWritingConfig}
                    />
                </ConfigGroup>

                {/* --- 4. CONFIGURACIÓN SERVIDOR SUPABASE --- */}
                <ConfigGroup
                    title="Configuración de Servidor (Supabase)"
                    disabled={!isConnected}
                >
                    <InputLabel label="Edge Function URL (Endpoint Ingest)" />
                    <TextInput
                        style={styles.input}
                        value={config.supabaseUrl}
                        onChangeText={(t) => setConfig({ ...config, supabaseUrl: t })}
                        placeholder="https://[project].supabase.co/functions/v1/ingest"
                        editable={isConnected && !isWritingConfig}
                    />
                    <InputLabel label="Anon Key (Clave Pública)" />
                    <TextInput
                        style={styles.input}
                        value={config.anonKey}
                        onChangeText={(t) => setConfig({ ...config, anonKey: t })}
                        secureTextEntry
                        placeholder="JWT Largo de la clave pública"
                        editable={isConnected && !isWritingConfig}
                    />
                    <InputLabel label="Ingest Token (Header opcional)" />
                    <TextInput
                        style={styles.input}
                        value={config.ingestToken}
                        onChangeText={(t) => setConfig({ ...config, ingestToken: t })}
                        placeholder="Token de seguridad (opcional)"
                        editable={isConnected && !isWritingConfig}
                    />
                </ConfigGroup>

                {/* --- 5. SENSORES DETECTADOS (Lectura) --- */}
                <ConfigGroup title="Sensores LoRa Detectados">
                    <Text style={styles.jsonText}>
                        {(() => {
                            try {
                                const list = JSON.parse(status.sensorsList || '{}');
                                return JSON.stringify(list, null, 2);
                            } catch {
                                return "No se pudo leer la lista o está vacía.";
                            }
                        })()}
                    </Text>
                </ConfigGroup>
            </ScrollView>

            {/* FOOTER */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
                <TouchableOpacity
                    style={[
                        styles.saveButton,
                        (isWritingConfig || isBusy) && { backgroundColor: "#ccc" },
                    ]}
                    onPress={handleSave}
                    disabled={isWritingConfig || isBusy}
                >
                    {isWritingConfig ? (
                        <View style={{ flexDirection: "row", gap: 10 }}>
                            <ActivityIndicator color="#fff" />
                            <Text style={styles.saveButtonText}>
                                ENVIANDO A GATEWAY...
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.saveButtonText}>GUARDAR Y SINCRONIZAR</Text>
                    )}
                </TouchableOpacity>
            </View>

            {/* OVERLAY DE ESCRITURA (Bloqueo Total) */}
            {isWritingConfig && (
                <View style={styles.writingOverlay}>
                    <ActivityIndicator size="large" color="#fff" />
                    <Text
                        style={{
                            color: "#fff",
                            marginTop: 15,
                            fontWeight: "bold",
                            fontSize: 16,
                        }}
                    >
                        Enviando configuración al Gateway...
                    </Text>
                    <Text style={{ color: "#ddd", fontSize: 12, marginTop: 5 }}>
                        Por favor no cierre la aplicación
                    </Text>
                </View>
            )}
        </View>
    );
}

// --- SUBCOMPONENTES (Omitidos por ser solo estilos/presentación) ---

const ConfigGroup = ({
    title,
    children,
    disabled = false,
}: {
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
}) => (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={styles.cardDivider} />
        {children}
        {disabled && (
            <View style={styles.overlayDisabled}>
                <MaterialCommunityIcons name="bluetooth-off" size={32} color="#aaa" />
                <Text style={styles.overlayText}>
                    Conéctese por BLE para configurar el hardware.
                </Text>
            </View>
        )}
    </View>
);

const StatusGroup = ({ title, children, isConnected, isReading }: any) => (
    <View style={styles.card}>
        <View
            style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
            }}
        >
            <Text style={styles.cardTitle}>{title}</Text>
            {isReading ? (
                <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialCommunityIcons
                        name={isConnected ? "bluetooth-connect" : "bluetooth-off"}
                        size={16}
                        color={isConnected ? Colors.success : Colors.error}
                    />
                    <Text
                        style={{
                            fontSize: 12,
                            color: isConnected ? Colors.success : Colors.error,
                            marginLeft: 5,
                            fontWeight: "bold",
                        }}
                    >
                        {isConnected ? "CONECTADO" : "DESCONECTADO"}
                    </Text>
                </View>
            )}
        </View>
        <View style={styles.cardDivider} />
        {children}
    </View>
);

const StatusRow = ({
    icon,
    label,
    value,
}: {
    icon: string;
    label: string;
    value: string;
}) => {
    const displayValue = value === "LOCAL_ONLY" ? "Red Local" : value;

    let color = Colors.textSecondary;
    if (value.includes("ONLINE")) color = Colors.success;
    if (value.includes("ERROR") || value.includes("DISCONNECTED"))
        color = Colors.error;

    return (
        <View style={styles.statusRow}>
            <MaterialCommunityIcons
                name={icon as any}
                size={18}
                color={color}
                style={{ marginRight: 8 }}
            />
            <Text style={styles.statusLabel}>{label}:</Text>
            <Text style={[styles.statusValue, { color }]}>{displayValue}</Text>
        </View>
    );
};

const InputLabel = ({ label }: { label: string }) => (
    <Text
        style={{
            fontSize: 14,
            fontWeight: "bold",
            color: Colors.textPrimary,
            marginBottom: 4,
            marginTop: 10,
        }}
    >
        {label}
    </Text>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f2f2f2" },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 120 },

    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: "#fff",
        borderBottomWidth: 1,
        borderColor: "#eee",
    },
    backButton: { padding: 8 },
    screenTitle: { fontSize: 20, fontWeight: "bold", color: Colors.textPrimary },

    card: {
        backgroundColor: "#fff",
        borderRadius: 10,
        padding: 15,
        marginBottom: 15,
        elevation: 1,
        position: "relative",
    },
    cardDisabled: { backgroundColor: "#f5f5f5", opacity: 0.8 },
    cardTitle: { fontSize: 16, fontWeight: "bold", color: Colors.textSecondary },
    cardDivider: { height: 1, backgroundColor: "#eee", marginVertical: 10 },

    input: {
        backgroundColor: "#fff",
        borderWidth: 1,
        borderColor: "#ccc",
        borderRadius: 6,
        padding: 10,
        fontSize: 16,
        color: "#000",
    },

    statusRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
    statusLabel: { fontSize: 14, color: Colors.textSecondary, fontWeight: "600" },
    statusValue: { fontSize: 14, fontWeight: "bold", marginLeft: 4, flex: 1 },

    actionSection: {
        marginTop: 15,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: "#eee",
    },
    actionButton: {
        backgroundColor: Colors.secondary,
        padding: 12,
        borderRadius: 6,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
        marginBottom: 15,
    },
    actionButtonText: { color: "#fff", fontWeight: "bold", marginLeft: 8 },

    jsonText: {
        fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
        fontSize: 12,
        color: "#444",
        backgroundColor: "#fafafa",
        padding: 10,
        borderRadius: 6,
    },

    footer: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: "#fff",
        paddingTop: 16,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: "#ddd",
        elevation: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
    },
    saveButton: {
        backgroundColor: Colors.primary,
        padding: 15,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    saveButtonText: {
        color: "#fff",
        fontWeight: "bold",
        fontSize: 16,
        letterSpacing: 1,
    },

    overlayDisabled: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(255,255,255,0.85)",
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
    },
    overlayText: {
        marginTop: 10,
        color: "#888",
        textAlign: "center",
        fontWeight: "bold",
    },

    writingOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.7)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 999,
    },
});