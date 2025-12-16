import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Buffer } from "buffer";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// --- IMPORTS PROPIOS ---
import { BLE_UUIDS } from "../../../constants/BleUUIDs";
import { Colors } from "../../../constants/Colors";
import { useBle } from "../../../context/BleContext";
import { getSensorById, saveSensor } from "../../../database/SensorRepository";

// Utilidad Sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Variables de entorno (Defaults)
const DEFAULT_SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const DEFAULT_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const DEFAULT_INGEST_TOKEN = process.env.EXPO_PUBLIC_INGEST_TOKEN || "";

// Interface solo para Hardware
interface HardwareConfig {
    wifiSsid: string;
    wifiPass: string;
    uploaderId: string;
    supabaseUrl: string;
    anonKey: string;
    ingestToken: string; // <-- AGREGADO
    uploadInterval: string;
}

export default function GatewayConfigScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorId = Array.isArray(id) ? id[0] : id;
    const insets = useSafeAreaInsets();
    
    const { connectedDevice, isBusy } = useBle(); 
    const isConnected = !!connectedDevice;

    const [loading, setLoading] = useState(true);
    const [isWritingBle, setIsWritingBle] = useState(false);
    const [isDeletingData, setIsDeletingData] = useState(false); // <-- NUEVO ESTADO

    // ESTADO: HARDWARE
    const [hwConfig, setHwConfig] = useState<HardwareConfig>({
        wifiSsid: "",
        wifiPass: "",
        uploaderId: sensorId || "",
        supabaseUrl: DEFAULT_SUPA_URL,
        anonKey: DEFAULT_ANON_KEY,
        ingestToken: DEFAULT_INGEST_TOKEN, // <-- VALOR INICIAL
        uploadInterval: "1800",
    });

    // CARGA INICIAL (Recuperamos configuración técnica guardada si existe)
    useEffect(() => {
        const load = async () => {
            if (!sensorId) return;
            const sensor = await getSensorById(sensorId);
            if (sensor && sensor.config_json) {
                try {
                    const json = JSON.parse(sensor.config_json);
                    // Solo recuperamos el intervalo ya que las credenciales no se guardan en DB por seguridad
                    if (json.uploadInterval) {
                         setHwConfig(prev => ({...prev, uploadInterval: String(json.uploadInterval)}));
                    }
                } catch {}
            }
            setLoading(false);
        };
        load();
    }, [sensorId]);

    // ENVIAR CONFIGURACIÓN AL HARDWARE (BLE)
    const handleConfigureHardware = async () => {
        if (!isConnected || !connectedDevice) {
            Alert.alert("No conectado", "Conéctese al Gateway vía Bluetooth para configurar el WiFi.");
            return;
        }
        setIsWritingBle(true);

        try {
            if (hwConfig.wifiSsid.length < 2) throw new Error("Ingrese un SSID WiFi válido.");
            
            // 1. Enviar comandos por Bluetooth (Incluyendo el Ingest Token)
            const cmds = [
                { uuid: BLE_UUIDS.CONFIG.WIFI_SSID, val: hwConfig.wifiSsid, name: "SSID" },
                { uuid: BLE_UUIDS.CONFIG.WIFI_PASS, val: hwConfig.wifiPass, name: "Password" }, 
                { uuid: BLE_UUIDS.CONFIG.SUPABASE_URL, val: hwConfig.supabaseUrl, name: "URL" },
                { uuid: BLE_UUIDS.CONFIG.ANON_KEY, val: hwConfig.anonKey, name: "Key" },
                { uuid: BLE_UUIDS.CONFIG.INGEST_TOKEN, val: hwConfig.ingestToken, name: "Token Ingesta" }, // <-- AGREGADO
                { uuid: BLE_UUIDS.CONFIG.UPLOAD_INTERVAL, val: hwConfig.uploadInterval, name: "Interval" },
                { uuid: BLE_UUIDS.CONFIG.UPLOADER_ID, val: hwConfig.uploaderId.replace("SEN-", "").replace("N01-",""), name: "ID" }
            ];

            for (const cmd of cmds) {
                if (!cmd.val) continue; 
                console.log(`Enviando ${cmd.name}...`);
                const b64 = Buffer.from(cmd.val).toString("base64");
                await connectedDevice.writeCharacteristicWithResponseForService(
                    BLE_UUIDS.SVC_CONFIG,
                    cmd.uuid,
                    b64
                );
                await sleep(400); 
            }
            
            // 2. Actualizar DB Local (Solo para recordar el intervalo en la UI)
            if (sensorId) {
                const currentSensor = await getSensorById(sensorId);
                if (currentSensor) {
                    const currentConfig = currentSensor.config_json ? JSON.parse(currentSensor.config_json) : {};
                    currentConfig.uploadInterval = parseInt(hwConfig.uploadInterval);
                    
                    await saveSensor({
                        ...currentSensor,
                        config_json: JSON.stringify(currentConfig)
                    });
                }
            }

            Alert.alert("Configurado", "Credenciales enviadas al Gateway. El dispositivo intentará conectarse ahora.");
            router.back(); 

        } catch (e: any) {
            Alert.alert("Error BLE", e.message || "Fallo al escribir configuración.");
        } finally {
            setIsWritingBle(false);
        }
    };
    
    // SINCRONIZACIÓN DE RELOJ (RTC)
    const handleSyncRTC = async () => {
        if (!isConnected || !connectedDevice) return;
        setIsWritingBle(true);
        try {
            const now = new Date();
            // Formato ISO: YYYY-MM-DD hh:mm:ss
            const timeString = now.toISOString().replace('T', ' ').split('.')[0]; 
            const base64Time = Buffer.from(timeString).toString('base64');
            
            console.log(`Sincronizando RTC: ${timeString}`);
            await connectedDevice.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG,
                BLE_UUIDS.CONFIG.RTC_SYNC,
                base64Time
            );
            Alert.alert("Éxito", `Reloj sincronizado: ${timeString}`);
        } catch (error) {
            Alert.alert("Error RTC", "Fallo al sincronizar reloj. Verifique la conexión.");
        } finally {
            setIsWritingBle(false);
        }
    };


    // FUNCIÓN DE BORRADO DE DATOS (NUEVA)
    const handleDeleteData = async () => {
        if (!isConnected || !connectedDevice) return;

        Alert.alert(
            "¡Advertencia!",
            "Esto borrará PERMANENTEMENTE todos los datos de medición almacenados en el Gateway. ¿Continuar?",
            [
                { text: "Cancelar", style: "cancel" },
                { 
                    text: "BORRAR DATOS", 
                    style: "destructive",
                    onPress: async () => {
                        setIsDeletingData(true);
                        try {
                            // Característica: Borrar Datos (UUID 203 dentro del SVC 200)
                            const commandValue = Buffer.from("ERASE").toString("base64");
                            
                            console.log("Enviando comando de borrado...");
                            await connectedDevice.writeCharacteristicWithResponseForService(
                                BLE_UUIDS.SVC_STORAGE, // SVC 200
                                BLE_UUIDS.STORAGE.FILE_DELETE, // CHAR 203
                                commandValue
                            );
                            
                            Alert.alert("Borrado Exitoso", "El Gateway ha eliminado todos los registros locales.");
                            
                        } catch (e) {
                            Alert.alert("Error", "No se pudo enviar el comando de borrado. Intente nuevamente.");
                            console.error(e);
                        } finally {
                            setIsDeletingData(false);
                        }
                    }
                },
            ]
        );
    };


    if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary}/></View>;

    const globalDisabled = isBusy || isWritingBle || isDeletingData;

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : "height"} 
            style={[styles.container, { paddingTop: insets.top }]}
        >
            <Stack.Screen options={{ headerShown: false }} />
            
            <View style={styles.header}>
                <TouchableOpacity onPress={router.back} style={styles.backBtn} disabled={globalDisabled}>
                    <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.title}>Configurar Hardware</Text>
                <View style={{width: 24}}/>
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                
                {/* CABECERA DE ESTADO */}
                <View style={styles.statusSection}>
                    <View style={styles.rowCenter}>
                        <MaterialCommunityIcons 
                            name={isConnected ? "bluetooth-connect" : "bluetooth-off"} 
                            size={24} 
                            color={isConnected ? Colors.success : Colors.textSecondary} 
                        />
                        <Text style={[styles.statusText, {color: isConnected ? Colors.success : Colors.textSecondary}]}>
                            {isConnected ? "Gateway Conectado" : "Desconectado (Solo lectura)"}
                        </Text>
                    </View>
                    <Text style={styles.sectionSub}>
                        Estos parámetros se envían directamente al chip del Gateway para permitirle conectarse a Internet.
                    </Text>
                </View>

                {/* SECCIÓN HARDWARE */}
                <View style={styles.section}>
                    <View style={styles.card}>
                        <View style={styles.cardTitleRow}>
                            <MaterialCommunityIcons name="wifi" size={20} color={Colors.primary} />
                            <Text style={styles.cardHeader}>Conexión WiFi Local</Text>
                        </View>
                        <InputGroup label="SSID (Nombre Red)" value={hwConfig.wifiSsid} onChange={(t)=>setHwConfig({...hwConfig, wifiSsid:t})} placeholder="Ej: MiCasa_WiFi" disabled={!isConnected} />
                        <InputGroup label="Contraseña" value={hwConfig.wifiPass} onChange={(t)=>setHwConfig({...hwConfig, wifiPass:t})} icon="lock-outline" secure disabled={!isConnected} />
                    </View>

                    <View style={styles.card}>
                        <View style={styles.cardTitleRow}>
                            <MaterialCommunityIcons name="cloud-cog" size={20} color={Colors.primary} />
                            <Text style={styles.cardHeader}>Configuración Nube (Avanzado)</Text>
                        </View>
                         <InputGroup label="Intervalo Subida (segundos)" value={hwConfig.uploadInterval} onChange={(t)=>setHwConfig({...hwConfig, uploadInterval:t})} keyboardType="numeric" disabled={!isConnected} />
                         <InputGroup label="URL Proyecto" value={hwConfig.supabaseUrl} onChange={(t)=>setHwConfig({...hwConfig, supabaseUrl:t})} disabled={!isConnected} />
                         <InputGroup label="Anon Key" value={hwConfig.anonKey} onChange={(t)=>setHwConfig({...hwConfig, anonKey:t})} secure disabled={!isConnected} />
                         <InputGroup label="Ingest Token (Clave)" value={hwConfig.ingestToken} onChange={(t)=>setHwConfig({...hwConfig, ingestToken:t})} secure disabled={!isConnected} /> {/* <-- AGREGADO */}
                    </View>

                    <TouchableOpacity 
                        style={[styles.btnPrimary, (!isConnected || isWritingBle) && styles.btnDisabled]} 
                        onPress={handleConfigureHardware}
                        disabled={globalDisabled || !isConnected}
                    >
                        {isWritingBle ? <ActivityIndicator color="#fff"/> : <MaterialCommunityIcons name="upload-network" size={24} color="#fff" />}
                        <Text style={styles.btnText}>
                            {isWritingBle ? "ENVIANDO..." : "ENVIAR CONFIGURACIÓN"}
                        </Text>
                    </TouchableOpacity>
                    
                    {!isConnected && (
                        <Text style={styles.warningText}>
                            Debes conectarte al Gateway vía Bluetooth desde el inicio para poder modificar estos valores.
                        </Text>
                    )}
                </View>
                
                {/* SECCIÓN DE UTILIDADES */}
                <View style={[styles.section, {marginTop: 10}]}>
                    <View style={styles.card}>
                        <View style={styles.cardTitleRow}>
                            <MaterialCommunityIcons name="toolbox-outline" size={20} color={Colors.secondary} />
                            <Text style={styles.cardHeader}>Herramientas de Mantenimiento</Text>
                        </View>
                        
                        {/* Sincronizar RTC */}
                        <TouchableOpacity 
                            style={[styles.utilButton, globalDisabled && styles.utilButtonDisabled, {backgroundColor: Colors.secondary}]} 
                            onPress={handleSyncRTC}
                            disabled={globalDisabled || !isConnected}
                        >
                             <MaterialCommunityIcons name="clock-check-outline" size={20} color="#fff" />
                             <Text style={styles.utilButtonText}>Sincronizar Reloj (RTC)</Text>
                        </TouchableOpacity>

                        <View style={{height: 1, backgroundColor: '#eee', marginVertical: 15}} />

                        {/* Borrar Datos */}
                        <TouchableOpacity 
                            style={[styles.utilButton, globalDisabled && styles.utilButtonDisabled, {backgroundColor: Colors.error}]} 
                            onPress={handleDeleteData}
                            disabled={globalDisabled || !isConnected}
                        >
                            {isDeletingData ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <MaterialCommunityIcons name="delete-empty-outline" size={20} color="#fff" />
                            )}
                            <Text style={styles.utilButtonText}>BORRAR DATOS LOCALES (FLASH)</Text>
                        </TouchableOpacity>

                    </View>
                </View>


                <View style={{height: 40}}/>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// --- Componentes UI Auxiliares ---

