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

// Variables de entorno (Credenciales ocultas)
const ENV_SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const ENV_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const ENV_INGEST_TOKEN = process.env.EXPO_PUBLIC_INGEST_TOKEN || "";

export default function GatewayConfigScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorId = Array.isArray(id) ? id[0] : id;
    const insets = useSafeAreaInsets();
    
    const { connectedDevice, isBusy } = useBle(); 
    const isConnected = !!connectedDevice;

    const [isReading, setIsReading] = useState(false);
    const [isWriting, setIsWriting] = useState(false);

    // ESTADO VISIBLE PARA EL USUARIO
    const [wifiSsid, setWifiSsid] = useState("");
    const [wifiPass, setWifiPass] = useState("");
    const [uploadInterval, setUploadInterval] = useState("1800"); // Default 30 min
    const [localSaveInterval, setLocalSaveInterval] = useState("300"); // Default 5 min

    // 1. CARGA INICIAL: LEER CONFIGURACIÓN REAL DEL N01
    useEffect(() => {
        const readDeviceConfig = async () => {
            if (!isConnected || !connectedDevice) return;
            setIsReading(true);
            try {
                console.log("Leyendo configuración del Gateway...");
                
                // Función helper para leer strings
                const readStr = async (uuid: string) => {
                    try {
                        const c = await connectedDevice.readCharacteristicForService(BLE_UUIDS.SVC_CONFIG, uuid);
                        return c.value ? Buffer.from(c.value, 'base64').toString('utf8') : "";
                    } catch (e) { return ""; }
                };

                // Leemos en paralelo (o secuencial rápido)
                const rSsid = await readStr(BLE_UUIDS.CONFIG.WIFI_SSID);
                const rUpInt = await readStr(BLE_UUIDS.CONFIG.UPLOAD_INTERVAL);
                const rSaveInt = await readStr(BLE_UUIDS.CONFIG.SAVE_INTERVAL);

                if (rSsid) setWifiSsid(rSsid);
                if (rUpInt) setUploadInterval(rUpInt);
                if (rSaveInt) setLocalSaveInterval(rSaveInt);

            } catch (error) {
                console.log("Error leyendo configuración inicial:", error);
            } finally {
                setIsReading(false);
            }
        };

        readDeviceConfig();
    }, [isConnected]); // Se ejecuta al conectar

    // --- ACCIÓN 1: ACTUALIZAR WIFI ---
    const handleUpdateWifi = async () => {
        if (!wifiSsid || wifiSsid.length < 2) return Alert.alert("Error", "SSID inválido");
        setIsWriting(true);
        try {
            // Enviamos SSID
            await connectedDevice?.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.WIFI_SSID, 
                Buffer.from(wifiSsid).toString("base64")
            );
            await sleep(300);
            
            // Enviamos Password (incluso si está vacío, para borrarla si es necesario)
            await connectedDevice?.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.WIFI_PASS, 
                Buffer.from(wifiPass).toString("base64")
            );
            
            Alert.alert("WiFi Actualizado", "Las nuevas credenciales WiFi se han enviado al Gateway.");
        } catch (e) {
            Alert.alert("Error", "Fallo al actualizar WiFi.");
        } finally {
            setIsWriting(false);
        }
    };

    // --- ACCIÓN 2: SINCRONIZAR SERVIDOR (OCULTO) ---
    const handleSyncServer = async () => {
        setIsWriting(true);
        try {
            const cmds = [
                { uuid: BLE_UUIDS.CONFIG.SUPABASE_URL, val: ENV_SUPA_URL, name: "URL" },
                { uuid: BLE_UUIDS.CONFIG.ANON_KEY, val: ENV_ANON_KEY, name: "API Key" },
                { uuid: BLE_UUIDS.CONFIG.INGEST_TOKEN, val: ENV_INGEST_TOKEN, name: "Token" },
                // Enviamos también el ID limpio para asegurar
                { uuid: BLE_UUIDS.CONFIG.UPLOADER_ID, val: sensorId.replace("SEN-", "").replace("N01-",""), name: "ID" }
            ];

            for (const cmd of cmds) {
                if (!cmd.val) continue;
                console.log(`Enviando ${cmd.name}...`);
                await connectedDevice?.writeCharacteristicWithResponseForService(
                    BLE_UUIDS.SVC_CONFIG, cmd.uuid, 
                    Buffer.from(cmd.val).toString("base64")
                );
                await sleep(400);
            }
            Alert.alert("Sincronización Exitosa", "Credenciales del servidor actualizadas en el Gateway.");
        } catch (e) {
            Alert.alert("Error", "Fallo al enviar credenciales.");
        } finally {
            setIsWriting(false);
        }
    };

    // --- ACCIÓN 3: ACTUALIZAR TIEMPOS ---
    const handleUpdateTimings = async () => {
        setIsWriting(true);
        try {
            await connectedDevice?.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.UPLOAD_INTERVAL, 
                Buffer.from(uploadInterval).toString("base64")
            );
            await sleep(300);
            await connectedDevice?.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.SAVE_INTERVAL, 
                Buffer.from(localSaveInterval).toString("base64")
            );

            // Guardar referencia en DB local para recordar preferencias
            const currentSensor = await getSensorById(sensorId);
            if (currentSensor) {
                const conf = currentSensor.config_json ? JSON.parse(currentSensor.config_json) : {};
                conf.uploadInterval = parseInt(uploadInterval);
                conf.localSaveInterval = parseInt(localSaveInterval);
                await saveSensor({ ...currentSensor, config_json: JSON.stringify(conf) });
            }

            Alert.alert("Tiempos Actualizados", "Nuevos intervalos configurados.");
        } catch (e) {
            Alert.alert("Error", "Fallo al actualizar tiempos.");
        } finally {
            setIsWriting(false);
        }
    };

    // --- UTILIDADES ---
    const handleSyncRTC = async () => {
        try {
            const now = new Date().toISOString().replace('T', ' ').split('.')[0];
            await connectedDevice?.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.RTC_SYNC,
                Buffer.from(now).toString("base64")
            );
            Alert.alert("Reloj", "Hora sincronizada correctamente.");
        } catch (e) { Alert.alert("Error", "Fallo RTC"); }
    };

    const handleDeleteData = async () => {
        Alert.alert("Borrar Datos", "¿Estás seguro de vaciar la memoria del Gateway?", [
            { text: "Cancelar" },
            { text: "BORRAR", style: "destructive", onPress: async () => {
                try {
                    await connectedDevice?.writeCharacteristicWithResponseForService(
                        BLE_UUIDS.SVC_STORAGE, BLE_UUIDS.STORAGE.FILE_DELETE,
                        Buffer.from("ERASE").toString("base64")
                    );
                    Alert.alert("Hecho", "Memoria borrada.");
                } catch(e) { Alert.alert("Error", "Fallo al borrar."); }
            }}
        ]);
    };

    const globalDisabled = isBusy || isWriting || !isConnected;

    if (isReading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={Colors.primary}/>
                <Text style={{marginTop:10, color:'#666'}}>Leyendo configuración del N01...</Text>
            </View>
        );
    }

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
                <Text style={styles.title}>Configurar Gateway</Text>
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                
                {/* 1. SECCIÓN WIFI */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Conexión WiFi</Text>
                    <View style={styles.card}>
                        <InputGroup 
                            label="Nombre de Red (SSID)" icon="wifi"
                            value={wifiSsid} onChange={setWifiSsid} 
                            placeholder="Ej: MiCasa_WiFi" disabled={globalDisabled} autoCapitalize="none"
                        />
                        <InputGroup 
                            label="Contraseña" icon="lock-outline"
                            value={wifiPass} onChange={setWifiPass} 
                            placeholder="Dejar vacío si no cambia" secure disabled={globalDisabled} autoCapitalize="none"
                        />
                        <TouchableOpacity style={[styles.btnAction, globalDisabled && styles.btnDisabled]} onPress={handleUpdateWifi} disabled={globalDisabled}>
                            <Text style={styles.btnActionText}>Actualizar WiFi</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* 2. SECCIÓN SERVIDOR (OCULTO) */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Conexión Servidor</Text>
                    <View style={styles.card}>
                        <View style={{flexDirection:'row', alignItems:'center', marginBottom:10}}>
                            <MaterialCommunityIcons name="shield-check" size={24} color={Colors.success} />
                            <Text style={{marginLeft:10, color:'#555', flex:1}}>
                                Las credenciales (URL, API Key) se cargan automáticamente desde la aplicación.
                            </Text>
                        </View>
                        <TouchableOpacity style={[styles.btnSecondary, globalDisabled && styles.btnDisabled]} onPress={handleSyncServer} disabled={globalDisabled}>
                            <MaterialCommunityIcons name="cloud-sync" size={20} color={Colors.primary} />
                            <Text style={styles.btnSecondaryText}>Sincronizar Credenciales</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* 3. SECCIÓN TIEMPOS */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Intervalos</Text>
                    <View style={styles.card}>
                        <InputGroup 
                            label="Subida a Nube (seg)" icon="upload"
                            value={uploadInterval} onChange={setUploadInterval} 
                            keyboardType="numeric" disabled={globalDisabled}
                        />
                        <InputGroup 
                            label="Guardado Local (seg)" icon="sd"
                            value={localSaveInterval} onChange={setLocalSaveInterval} 
                            keyboardType="numeric" disabled={globalDisabled}
                        />
                        <TouchableOpacity style={[styles.btnAction, globalDisabled && styles.btnDisabled]} onPress={handleUpdateTimings} disabled={globalDisabled}>
                            <Text style={styles.btnActionText}>Actualizar Tiempos</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* 4. HERRAMIENTAS */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Mantenimiento</Text>
                    <View style={styles.card}>
                        <TouchableOpacity style={styles.rowBtn} onPress={handleSyncRTC} disabled={globalDisabled}>
                            <MaterialCommunityIcons name="clock-check-outline" size={20} color={Colors.textPrimary} />
                            <Text style={styles.rowBtnText}>Sincronizar Hora</Text>
                        </TouchableOpacity>
                        <View style={styles.divider}/>
                        <TouchableOpacity style={styles.rowBtn} onPress={handleDeleteData} disabled={globalDisabled}>
                            <MaterialCommunityIcons name="delete-forever" size={20} color={Colors.error} />
                            <Text style={[styles.rowBtnText, {color: Colors.error}]}>Borrar Memoria</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={{height: 40}}/>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// --- Componentes UI ---
const InputGroup = ({ label, value, onChange, icon, secure, keyboardType, disabled, placeholder, autoCapitalize }: any) => (
    <View style={{ marginBottom: 12 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.inputContainer, disabled && styles.inputDisabled]}>
            <MaterialCommunityIcons name={icon} size={20} color="#666" style={{ marginRight: 8 }} />
            <TextInput
                style={[styles.input, disabled && {color: '#999'}]}
                value={value} onChangeText={onChange} secureTextEntry={secure}
                keyboardType={keyboardType || 'default'} editable={!disabled}
                placeholder={placeholder} placeholderTextColor="#ccc"
                autoCapitalize={autoCapitalize} autoCorrect={false}
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

    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textSecondary, marginBottom: 8, textTransform:'uppercase' },
    card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },

    label: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4, fontWeight: '600' },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 12, height: 45 },
    inputDisabled: { backgroundColor: '#f0f0f0', borderColor: '#ddd' },
    input: { flex: 1, fontSize: 16, color: '#333' },

    btnAction: { backgroundColor: Colors.primary, padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
    btnActionText: { color: '#fff', fontWeight: 'bold' },
    
    btnSecondary: { flexDirection:'row', backgroundColor: '#e3f2fd', padding: 12, borderRadius: 8, alignItems: 'center', justifyContent:'center', gap:8 },
    btnSecondaryText: { color: Colors.primary, fontWeight: 'bold' },
    
    btnDisabled: { opacity: 0.5, backgroundColor: '#ccc' },

    rowBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    rowBtnText: { marginLeft: 10, fontSize: 15, fontWeight: '500', color: Colors.textPrimary },
    divider: { height: 1, backgroundColor: '#eee' }
});