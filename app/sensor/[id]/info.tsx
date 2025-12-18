import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Buffer } from 'buffer';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- COMPONENTES PROPIOS ---
import SegmentedControl from '../../../components/global/SegmentedControl';
import TimeIntervalInput from '../../../components/inputs/TimeIntervalInput';
import { Colors } from '../../../constants/Colors';

// --- CONTEXT & DB ---
import { BLE_UUIDS } from '../../../constants/BleUUIDs';
import { useBle } from '../../../context/BleContext';
import { getSensorById, saveSensor } from '../../../database/SensorRepository';
import { SensorEntity } from '../../../database/types';
import { syncService } from '../../../services/syncService';

// --- UTILIDAD: PAUSA ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function SensorInfoScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorId = Array.isArray(id) ? id[0] : id;
    const insets = useSafeAreaInsets();
    const isMounted = useRef(true);

    // Contexto BLE
    const { connectedDevice } = useBle();
    const isConnected = !!connectedDevice;

    const [activeTab, setActiveTab] = useState(0); // 0: Info, 1: Config
    const [loading, setLoading] = useState(true);
    
    // Estados de operación
    const [isReadingConfig, setIsReadingConfig] = useState(false);
    const [isWritingConfig, setIsWritingConfig] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // --- ESTADO DE DATOS (Metadata DB) ---
    const [metadata, setMetadata] = useState({
        alias: '',
        location: '',
        activity: '',
        lat: '',
        lng: '',
    });

    // --- ESTADO DE CONFIGURACIÓN (Hardware) ---
    const [config, setConfig] = useState({
        sdEnabled: true,       
        saveInterval: 3600,    
        loraEnabled: true,     
        loraInterval: 14400,   
        loraOffset: 15,        
        lowPower: true,        
        wakeInterval: 7200,    
        bleWindow: 300,        
    });

    const [originalSensor, setOriginalSensor] = useState<SensorEntity | null>(null);

    // 1. CARGAR DATOS DE DB AL INICIO
    useEffect(() => {
        const loadData = async () => {
            if (!sensorId) return;
            try {
                const sensor = await getSensorById(sensorId);
                if (sensor) {
                    setOriginalSensor(sensor);
                    setMetadata({
                        alias: sensor.alias || '',
                        location: sensor.location || '',
                        activity: sensor.activity || '',
                        lat: sensor.lat ? sensor.lat.toString() : '',
                        lng: sensor.lng ? sensor.lng.toString() : '',
                    });

                    if (sensor.config_json) {
                        try {
                            const parsedConfig = JSON.parse(sensor.config_json);
                            // Fusionamos con defaults para evitar campos faltantes
                            setConfig(prev => ({ ...prev, ...parsedConfig }));
                        } catch (e) {
                            console.log("Error parseando config JSON local");
                        }
                    }
                }
            } catch (error) {
                console.error("Error cargando sensor:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [sensorId]);

    useEffect(() => {
        // Al montar: marcar como true
        isMounted.current = true;
        
        // Al desmontar: marcar como false
        return () => { isMounted.current = false; };
    }, []);

    // 2. LEER CONFIGURACIÓN REAL DEL SENSOR (Al cambiar a Tab 1)
    useEffect(() => {
        const readSensorConfig = async () => {
            // Solo leemos si estamos en Tab Config, Conectados y NO escribiendo
            if (activeTab === 1 && isConnected && connectedDevice && !isWritingConfig) {
                console.log("Leyendo configuración actual del sensor...");
                setIsReadingConfig(true);
                
                try {
                    const readVal = async (charUUID: string) => {
                        try {
                            const char = await connectedDevice.readCharacteristicForService(BLE_UUIDS.SVC_CONFIG, charUUID);
                            if (char.value) {
                                return Buffer.from(char.value, 'base64').toString('utf8').trim();
                            }
                        } catch (e) {
                            console.log(`Error leyendo ${charUUID}`, e);
                        }
                        return null;
                    };

                    // LECTURA SECUENCIAL
                    const sdEn = await readVal(BLE_UUIDS.CONFIG.SD_ENABLE);
                    const saveInt = await readVal(BLE_UUIDS.CONFIG.SAVE_INTERVAL);
                    const loraEn = await readVal(BLE_UUIDS.CONFIG.LORA_ENABLE);
                    const loraInt = await readVal(BLE_UUIDS.CONFIG.LORA_INTERVAL);
                    const loraOff = await readVal(BLE_UUIDS.CONFIG.LORA_OFFSET);
                    const lowPow = await readVal(BLE_UUIDS.CONFIG.LOW_POWER);
                    const wakeInt = await readVal(BLE_UUIDS.CONFIG.WAKE_INTERVAL);
                    const bleWin = await readVal(BLE_UUIDS.CONFIG.BLE_WINDOW);

                    setConfig(prev => ({
                        ...prev,
                        sdEnabled: sdEn ? sdEn.includes('1') : prev.sdEnabled,
                        saveInterval: saveInt ? parseInt(saveInt) : prev.saveInterval,
                        loraEnabled: loraEn ? loraEn.includes('1') : prev.loraEnabled,
                        loraInterval: loraInt ? parseInt(loraInt) : prev.loraInterval,
                        loraOffset: loraOff ? parseInt(loraOff) : prev.loraOffset,
                        lowPower: lowPow ? lowPow.includes('1') : prev.lowPower,
                        wakeInterval: wakeInt ? parseInt(wakeInt) : prev.wakeInterval,
                        bleWindow: bleWin ? parseInt(bleWin) : prev.bleWindow,
                    }));

                } catch (e) {
                    console.log("Error general leyendo config", e);
                } finally {
                    setIsReadingConfig(false);
                }
            }
        };

        readSensorConfig();
    }, [activeTab, isConnected, connectedDevice]);


    // 3. ESCRIBIR CONFIGURACIÓN AL SENSOR (Secuencial con pausas)
    const writeConfigToSensor = async () => {
        if (!connectedDevice) return;
        setIsWritingConfig(true);

        try {
            const commands = [
                { uuid: BLE_UUIDS.CONFIG.SD_ENABLE, val: config.sdEnabled ? "1" : "0", desc: "SD Enabled" },
                { uuid: BLE_UUIDS.CONFIG.SAVE_INTERVAL, val: config.saveInterval.toString(), desc: "Save Interval" },
                { uuid: BLE_UUIDS.CONFIG.LORA_ENABLE, val: config.loraEnabled ? "1" : "0", desc: "LoRa Enabled" },
                { uuid: BLE_UUIDS.CONFIG.LORA_INTERVAL, val: config.loraInterval.toString(), desc: "LoRa Interval" },
                { uuid: BLE_UUIDS.CONFIG.LORA_OFFSET, val: config.loraOffset.toString(), desc: "LoRa Offset" },
                { uuid: BLE_UUIDS.CONFIG.LOW_POWER, val: config.lowPower ? "1" : "0", desc: "Low Power" },
                { uuid: BLE_UUIDS.CONFIG.WAKE_INTERVAL, val: config.wakeInterval.toString(), desc: "Wake Interval" },
                { uuid: BLE_UUIDS.CONFIG.BLE_WINDOW, val: config.bleWindow.toString(), desc: "BLE Window" },
            ];

            for (const cmd of commands) {
                console.log(`[BLE-WRITE] Enviando ${cmd.desc}: ${cmd.val}`);
                const base64Val = Buffer.from(cmd.val).toString('base64');
                
                await connectedDevice.writeCharacteristicWithResponseForService(
                    BLE_UUIDS.SVC_CONFIG,
                    cmd.uuid,
                    base64Val
                );
                // Pausa para dar tiempo al ESP32 a procesar y guardar en NVS
                await sleep(400);
            }

            Alert.alert("Éxito", "Configuración actualizada en el sensor.");

        } catch (error) {
            Alert.alert("Error de Escritura", "Falló la comunicación con el sensor.");
            console.error(error);
        } finally {
            setIsWritingConfig(false);
        }
    };

    // 4. GUARDAR CAMBIOS (DB LOCAL + BLE SI APLICA)
    const handleSave = async () => {
        // Bloqueo de seguridad: No guardar config hardware si estamos offline
        if (activeTab === 1 && !isConnected) {
            Alert.alert("Modo Offline", "Conéctate al sensor para modificar su configuración interna.");
            return;
        }

        setIsSaving(true);

        try {
            const now = new Date().toISOString();
            
            // Preparar objeto actualizado
            const updatedSensor: SensorEntity = {
                ...originalSensor!,
                id: sensorId,
                alias: metadata.alias,
                location: metadata.location,
                activity: metadata.activity,
                lat: parseFloat(metadata.lat) || 0,
                lng: parseFloat(metadata.lng) || 0,
                config_json: JSON.stringify(config),
                is_synced: 0, // Marcar para subir a la nube
                updated_at: now
            };

            // 1. Guardar en SQLite
            await saveSensor(updatedSensor);

            // 2. Si es Tab Config -> Escribir a Hardware
            if (activeTab === 1 && isConnected) {
                await writeConfigToSensor();
            }

            // 3. Trigger Sync en background
            syncService.pushChanges().catch(err => console.log("Sync background error:", err));

            // --- CORRECCIÓN DE TIMING PARA ANDROID ---
            Alert.alert(
                "Guardado", 
                "Información actualizada correctamente.",
                [
                    { 
                        text: "OK", 
                        onPress: () => {
                            // 1. Primero apagamos los estados de carga para cerrar el Modal
                            setIsWritingConfig(false);
                            setIsSaving(false);

                            // 2. Esperamos un poco para que el Modal desaparezca visualmente
                            setTimeout(() => {
                                // 3. Ahora sí, navegamos atrás de forma segura
                                if (isMounted.current) {
                                    router.back();
                                }
                            }, 200); // 200ms es imperceptible para el usuario pero eterno para el procesador
                        }
                    }
                ]
            );

        } catch (error) {
            Alert.alert("Error", "No se pudo guardar la información.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSyncRTC = async () => {
        if (!isConnected || !connectedDevice) return;
        try {
            const now = new Date();
            // Formato esperado por el firmware: "YYYY-MM-DD HH:MM:SS"
            const timeString = now.toISOString().replace('T', ' ').split('.')[0]; 
            const base64Time = Buffer.from(timeString).toString('base64');
            
            await connectedDevice.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG,
                BLE_UUIDS.CONFIG.RTC_SYNC,
                base64Time
            );
            Alert.alert("Reloj Sincronizado", timeString);
        } catch (error) {
            Alert.alert("Error", "Fallo al sincronizar reloj.");
        }
    };

    const handleGetLocation = async () => {
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            setMetadata(prev => ({
                ...prev,
                lat: loc.coords.latitude.toString(),
                lng: loc.coords.longitude.toString()
            }));
        } catch (error) {
            Alert.alert("Error GPS", "No se pudo obtener la ubicación.");
        }
    };

    const toggleSwitch = (key: keyof typeof config) => {
        setConfig(prev => ({ ...prev, [key]: !prev[key] }));
    };

    if (loading) {
        return (
            <View style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color={Colors.primary} />
            </View>
        );
    }

    return (
        // 1. CAMBIO: Usamos un View normal como contenedor raíz
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* 2. CAMBIO: KeyboardAvoidingView solo envuelve el contenido, NO el overlay */}
            <KeyboardAvoidingView 
                behavior={Platform.OS === "ios" ? "padding" : undefined} // undefined suele ser mejor en Android con Expo Router
                style={{ flex: 1 }}
            >
                {/* HEADER */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton} disabled={isWritingConfig || isSaving}>
                        <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.screenTitle}>Editar Sensor</Text>
                    <View style={{width: 24}} /> 
                </View>

                <View style={styles.content}>
                    {/* ID CARD */}
                    <View style={styles.idCard}>
                        <MaterialCommunityIcons 
                            name={sensorId.includes("B01") ? "sprout" : "weather-partly-cloudy"} 
                            size={32} color={Colors.primary} 
                        />
                        <View style={{marginLeft: 12}}>
                            <Text style={styles.labelId}>ID SENSOR</Text>
                            <Text style={styles.textId}>{sensorId}</Text>
                            {!isConnected && <Text style={styles.offlineTag}>● Desconectado</Text>}
                        </View>
                    </View>

                    <SegmentedControl 
                        options={['Información', 'Configuración']} 
                        selectedIndex={activeTab} 
                        onChange={setActiveTab} 
                        disabled={isWritingConfig || isSaving}
                    />

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
                        {/* TAB 1: INFORMACIÓN */}
                        {activeTab === 0 && (
                            <View style={styles.formSection}>
                                <InputLabel label="Nombre / Alias" icon="tag-text-outline" />
                                <TextInput 
                                    style={styles.input} 
                                    value={metadata.alias} 
                                    placeholder="Ej: Sensor Lote 4"
                                    onChangeText={(t) => setMetadata({...metadata, alias: t})}
                                />
                                {/* ... resto de inputs Tab 1 ... */}
                                <InputLabel label="Ubicación / Finca" icon="map-marker-outline" />
                                <TextInput 
                                    style={styles.input} 
                                    value={metadata.location} 
                                    onChangeText={(t) => setMetadata({...metadata, location: t})}
                                />
                                <InputLabel label="Actividad / Cultivo" icon="sprout-outline" />
                                <TextInput 
                                    style={styles.input} 
                                    value={metadata.activity} 
                                    onChangeText={(t) => setMetadata({...metadata, activity: t})}
                                />
                                <View style={styles.divider} />
                                <Text style={styles.sectionHeader}>Geolocalización</Text>
                                <View style={styles.row}>
                                    <View style={{flex: 1, marginRight: 8}}>
                                        <InputLabel label="Latitud" />
                                        <TextInput style={styles.input} keyboardType="numeric" value={metadata.lat} onChangeText={(t) => setMetadata({...metadata, lat: t})} />
                                    </View>
                                    <View style={{flex: 1, marginLeft: 8}}>
                                        <InputLabel label="Longitud" />
                                        <TextInput style={styles.input} keyboardType="numeric" value={metadata.lng} onChangeText={(t) => setMetadata({...metadata, lng: t})} />
                                    </View>
                                </View>
                                <TouchableOpacity style={styles.gpsButton} onPress={handleGetLocation}>
                                    <MaterialCommunityIcons name="crosshairs-gps" size={18} color={Colors.primary} />
                                    <Text style={styles.gpsButtonText}>Usar mi ubicación actual</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* TAB 2: CONFIGURACIÓN */}
                        {activeTab === 1 && (
                            <View style={styles.formSection}>
                                {!isConnected ? (
                                    <View style={styles.lockedContainer}>
                                        <MaterialCommunityIcons name="bluetooth-off" size={48} color="#ccc" />
                                        <Text style={styles.lockedTitle}>Sensor Desconectado</Text>
                                        <Text style={styles.lockedText}>Conéctate para configurar.</Text>
                                    </View>
                                ) : isReadingConfig ? (
                                    <View style={{padding: 40, alignItems: 'center'}}>
                                        <ActivityIndicator size="large" color={Colors.primary} />
                                        <Text style={{marginTop: 15, color: '#666'}}>Leyendo parámetros...</Text>
                                    </View>
                                ) : (
                                    <>
                                        {/* ... Tus ConfigGroups ... */}
                                        <ConfigGroup title="Almacenamiento (SD)">
                                            <SwitchRow label="Habilitar Tarjeta SD" value={config.sdEnabled} onValueChange={() => toggleSwitch('sdEnabled')} />
                                            <TimeIntervalInput label="Intervalo de Guardado" valueSeconds={config.saveInterval} onChangeSeconds={(v) => setConfig({...config, saveInterval: v})} />
                                        </ConfigGroup>
                                        <ConfigGroup title="Transmisión LoRa">
                                            <SwitchRow label="Habilitar LoRa" value={config.loraEnabled} onValueChange={() => toggleSwitch('loraEnabled')} />
                                            <TimeIntervalInput label="Intervalo de Envío" valueSeconds={config.loraInterval} onChangeSeconds={(v) => setConfig({...config, loraInterval: v})} />
                                            <View style={{marginTop: 10}}>
                                                <InputLabel label="Offset (minutos)" />
                                                <TextInput style={styles.input} keyboardType="numeric" value={config.loraOffset.toString()} onChangeText={(t) => setConfig({...config, loraOffset: parseInt(t) || 0})} />
                                            </View>
                                        </ConfigGroup>
                                        <ConfigGroup title="Energía">
                                            <SwitchRow label="Modo Bajo Consumo" value={config.lowPower} onValueChange={() => toggleSwitch('lowPower')} />
                                            <TimeIntervalInput label="Ciclo Wake" valueSeconds={config.wakeInterval} onChangeSeconds={(v) => setConfig({...config, wakeInterval: v})} />
                                            <TimeIntervalInput label="Ventana BLE" valueSeconds={config.bleWindow} onChangeSeconds={(v) => setConfig({...config, bleWindow: v})} />
                                        </ConfigGroup>
                                        <ConfigGroup title="Reloj">
                                            <TouchableOpacity style={styles.syncButton} onPress={handleSyncRTC}>
                                                <MaterialCommunityIcons name="clock-check-outline" size={20} color="#fff" />
                                                <Text style={styles.syncButtonText}>Sincronizar hora</Text>
                                            </TouchableOpacity>
                                        </ConfigGroup>
                                    </>
                                )}
                            </View>
                        )}
                    </ScrollView>
                </View>

                {/* FOOTER */}
                <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
                    <TouchableOpacity 
                        style={[styles.saveButton, (isWritingConfig || isSaving) && styles.saveButtonDisabled]} 
                        onPress={handleSave}
                        disabled={isWritingConfig || isSaving}
                    >
                        {(isWritingConfig || isSaving) ? (
                            <View style={{flexDirection: 'row', gap: 10}}>
                                <ActivityIndicator color="#fff" />
                                <Text style={styles.saveButtonText}>PROCESANDO...</Text>
                            </View>
                        ) : (
                            <>
                                <MaterialCommunityIcons name={activeTab === 1 && isConnected ? "upload" : "content-save"} size={20} color="#fff" style={{marginRight: 8}}/>
                                <Text style={styles.saveButtonText}>
                                    {activeTab === 1 && isConnected ? "APLICAR AL SENSOR" : "GUARDAR CAMBIOS"}
                                </Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            {/* 3. CAMBIO: El Overlay ahora está FUERA del KeyboardAvoidingView y es el último elemento */}
            {isWritingConfig && (
                <View style={styles.writingOverlay}>
                    <ActivityIndicator size="large" color="#fff" />
                    <Text style={{color: '#fff', marginTop: 20, fontWeight: 'bold', fontSize: 16}}>Configurando Sensor...</Text>
                    <Text style={{color: '#ddd', fontSize: 13, marginTop: 5}}>No cierres la app.</Text>
                </View>
            )}
        </View>
    );
}

// --- SUBCOMPONENTES ---
const InputLabel = ({label, icon}: {label: string, icon?: any}) => (
    <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginTop: 12}}>
        {icon && <MaterialCommunityIcons name={icon} size={16} color={Colors.textSecondary} style={{marginRight: 6}} />}
        <Text style={{fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary}}>{label}</Text>
    </View>
);

const ConfigGroup = ({title, children}: any) => (
    <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={styles.cardDivider} />
        {children}
    </View>
);

const SwitchRow = ({label, value, onValueChange}: any) => (
    <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
        <Text style={{fontSize: 15, color: Colors.textPrimary}}>{label}</Text>
        <Switch 
            value={value} 
            onValueChange={onValueChange} 
            trackColor={{ false: "#ccc", true: Colors.primary }}
            thumbColor={"#fff"}
        />
    </View>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8f9fa' },
    center: { justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
    backButton: { padding: 4 },
    screenTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
    
    content: { flex: 1, paddingHorizontal: 16 },
    idCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3f2fd', padding: 16, borderRadius: 12, marginBottom: 20, marginTop: 20, borderWidth: 1, borderColor: '#bbdefb' },
    labelId: { fontSize: 10, color: Colors.primary, fontWeight: 'bold' },
    textId: { fontSize: 18, fontWeight: 'bold', color: '#0d47a1', fontFamily: 'monospace' },
    offlineTag: { fontSize: 12, color: Colors.error, marginTop: 2, fontWeight: 'bold' },

    formSection: { backgroundColor: '#fff', padding: 20, borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, marginTop: 15, marginBottom: 50 },
    sectionHeader: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 5, marginTop: 10 },
    input: { backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#333' },
    row: { flexDirection: 'row' },
    divider: { height: 1, backgroundColor: '#eee', marginVertical: 20 },
    
    gpsButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 15, padding: 10, borderWidth: 1, borderColor: Colors.primary, borderRadius: 8, backgroundColor: '#f0f7ff' },
    gpsButtonText: { color: Colors.primary, fontWeight: 'bold', marginLeft: 6 },

    // Estilos Config
    card: { marginBottom: 25 },
    cardTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.primary, textTransform: 'uppercase' },
    cardDivider: { height: 1, backgroundColor: '#eee', marginVertical: 10 },
    helperText: { fontSize: 11, color: '#999', marginTop: 4, fontStyle: 'italic' },
    
    syncButton: { flexDirection: 'row', backgroundColor: Colors.secondary, padding: 12, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    syncButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },

    lockedContainer: { alignItems: 'center', justifyContent: 'center', padding: 30 },
    lockedTitle: { fontSize: 18, fontWeight: 'bold', color: '#999', marginTop: 15 },
    lockedText: { textAlign: 'center', color: '#aaa', marginTop: 10, lineHeight: 20 },

    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
    saveButton: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
    saveButtonDisabled: { backgroundColor: '#ccc' },
    saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

    writingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 999 }
});