interface InputGroupProps {
    label: string;
    value: string;
    onChange: (text: string) => void; 
    icon?: keyof typeof MaterialCommunityIcons.glyphMap;
    secure?: boolean;
    keyboardType?: 'default' | 'numeric' | 'email-address';
    disabled?: boolean;
    placeholder?: string;
}

const InputGroup = ({ label, value, onChange, icon, secure, keyboardType, disabled, placeholder }: InputGroupProps) => (
    <View style={{ marginBottom: 16 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.inputContainer, disabled && styles.inputDisabled]}>
            {icon && <MaterialCommunityIcons name={icon} size={20} color="#666" style={{ marginRight: 8 }} />}
            <TextInput
                style={[styles.input, disabled && {color: '#999'}]}
                value={value}
                onChangeText={onChange}
                secureTextEntry={secure}
                keyboardType={keyboardType || 'default'}
                editable={!disabled}
                placeholder={disabled ? "Requiere conexión..." : placeholder}
                placeholderTextColor="#ccc"
            />
        </View>
    </View>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f2f2f2' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
    backBtn: { padding: 4 },
    title: { fontSize: 18, fontWeight: 'bold', marginLeft: 16, color: Colors.textPrimary },
    scroll: { padding: 16 },
    
    statusSection: { marginBottom: 20, paddingHorizontal: 4 },
    rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
    statusText: { fontSize: 16, fontWeight: 'bold' },
    sectionSub: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },

    section: { marginBottom: 24 },
    
    card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, elevation: 1 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8 },
    cardHeader: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },

    label: { fontSize: 12, color: Colors.textSecondary, marginBottom: 6, fontWeight: '600' },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 12, height: 48 },
    inputDisabled: { backgroundColor: '#f0f0f0', borderColor: '#ddd' },
    input: { flex: 1, fontSize: 16, color: '#333' },

    btnPrimary: { flexDirection: 'row', backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, elevation: 2 },
    btnDisabled: { opacity: 0.5, backgroundColor: '#999', elevation: 0 },
    btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 0.5 },

    // Botones de Utilidad (RTC, Borrar)
    utilButton: {
        flexDirection: 'row', padding: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 10,
    },
    utilButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
    utilButtonDisabled: { opacity: 0.6 },
    
    warningText: { marginTop: 15, textAlign: 'center', color: Colors.warning, fontSize: 12, fontStyle: 'italic' }
});