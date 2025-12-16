import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Buffer } from 'buffer';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// COMPONENTES PROPIOS
import SegmentedControl from '../../../components/global/SegmentedControl';
import TimeIntervalInput from '../../../components/inputs/TimeIntervalInput';
import { Colors } from '../../../constants/Colors';

// DB & CONTEXT
import { BLE_UUIDS } from '../../../constants/BleUUIDs';
import { useBle } from '../../../context/BleContext';
import { getSensorById, saveSensor } from '../../../database/SensorRepository';
import { SensorEntity } from '../../../database/types';

// --- UTILIDAD: PAUSA (Sleep) ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function SensorInfoScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();

  // Contexto BLE
  const { connectedDevice } = useBle();
  const isConnected = !!connectedDevice;

  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true); // Carga inicial de DB
  
  // Estados de carga de operaciones BLE
  const [isReadingConfig, setIsReadingConfig] = useState(false);
  const [isWritingConfig, setIsWritingConfig] = useState(false);

  // --- ESTADO DE DATOS (METADATA DB) ---
  const [metadata, setMetadata] = useState({
    alias: '',
    location: '',
    lat: '',
    lng: '',
    activity: '',
  });

  // --- ESTADO DE CONFIGURACIÓN ---
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

  // 1. CARGAR DATOS DB AL INICIO
  useEffect(() => {
    const loadData = async () => {
      if (!sensorId) return;
      try {
        const sensor = await getSensorById(sensorId);
        if (sensor) {
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
              setConfig(prev => ({ ...prev, ...parsedConfig }));
            } catch (e) {}
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

  // 2. LEER CONFIGURACIÓN REAL DEL SENSOR (Al cambiar a Tab 1)
  useEffect(() => {
    const readSensorConfig = async () => {
        // Solo leemos si estamos en la pestaña de config, conectados y NO estamos escribiendo
        if (activeTab === 1 && isConnected && connectedDevice && !isWritingConfig) {
            console.log("Leyendo configuración actual del sensor...");
            setIsReadingConfig(true);
            
            try {
                // Función helper para leer y decodificar
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

                // LECTURA SECUENCIAL (Para no saturar)
                // 1. SD Enable
                const sdEn = await readVal(BLE_UUIDS.CONFIG.SD_ENABLE);
                
                // 2. Intervalo Guardado
                const saveInt = await readVal(BLE_UUIDS.CONFIG.SAVE_INTERVAL);
                
                // 3. LoRa Enable
                const loraEn = await readVal(BLE_UUIDS.CONFIG.LORA_ENABLE);
                
                // 4. Intervalo LoRa
                const loraInt = await readVal(BLE_UUIDS.CONFIG.LORA_INTERVAL);
                
                // 5. Offset LoRa
                const loraOff = await readVal(BLE_UUIDS.CONFIG.LORA_OFFSET);
                
                // 6. Low Power
                const lowPow = await readVal(BLE_UUIDS.CONFIG.LOW_POWER);
                
                // 7. Wake Interval
                const wakeInt = await readVal(BLE_UUIDS.CONFIG.WAKE_INTERVAL);
                
                // 8. BLE Window
                const bleWin = await readVal(BLE_UUIDS.CONFIG.BLE_WINDOW);

                // ACTUALIZAR ESTADO
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
                console.log("Error general leyendo configuración", e);
            } finally {
                setIsReadingConfig(false);
            }
        }
    };

    readSensorConfig();
  }, [activeTab, isConnected, connectedDevice]); // Se ejecuta al cambiar de pestaña


  // 3. ESCRITURA SECUENCIAL (THROTTLING)
  const writeConfigToSensor = async () => {
    if (!connectedDevice) return;
    setIsWritingConfig(true);

    try {
        // DEFINIMOS LA LISTA DE COMANDOS A ENVIAR
        const commands = [
            // 1. SD ENABLE
            { uuid: BLE_UUIDS.CONFIG.SD_ENABLE, val: config.sdEnabled ? "1" : "0", desc: "SD Habilitada" },
            // 2. INTERVALO GUARDADO
            { uuid: BLE_UUIDS.CONFIG.SAVE_INTERVAL, val: config.saveInterval.toString(), desc: "Intervalo Guardado" },
            // 3. LORA ENABLE
            { uuid: BLE_UUIDS.CONFIG.LORA_ENABLE, val: config.loraEnabled ? "1" : "0", desc: "LoRa Habilitado" },
            // 4. INTERVALO LORA
            { uuid: BLE_UUIDS.CONFIG.LORA_INTERVAL, val: config.loraInterval.toString(), desc: "Intervalo LoRa" },
            // 5. OFFSET LORA
            { uuid: BLE_UUIDS.CONFIG.LORA_OFFSET, val: config.loraOffset.toString(), desc: "Offset LoRa" },
            // 6. LOW POWER
            { uuid: BLE_UUIDS.CONFIG.LOW_POWER, val: config.lowPower ? "1" : "0", desc: "Bajo Consumo" },
            // 7. WAKE INTERVAL
            { uuid: BLE_UUIDS.CONFIG.WAKE_INTERVAL, val: config.wakeInterval.toString(), desc: "Intervalo Despertar" },
            // 8. BLE WINDOW
            { uuid: BLE_UUIDS.CONFIG.BLE_WINDOW, val: config.bleWindow.toString(), desc: "Ventana Bluetooth" },
        ];

        // ITERAMOS CON PAUSA (Throttling)
        for (const cmd of commands) {
            console.log(`[BLE-WRITE] Enviando ${cmd.desc}: ${cmd.val}`);
            
            const base64Val = Buffer.from(cmd.val).toString('base64');
            
            await connectedDevice.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_CONFIG,
                cmd.uuid,
                base64Val
            );

            // PAUSA CRÍTICA DE 500ms
            await sleep(500);
        }

        Alert.alert("Configuración Exitosa", "Todos los parámetros han sido actualizados en el sensor.");

    } catch (error) {
        Alert.alert("Error de Escritura", "Hubo un problema enviando la configuración. Intente nuevamente.");
        console.error(error);
    } finally {
        setIsWritingConfig(false);
    }
  };


  // 4. GUARDAR GENERAL
  const handleSave = async () => {
    // Si estamos en la pestaña de CONFIG y desconectados, no dejar guardar config hardware
    if (activeTab === 1 && !isConnected) {
        Alert.alert("Offline", "No se puede modificar la configuración del hardware sin conexión.");
        return;
    }

    try {
      // A. GUARDAR EN DB
      const updatedSensor: SensorEntity = {
        id: sensorId,
        alias: metadata.alias || sensorId,
        type: sensorId.includes('B01') ? 'B01' : 'C01',
        location: metadata.location,
        activity: metadata.activity,
        lat: parseFloat(metadata.lat) || 0,
        lng: parseFloat(metadata.lng) || 0,
        config_json: JSON.stringify(config),
        last_sync: new Date().toISOString(),
        is_synced: 0,
        updated_at: ''
      };

      await saveSensor(updatedSensor);

      // B. SI ESTAMOS CONECTADOS Y EN PESTAÑA CONFIG -> ENVIAR A SENSOR
      if (activeTab === 1 && isConnected) {
          // Confirmación antes de escribir (es un proceso lento)
          Alert.alert(
              "Sincronizar Sensor", 
              "Esto enviará la configuración al dispositivo. El proceso puede tomar unos segundos.",
              [
                  { text: "Cancelar", style: "cancel" },
                  { text: "Enviar", onPress: () => writeConfigToSensor() }
              ]
          );
      } else {
          Alert.alert("Guardado", "Información actualizada en la base de datos.");
          router.back();
      }

    } catch (error) {
      Alert.alert("Error", "No se pudo guardar los cambios.");
      console.error(error);
    }
  };

  const handleSyncRTC = async () => {
    if (!isConnected || !connectedDevice) return;
    try {
      const now = new Date();
      const timeString = now.toISOString().replace('T', ' ').split('.')[0]; 
      const base64Time = Buffer.from(timeString).toString('base64');
      
      await connectedDevice.writeCharacteristicWithResponseForService(
          BLE_UUIDS.SVC_CONFIG,
          BLE_UUIDS.CONFIG.RTC_SYNC,
          base64Time
      );
      Alert.alert("Éxito", `Reloj sincronizado: ${timeString}`);
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
        <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={Colors.primary} />
        </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER */}
      <View style={styles.customHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} disabled={isWritingConfig}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Configuración</Text>
        <View style={{width: 24}} /> 
      </View>

      <View style={styles.content}>
        
        {/* INFO SENSOR */}
        <View style={styles.headerId}>
           <MaterialCommunityIcons name={isConnected ? "bluetooth-connect" : "database"} size={24} color={isConnected ? Colors.primary : Colors.textSecondary} />
           <Text style={styles.sensorIdText}>{sensorId}</Text>
           {!isConnected && <Text style={{fontSize: 10, color: '#999', marginLeft: 5}}>(OFFLINE)</Text>}
        </View>

        <SegmentedControl 
          options={['Información', 'Configuración']} 
          selectedIndex={activeTab} 
          onChange={setActiveTab} 
          //disabled={isWritingConfig} 
        />

        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          
          {/* --- TAB 1: INFORMACIÓN (Siempre visible) --- */}
          {activeTab === 0 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Datos del Sensor</Text>
              
              <InputLabel label="Nombre / Alias" />
              <TextInput 
                style={styles.input} 
                value={metadata.alias} 
                placeholder="Ej: Nogales Lote 1"
                onChangeText={(t) => setMetadata({...metadata, alias: t})}
              />

              <InputLabel label="Ubicación / Finca" />
              <TextInput 
                style={styles.input} 
                value={metadata.location} 
                placeholder="Ej: Finca Sumalao"
                onChangeText={(t) => setMetadata({...metadata, location: t})}
              />

              <InputLabel label="Actividad / Cultivo" />
              <TextInput 
                style={styles.input} 
                value={metadata.activity} 
                placeholder="Ej: Cultivo de Nogal"
                onChangeText={(t) => setMetadata({...metadata, activity: t})}
              />

              <Text style={styles.sectionTitle}>Coordenadas GPS</Text>
              <View style={{flexDirection: 'row', gap: 10}}>
                <View style={{flex: 1}}>
                  <InputLabel label="Latitud" />
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric"
                    value={metadata.lat} 
                    onChangeText={(t) => setMetadata({...metadata, lat: t})}
                  />
                </View>
                <View style={{flex: 1}}>
                  <InputLabel label="Longitud" />
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric"
                    value={metadata.lng} 
                    onChangeText={(t) => setMetadata({...metadata, lng: t})}
                  />
                </View>
              </View>
              
              <TouchableOpacity style={styles.gpsButton} onPress={handleGetLocation}>
                 <MaterialCommunityIcons name="crosshairs-gps" size={18} color={Colors.primary} />
                 <Text style={styles.gpsButtonText}>Usar mi ubicación actual</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* --- TAB 2: CONFIGURACIÓN (Protegida) --- */}
          {activeTab === 1 && (
            <View style={styles.formSection}>
              
              {!isConnected ? (
                  <View style={styles.lockedContainer}>
                      <MaterialCommunityIcons name="lock-alert" size={64} color="#ccc" />
                      <Text style={styles.lockedTitle}>Configuración Bloqueada</Text>
                      <Text style={styles.lockedText}>
                          Para modificar los parámetros del hardware (intervalos, SD, LoRa), 
                          debes estar conectado al sensor via Bluetooth.
                      </Text>
                  </View>
              ) : isReadingConfig ? (
                  // SPINNER MIENTRAS LEE
                  <View style={{padding: 40, alignItems: 'center'}}>
                      <ActivityIndicator size="large" color={Colors.primary} />
                      <Text style={{marginTop: 10, color: Colors.textSecondary}}>Leyendo configuración del sensor...</Text>
                  </View>
              ) : (
                  <>
                      <ConfigGroup title="Almacenamiento Local (SD)">
                        <SwitchRow 
                          label="Habilitar tarjeta SD" 
                          value={config.sdEnabled} 
                          onValueChange={() => toggleSwitch('sdEnabled')} 
                        />
                        <TimeIntervalInput 
                          label="Intervalo de Medición" 
                          valueSeconds={config.saveInterval}
                          onChangeSeconds={(v) => setConfig({...config, saveInterval: v})}
                        />
                      </ConfigGroup>

                      <ConfigGroup title="Transmisión LoRa">
                        <SwitchRow 
                          label="Habilitar envío LoRa" 
                          value={config.loraEnabled} 
                          onValueChange={() => toggleSwitch('loraEnabled')} 
                        />
                        <TimeIntervalInput 
                          label="Intervalo de Envío" 
                          valueSeconds={config.loraInterval}
                          onChangeSeconds={(v) => setConfig({...config, loraInterval: v})}
                        />
                        <View style={{marginTop: 5}}>
                          <InputLabel label="Offset (Minutos)" />
                          <TextInput 
                            style={styles.input} 
                            keyboardType="numeric"
                            value={config.loraOffset.toString()} 
                            onChangeText={(t) => setConfig({...config, loraOffset: parseInt(t) || 0})}
                          />
                        </View>
                      </ConfigGroup>

                      <ConfigGroup title="Energía">
                        <SwitchRow 
                          label="Modo Bajo Consumo" 
                          value={config.lowPower} 
                          onValueChange={() => toggleSwitch('lowPower')} 
                        />
                        <TimeIntervalInput 
                          label="Intervalo Wake (Despertar)" 
                          valueSeconds={config.wakeInterval}
                          onChangeSeconds={(v) => setConfig({...config, wakeInterval: v})}
                        />
                        <TimeIntervalInput 
                          label="Ventana Bluetooth" 
                          valueSeconds={config.bleWindow}
                          onChangeSeconds={(v) => setConfig({...config, bleWindow: v})}
                        />
                      </ConfigGroup>

                      <ConfigGroup title="Reloj (RTC)">
                        <TouchableOpacity style={styles.syncButton} onPress={handleSyncRTC}>
                          <MaterialCommunityIcons name="clock-check-outline" size={20} color="#fff" />
                          <Text style={styles.syncButtonText}>Sincronizar con celular</Text>
                        </TouchableOpacity>
                      </ConfigGroup>
                  </>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {/* FOOTER */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity 
            style={[styles.saveButton, isWritingConfig && {backgroundColor: '#ccc'}]} 
            onPress={handleSave}
            disabled={isWritingConfig}
        >
          {isWritingConfig ? (
              <View style={{flexDirection: 'row', gap: 10}}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.saveButtonText}>ENVIANDO...</Text>
              </View>
          ) : (
              <Text style={styles.saveButtonText}>
                  {activeTab === 1 && isConnected ? "ENVIAR A SENSOR" : "GUARDAR DATOS"}
              </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* OVERLAY DE ESCRITURA (Bloqueo Total) */}
      {isWritingConfig && (
          <View style={styles.writingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={{color: '#fff', marginTop: 15, fontWeight: 'bold', fontSize: 16}}>Configurando sensor...</Text>
              <Text style={{color: '#ddd', fontSize: 12, marginTop: 5}}>Por favor no cierre la aplicación</Text>
          </View>
      )}

    </View>
  );
}

// --- SUBCOMPONENTES ---
const InputLabel = ({label}: {label: string}) => (
  <Text style={{fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 4, marginTop: 10}}>{label}</Text>
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
    <Text style={{fontSize: 16, color: Colors.textPrimary}}>{label}</Text>
    <Switch 
      value={value} 
      onValueChange={onValueChange} 
      trackColor={{ false: "#767577", true: Colors.primary }}
      thumbColor={value ? "#fff" : "#f4f3f4"}
    />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f2' },
  content: { flex: 1, paddingHorizontal: 16 },
  
  customHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#f2f2f2'
  },
  backButton: { padding: 8 },
  screenTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary },

  headerId: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', 
    marginBottom: 15, padding: 10, backgroundColor: '#fff', borderRadius: 8, elevation: 1
  },
  sensorIdText: { fontSize: 18, fontWeight: 'bold', marginLeft: 10, color: Colors.textPrimary, fontFamily: 'monospace' },
  
  formSection: { paddingBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.primary,marginTop: 20 },
  
  input: { 
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 6, 
    padding: 10, fontSize: 16, color: '#000' 
  },
  gpsButton: { flexDirection: 'row', alignItems: 'center', marginTop: 15, alignSelf: 'flex-end', padding: 5 },
  gpsButtonText: { color: Colors.primary, fontWeight: 'bold', marginLeft: 4 },
  
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 15, marginBottom: 15, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textSecondary },
  cardDivider: { height: 1, backgroundColor: '#eee', marginVertical: 10 },
  
  syncButton: { 
    flexDirection: 'row', backgroundColor: Colors.secondary, padding: 12, borderRadius: 6, 
    justifyContent: 'center', alignItems: 'center' 
  },
  syncButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },

  footer: { 
    position: 'absolute', bottom: 0, left: 0, right: 0, 
    backgroundColor: '#fff', 
    paddingTop: 16, paddingHorizontal: 16, 
    borderTopWidth: 1, borderTopColor: '#ddd',
    elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: -2}, shadowOpacity: 0.1
  },
  saveButton: { 
    backgroundColor: Colors.primary, padding: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center'
  },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },

  lockedContainer: {
      alignItems: 'center', justifyContent: 'center', marginTop: 50, padding: 20,
      backgroundColor: '#fff', borderRadius: 12, elevation: 2
  },
  lockedTitle: { fontSize: 20, fontWeight: 'bold', color: '#999', marginTop: 10 },
  lockedText: { textAlign: 'center', color: '#aaa', marginTop: 10, lineHeight: 20 },

  writingOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'center', alignItems: 'center', zIndex: 999
  }
});