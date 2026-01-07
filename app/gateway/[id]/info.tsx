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

import { Colors } from '../../../constants/Colors';
import { getSensorById, updateSensorLocal } from '../../../database/SensorRepository';
import { SensorEntity } from '../../../database/types';
import { syncService } from '../../../services/syncService';

export default function GatewayInfoScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const sensorId = Array.isArray(id) ? id[0] : id;
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [originalSensor, setOriginalSensor] = useState<SensorEntity | null>(null);

    // --- ESTADO INCLUYENDO ACTIVIDAD ---
    const [metadata, setMetadata] = useState({
        alias: '',
        location: '',
        activity: '', // <--- Nuevo campo
        lat: '',
        lng: '',
    });

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
                        activity: sensor.activity || '', // <--- Carga inicial
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

    const handleGetLocation = async () => {
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert("Permiso denegado", "Se necesita acceso a la ubicación.");
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setMetadata(prev => ({
                ...prev,
                lat: loc.coords.latitude.toString(),
                lng: loc.coords.longitude.toString()
            }));
        } catch {
            Alert.alert("Error GPS", "No se pudo obtener la ubicación.");
        }
    };

    const handleSave = async () => {
        if (!sensorId) return;
        setIsSaving(true);

        try {
            const latVal = parseFloat(metadata.lat) || 0;
            const lngVal = parseFloat(metadata.lng) || 0;
            const now = new Date().toISOString();

            // 1. Preparamos la entidad para SQLite incluyendo activity
            const updatedSensor: SensorEntity = {
                ...originalSensor!,
                id: sensorId,
                alias: metadata.alias,
                location: metadata.location,
                activity: metadata.activity, // <--- Guardado local
                lat: latVal,
                lng: lngVal,
                updated_at: now,
                is_synced: 0 
            };

            await updateSensorLocal(updatedSensor);

            // 2. Disparar sincronización en background
            syncService.pushChanges().catch(err => console.log("Sync diferido:", err));

            Alert.alert("Guardado", "Información actualizada localmente.");
            router.back();

        } catch {
            Alert.alert("Error", "No se pudo guardar la información.");
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

            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton} disabled={isSaving}>
                    <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.screenTitle}>Datos del Dispositivo</Text>
                <View style={{width: 24}} /> 
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.idCard}>
                   <MaterialCommunityIcons name="router-wireless" size={32} color={Colors.primary} />
                   <View style={{marginLeft: 12}}>
                        <Text style={styles.labelId}>ID GATEWAY</Text>
                        <Text style={styles.textId}>{sensorId}</Text>
                   </View>
                </View>

                <View style={styles.formSection}>
                    {/* ALIAS */}
                    <InputLabel label="Nombre / Alias" icon="tag-text-outline"/>
                    <TextInput 
                        style={styles.input} 
                        value={metadata.alias} 
                        placeholder="Ej: Nodo Principal"
                        onChangeText={(t) => setMetadata({...metadata, alias: t})}
                        editable={!isSaving}
                    />

                    {/* FINCA */}
                    <InputLabel label="Finca / Establecimiento" icon="map-marker-outline"/>
                    <TextInput 
                        style={styles.input} 
                        value={metadata.location} 
                        placeholder="Ej: Finca Los Olivos"
                        onChangeText={(t) => setMetadata({...metadata, location: t})}
                        editable={!isSaving}
                    />

                    {/* ACTIVIDAD - NUEVO CAMPO */}
                    <InputLabel label="Actividad / Cultivo" icon="sprout-outline"/>
                    <TextInput 
                        style={styles.input} 
                        value={metadata.activity} 
                        placeholder="Ej: Riego Goteo, Nogales, etc."
                        onChangeText={(t) => setMetadata({...metadata, activity: t})}
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
                        <MaterialCommunityIcons name="crosshairs-gps" size={20} color={Colors.primary} />
                        <Text style={styles.gpsButtonText}> Capturar GPS actual</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
                <TouchableOpacity 
                    style={[styles.saveButton, isSaving && styles.saveButtonDisabled]} 
                    onPress={handleSave}
                    disabled={isSaving}
                >
                    {isSaving ? <ActivityIndicator color="#fff" /> : (
                        <>
                            <MaterialCommunityIcons name="check-all" size={20} color="#fff" style={{marginRight: 8}}/>
                            <Text style={styles.saveButtonText}>CONFIRMAR CAMBIOS</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

// (Mismos componentes auxiliares y estilos de tu código previo...)
const InputLabel = ({label, icon}: {label: string, icon?: any}) => (
    <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginTop: 12}}>
        {icon && <MaterialCommunityIcons name={icon} size={16} color={Colors.textSecondary} style={{marginRight: 6}} />}
        <Text style={{fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary}}>{label}</Text>
    </View>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8f9fa' },
    center: { justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
    backButton: { padding: 4 },
    screenTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
    scrollContent: { padding: 20, paddingBottom: 100 },
    idCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3f2fd', padding: 16, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: '#bbdefb' },
    labelId: { fontSize: 10, color: Colors.primary, fontWeight: 'bold' },
    textId: { fontSize: 18, fontWeight: 'bold', color: '#0d47a1', fontFamily: 'monospace' },
    formSection: { backgroundColor: '#fff', padding: 20, borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
    sectionHeader: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 5 },
    input: { backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#333' },
    row: { flexDirection: 'row' },
    divider: { height: 1, backgroundColor: '#eee', marginVertical: 20 },
    gpsButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 15, padding: 10, borderWidth: 1, borderColor: Colors.primary, borderRadius: 8, backgroundColor: '#f0f7ff' },
    gpsButtonText: { color: Colors.primary, fontWeight: 'bold' },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
    saveButton: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
    saveButtonDisabled: { backgroundColor: '#ccc' },
    saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});