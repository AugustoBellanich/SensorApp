import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import SegmentedControl from '../../../components/global/SegmentedControl';
import TimeIntervalInput from '../../../components/inputs/TimeIntervalInput';
import { Colors } from '../../../constants/Colors';
// 1. IMPORTAMOS EL HOOK DE ÁREAS SEGURAS
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SensorInfoScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorId = Array.isArray(id) ? id[0] : id;
  
  // 2. OBTENEMOS LAS MEDIDAS SEGURAS DE TU CELULAR
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState(0);

  // --- ESTADO DE DATOS (MOCK) ---
  const [metadata, setMetadata] = useState({
    alias: 'Nogales Lote 1',
    location: 'Finca Experimental Sumalao',
    lat: '-28.468',
    lng: '-65.779',
    activity: 'Cultivo de Nogal - Ensayo Riego',
  });

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

  // --- HANDLERS ---
  const handleSave = () => {
    Alert.alert("Guardando...", "Enviando configuración al sensor...");
  };

  const handleSyncRTC = () => {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').split('.')[0]; 
    Alert.alert("Sincronizar Reloj", `Se enviará: ${timestamp}`);
  };

  const toggleSwitch = (key: keyof typeof config) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 3. OCULTAMOS EL HEADER NATIVO PARA CONTROLAR NOSOTROS EL ESPACIO */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER PERSONALIZADO (Título y Botón Volver) */}
      <View style={styles.customHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
           <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Configuración</Text>
        <View style={{width: 24}} /> {/* Espacio fantasma para centrar título */}
      </View>

      <View style={styles.content}>
        
        {/* NOMBRE DEL SENSOR */}
        <View style={styles.headerId}>
           <MaterialCommunityIcons name="chip" size={24} color={Colors.primary} />
           <Text style={styles.sensorIdText}>{sensorId}</Text>
        </View>

        {/* SELECTOR DE PESTAÑAS */}
        <SegmentedControl 
          options={['Información', 'Configuración']} 
          selectedIndex={activeTab} 
          onChange={setActiveTab} 
        />

        {/* SCROLLVIEW CON PADDING INFERIOR PARA QUE EL BOTÓN NO TAPE LO ULTIMO */}
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }} // Espacio extra al final del scroll
        >
          
          {/* --- TAB 1: INFORMACIÓN --- */}
          {activeTab === 0 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Datos del Sensor</Text>
              
              <InputLabel label="Nombre / Alias" />
              <TextInput 
                style={styles.input} 
                value={metadata.alias} 
                onChangeText={(t) => setMetadata({...metadata, alias: t})}
              />

              <InputLabel label="Ubicación / Finca" />
              <TextInput 
                style={styles.input} 
                value={metadata.location} 
                onChangeText={(t) => setMetadata({...metadata, location: t})}
              />

              <InputLabel label="Actividad / Cultivo" />
              <TextInput 
                style={styles.input} 
                value={metadata.activity} 
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
              <TouchableOpacity style={styles.gpsButton}>
                 <MaterialCommunityIcons name="crosshairs-gps" size={16} color={Colors.primary} />
                 <Text style={styles.gpsButtonText}>Usar mi ubicación actual</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* --- TAB 2: CONFIGURACIÓN (HARDWARE) --- */}
          {activeTab === 1 && (
            <View style={styles.formSection}>
              
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
                  <Text style={styles.syncButtonText}>Sincronizar Fecha y Hora</Text>
                </TouchableOpacity>
              </ConfigGroup>

            </View>
          )}
        </ScrollView>
      </View>

      {/* 4. FOOTER CON PADDING DINÁMICO (insets.bottom) */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>GUARDAR CAMBIOS</Text>
        </TouchableOpacity>
      </View>
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
  
  // Header Personalizado
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
  gpsButton: { flexDirection: 'row', alignItems: 'center', marginTop: 8, alignSelf: 'flex-end' },
  gpsButtonText: { color: Colors.primary, fontWeight: 'bold', marginLeft: 4 },
  
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 15, marginBottom: 15, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textSecondary },
  cardDivider: { height: 1, backgroundColor: '#eee', marginVertical: 10 },
  
  syncButton: { 
    flexDirection: 'row', backgroundColor: Colors.secondary, padding: 12, borderRadius: 6, 
    justifyContent: 'center', alignItems: 'center' 
  },
  syncButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },

  // Footer Flotante
  footer: { 
    position: 'absolute', bottom: 0, left: 0, right: 0, 
    backgroundColor: '#fff', 
    paddingTop: 16, paddingHorizontal: 16, // El paddingBottom se inyecta dinámicamente
    borderTopWidth: 1, borderTopColor: '#ddd',
    elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: -2}, shadowOpacity: 0.1
  },
  saveButton: { 
    backgroundColor: Colors.primary, padding: 15, borderRadius: 8, alignItems: 'center' 
  },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 }
});