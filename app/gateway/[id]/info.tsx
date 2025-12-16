import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- CONSTANTS & LIBS ---
import { Colors } from '../../../constants/Colors';
import { supabase } from '../../../lib/supabase';

// --- DB REPOSITORY ---
import { getSensorById, saveSensor } from '../../../database/SensorRepository';
import { SensorEntity } from '../../../database/types';

export default function GatewayInfoScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorId = Array.isArray(id) ? id[0] : id;
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // --- ESTADO DE DATOS (METADATA) ---
    const [metadata, setMetadata] = useState({
        alias: '',
        location: '', // Nombre de la finca/lote
        lat: '',
        lng: '',
    });

    // 1. CARGAR DATOS EXISTENTES AL INICIO
    useEffect(() => {
        const loadData = async () => {
            if (!sensorId) return;
            try {
                // Cargar desde SQLite Local
                const sensor = await getSensorById(sensorId);
                if (sensor) {
                    setMetadata({
                        alias: sensor.alias || sensorId,
                        location: sensor.location || '',
                        lat: sensor.lat ? sensor.lat.toString() : '',
                        lng: sensor.lng ? sensor.lng.toString() : '',
                    });
                }
            } catch (error) {
                console.error("Error cargando info:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [sensorId]);

    // 2. OBTENER UBICACIÓN GPS DEL CELULAR
    const handleGetLocation = async () => {
        setIsSaving(true); // Usamos este flag para bloquear botones mientras carga
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert("Permiso denegado", "Se necesita acceso a la ubicación para usar el GPS.");
                setIsSaving(false);
                return;
            }

            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            
            setMetadata(prev => ({
                ...prev,
                lat: loc.coords.latitude.toString(),
                lng: loc.coords.longitude.toString()
            }));

            Alert.alert("GPS Actualizado", `Lat: ${loc.coords.latitude.toFixed(5)}\nLng: ${loc.coords.longitude.toFixed(5)}`);

        } catch (_) {
            Alert.alert("Error GPS", "No se pudo obtener la ubicación. Asegúrese de tener el GPS activado.");
        } finally {
            setIsSaving(false);
        }
    };

    // 3. GUARDAR CAMBIOS (SQLite + Supabase)
    const handleSave = async () => {
        if (!sensorId) return;
        setIsSaving(true);

        try {
            const latVal = parseFloat(metadata.lat) || 0;
            const lngVal = parseFloat(metadata.lng) || 0;
            const now = new Date().toISOString();

            // A. PREPARAR OBJETO LOCAL
            // Recuperamos el sensor actual para no perder configuraciones (config_json) que no editamos aquí
            const currentSensor = await getSensorById(sensorId);
            
            const updatedSensor: SensorEntity = {
                id: sensorId,
                type: 'N01', // Forzamos N01 porque estamos en la carpeta gateway
                alias: metadata.alias,
                location: metadata.location,
                lat: latVal,
                lng: lngVal,
                activity: currentSensor?.activity || 'active',
                config_json: currentSensor?.config_json || '{}', // Mantenemos la config técnica intacta
                updated_at: now,
                last_sync: now,
                is_synced: 0 // Asumimos 0 hasta que Supabase confirme
            };

            // B. GUARDAR EN SUPABASE (Tabla 'devices')
            const { error } = await supabase
                .from('devices')
                .upsert({
                    id: sensorId,
                    alias: metadata.alias,
                    name_farm: metadata.location, // Mapeamos location a name_farm
                    lat: latVal,
                    lng: lngVal,
                    type: 'N01',
                    last_sync: now
                });

            if (error) {
                console.error("Error Supabase:", error);
                updatedSensor.is_synced = 0;
                Alert.alert("Guardado Local", "Se guardaron los datos en el celular, pero falló la sincronización con la nube.");
            } else {
                updatedSensor.is_synced = 1;
                Alert.alert("Éxito", "Información actualizada correctamente.");
            }

            // C. GUARDAR EN SQLITE
            await saveSensor(updatedSensor);
            
            router.back(); // Volver al Dashboard

        } catch (error) {
            Alert.alert("Error", "Ocurrió un error inesperado al guardar.");
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color={Colors.primary} />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : "height"} 
            style={[styles.container, { paddingTop: insets.top }]}
        >
            <Stack.Screen options={{ headerShown: false }} />

            {/* HEADER */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton} disabled={isSaving}>
                   <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.screenTitle}>Editar Información</Text>
                <View style={{width: 24}} /> 
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                
                {/* ID CARD */}
                <View style={styles.idCard}>
                   <MaterialCommunityIcons name="router-wireless" size={32} color={Colors.primary} />
                   <View style={{marginLeft: 12}}>
                        <Text style={styles.labelId}>ID DEL GATEWAY</Text>
                        <Text style={styles.textId}>{sensorId}</Text>
                   </View>
                </View>

                {/* FORMULARIO */}
                <View style={styles.formSection}>
                    
                    <InputLabel label="Alias / Nombre" icon="tag-text-outline"/>
                    <TextInput 
                        style={styles.input} 
                        value={metadata.alias} 
                        placeholder="Ej: Gateway Principal"
                        onChangeText={(t) => setMetadata({...metadata, alias: t})}
                        editable={!isSaving}
                    />

                    <InputLabel label="Ubicación (Finca / Lote)" icon="map-marker-outline"/>
                    <TextInput 
                        style={styles.input} 
                        value={metadata.location} 
                        placeholder="Ej: Finca Sumalao - Sector Norte"
                        onChangeText={(t) => setMetadata({...metadata, location: t})}
                        editable={!isSaving}
                    />

                    <View style={styles.divider} />

                    <Text style={styles.sectionHeader}>Geolocalización</Text>
                    
                    <View style={styles.row}>
                        <View style={{flex: 1, marginRight: 8}}>
                            <InputLabel label="Latitud" />
                            <TextInput 
                                style={styles.input} 
                                keyboardType="numeric"
                                value={metadata.lat} 
                                placeholder="-0.00000"
                                onChangeText={(t) => setMetadata({...metadata, lat: t})}
                                editable={!isSaving}
                            />
                        </View>
                        <View style={{flex: 1, marginLeft: 8}}>
                            <InputLabel label="Longitud" />
                            <TextInput 
                                style={styles.input} 
                                keyboardType="numeric"
                                value={metadata.lng} 
                                placeholder="-0.00000"
                                onChangeText={(t) => setMetadata({...metadata, lng: t})}
                                editable={!isSaving}
                            />
                        </View>
                    </View>

                    <TouchableOpacity 
                        style={[styles.gpsButton, isSaving && {opacity: 0.5}]} 
                        onPress={handleGetLocation}
                        disabled={isSaving}
                    >
                        {isSaving ? <ActivityIndicator size="small" color={Colors.primary}/> : <MaterialCommunityIcons name="crosshairs-gps" size={20} color={Colors.primary} />}
                        <Text style={styles.gpsButtonText}>
                            {isSaving ? " Obteniendo..." : " Usar Ubicación Actual"}
                        </Text>
                    </TouchableOpacity>

                </View>

            </ScrollView>

            {/* FOOTER - GUARDAR */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
                <TouchableOpacity 
                    style={[styles.saveButton, isSaving && styles.saveButtonDisabled]} 
                    onPress={handleSave}
                    disabled={isSaving}
                >
                    {isSaving ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <MaterialCommunityIcons name="content-save-outline" size={20} color="#fff" style={{marginRight: 8}}/>
                            <Text style={styles.saveButtonText}>GUARDAR CAMBIOS</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>

        </KeyboardAvoidingView>
    );
}

// --- SUBCOMPONENTES ---
const InputLabel = ({label, icon}: {label: string, icon?: any}) => (
  <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginTop: 12}}>
      {icon && <MaterialCommunityIcons name={icon} size={16} color={Colors.textSecondary} style={{marginRight: 6}} />}
      <Text style={{fontSize: 13, fontWeight: 'bold', color: Colors.textSecondary, textTransform: 'uppercase'}}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8f9fa' },
    center: { justifyContent: 'center', alignItems: 'center' },
    
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#eee'
    },
    backButton: { padding: 4 },
    screenTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
    
    scrollContent: { padding: 20, paddingBottom: 100 },

    idCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#e8f5e9', padding: 16, borderRadius: 12, marginBottom: 20,
        borderWidth: 1, borderColor: '#c8e6c9'
    },
    labelId: { fontSize: 10, color: '#2e7d32', fontWeight: 'bold' },
    textId: { fontSize: 18, fontWeight: 'bold', color: '#1b5e20', fontFamily: 'monospace' },

    formSection: {
        backgroundColor: '#fff', padding: 20, borderRadius: 16, elevation: 2,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5
    },
    sectionHeader: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 5 },
    
    input: { 
        backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, 
        paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#333' 
    },
    row: { flexDirection: 'row' },
    divider: { height: 1, backgroundColor: '#eee', marginVertical: 20 },

    gpsButton: { 
        flexDirection: 'row', alignItems: 'center', alignSelf: 'center', 
        marginTop: 15, padding: 10, borderWidth: 1, borderColor: Colors.primary, borderRadius: 8,
        backgroundColor: '#e3f2fd'
    },
    gpsButtonText: { color: Colors.primary, fontWeight: 'bold', marginLeft: 6 },

    footer: { 
        position: 'absolute', bottom: 0, left: 0, right: 0, 
        backgroundColor: '#fff', padding: 16, 
        borderTopWidth: 1, borderTopColor: '#eee', elevation: 10
    },
    saveButton: { 
        backgroundColor: Colors.primary, padding: 16, borderRadius: 12, 
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
        shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4
    },
    saveButtonDisabled: { backgroundColor: '#ccc', elevation: 0 },
    saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 0.5 },
});