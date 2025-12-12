import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../../../components/global/SegmentedControl';
import { Colors } from '../../../constants/Colors';

// --- DB & LÓGICA CENTRAL ---
import { getSensorById, saveSensor } from '../../../database/SensorRepository';
// ¡IMPORTANTE! Importamos CalibrationPoint (numérico)
import { CalibrationPoint, ElectrodeCalibration } from '../../../database/types';
import { generateCalibrationEquations } from '../../../utils/calibration';

// --- TIPOS LOCALES (para inputs de la UI, con valores STRING) ---
// Mantenemos esta interfaz aquí, ya que maneja los datos de entrada (strings)
interface LocalCalibrationPoint {
  id: string;
  type: 'PMP' | 'CC' | 'SAT' | 'EXTRA';
  labelShort: string; 
  description: string; 
  hv: string;     // Humedad Volumétrica (STRING)
  hg: string;     // Humedad Gravimétrica (STRING)
  mv: string;     // Voltaje Crudo (STRING)
  isFixed: boolean; 
}

interface LocalElectrodeConfig {
  depth: string;
  texture: string;
  density: string; // Densidad aparente
  points: LocalCalibrationPoint[];
}

const TEXTURES = [
  'Arenoso', 'Franco Arenoso', 'Franco', 'Franco Limoso', 
  'Limoso', 'Franco Arcilloso', 'Arcillo Arenoso', 'Arcilloso'
];

// FUNCIONES CREADAS PARA INICIALIZAR (sin "valores de ejemplo")
const createDefaultPoints = (): LocalCalibrationPoint[] => [
  { id: 'PMP', type: 'PMP', labelShort: 'PMP', description: 'Punto de Marchitez', hv: '', hg: '', mv: '', isFixed: true },
  { id: 'CC',  type: 'CC',  labelShort: 'CC',  description: 'Capacidad de Campo', hv: '', hg: '', mv: '', isFixed: true },
  { id: 'SAT', type: 'SAT', labelShort: 'SAT', description: 'Saturación',         hv: '', hg: '', mv: '', isFixed: true },
];
const createDefaultElectrode = (depth = ''): LocalElectrodeConfig => ({
    depth: depth, 
    texture: 'Franco', 
    density: '', 
    points: createDefaultPoints() 
});

export default function CalibrationScreen() {
  const { id, electrode: electrodeParam } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const initialElectrodeIndex = electrodeParam ? parseInt(Array.isArray(electrodeParam) ? electrodeParam[0] : electrodeParam) - 1 : 0;
  
  const [activeTab, setActiveTab] = useState(initialElectrodeIndex >= 0 && initialElectrodeIndex <= 2 ? initialElectrodeIndex : 0);
  const [showTextureModal, setShowTextureModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // <-- Cambiado: no precargamos "ejemplos". Se cargan desde DB o se crean defaults vacíos al inicio.
  const [electrodes, setElectrodes] = useState<LocalElectrodeConfig[]>([]);

  // Helper para asegurar que existan 3 electrodos en el estado (sin valores de ejemplo)
  const ensureThreeElectrodes = (arr: LocalElectrodeConfig[]) => {
    const copy = [...arr];
    while (copy.length < 3) copy.push(createDefaultElectrode(''));
    return copy.slice(0,3);
  };

  const currentElec = electrodes[activeTab] || createDefaultElectrode();

  // --- HELPER: Normalizar entrada (Coma a Punto) ---
  const cleanNumber = (text: string) => {
    return text.replace(',', '.').replace(/[^0-9.]/g, '');
  };
  
  // 1. CARGA DE DATOS DESDE SQLITE
  useEffect(() => {
    const loadCalibrationData = async () => {
        const sensor = await getSensorById(sensorId);
        if (sensor && sensor.config_json) {
            try {
                const config = JSON.parse(sensor.config_json);
                const dbCalibrations = config.calibration?.electrodes;

                if (dbCalibrations && Array.isArray(dbCalibrations)) {
                    const loadedElectrodes: LocalElectrodeConfig[] = dbCalibrations.map((dbElec: ElectrodeCalibration) => ({
                        depth: dbElec.depth?.toString() ?? '',
                        texture: dbElec.texture ?? 'Franco',
                        density: dbElec.density?.toString() ?? '',
                        // Mapeo de CalibrationPoint (number) a LocalCalibrationPoint (string)
                        points: (dbElec.points || []).map((p: CalibrationPoint) => ({
                            id: p.id,
                            type: p.type,
                            labelShort: p.labelShort,
                            description: p.description,
                            hv: p.hv != null ? p.hv.toString() : '',
                            hg: p.hg != null ? p.hg.toString() : '',
                            mv: p.mv != null ? p.mv.toString() : '',
                            isFixed: !!p.isFixed
                        })),
                    }));
                    setElectrodes(ensureThreeElectrodes(loadedElectrodes));
                } else {
                    // No hay calibraciones en DB -> dejamos electrodos con defaults vacíos (sin "ejemplos")
                    setElectrodes(ensureThreeElectrodes([]));
                }
            } catch (e) {
                console.error("Error al parsear calibración de DB", e);
                setElectrodes(ensureThreeElectrodes([]));
            }
        } else {
            // Sensor no tiene config -> dejamos electrodos vacíos
            setElectrodes(ensureThreeElectrodes([]));
        }
        setLoading(false);
    };
    
    if (sensorId) loadCalibrationData();
  }, [sensorId]);


  // --- HANDLERS ---
  
  const updateProp = (field: keyof LocalElectrodeConfig, rawValue: string) => {
    const value = (field === 'depth' || field === 'density') ? cleanNumber(rawValue) : rawValue;
    const newElectrodes = [...electrodes];
    newElectrodes[activeTab] = { ...ensureThreeElectrodes(newElectrodes)[activeTab], [field]: value } as LocalElectrodeConfig;
    setElectrodes(newElectrodes);
  };

  const handlePointChange = (pointId: string, field: 'hv' | 'hg' | 'mv', rawText: string) => {
    const value = cleanNumber(rawText);

    const newElectrodes = [...electrodes];
    const points = (newElectrodes[activeTab]?.points || []);
    const pointIndex = points.findIndex(p => p.id === pointId);
    if (pointIndex === -1) return;

    const point = { ...points[pointIndex] };
    const da = parseFloat(currentElec.density);

    // 2. Actualizar valor directo
    point[field] = value;

    // 3. Auto-Cálculo (Hv <-> Hg)
    if (!isNaN(da) && da > 0 && value !== '') {
      const valNum = parseFloat(value);
      if (!isNaN(valNum)) {
        if (field === 'hv') {
          point.hg = (valNum / da).toFixed(1);
        } else if (field === 'hg') {
          point.hv = (valNum * da).toFixed(1);
        }
      } else {
          if (field === 'hv') point.hg = '';
          else if (field === 'hg') point.hv = '';
      }
    } else if (value === '') {
        if (field === 'hv') point.hg = '';
        else if (field === 'hg') point.hv = '';
    }

    points[pointIndex] = point;
    newElectrodes[activeTab] = { ...ensureThreeElectrodes(newElectrodes)[activeTab], points } as LocalElectrodeConfig;
    setElectrodes(newElectrodes);
  };


  const addPoint = () => {
    const newElectrodes = [...electrodes];
    const idx = activeTab;
    const base = ensureThreeElectrodes(newElectrodes);
    const newId = `EXTRA-${Date.now()}`;
    const nextLabelIndex = (base[idx]?.points?.filter(p => p.type === 'EXTRA').length || 0) + 1;
    const newPoint: LocalCalibrationPoint = {
      id: newId,
      type: 'EXTRA',
      labelShort: `P${nextLabelIndex}`,
      description: 'Punto Intermedio',
      hv: '', hg: '', mv: '',
      isFixed: false
    };
    base[idx].points = [...(base[idx].points || []), newPoint];
    setElectrodes(base);
  };

  const removePoint = (pointId: string) => {
    const newElectrodes = [...electrodes];
    const base = ensureThreeElectrodes(newElectrodes);
    base[activeTab].points = base[activeTab].points.filter(p => p.id !== pointId);
    setElectrodes(base);
  };
  
  // 4. GUARDADO PRINCIPAL (AHORA: solo reemplaza el electrodo activo en el config_json)
  const handleSave = async () => {
    if (!sensorId) return;

    const elect = ensureThreeElectrodes(electrodes)[activeTab];

    // 0. Validaciones específicas: PMP y CC deben existir y tener datos (para asegurar dos segmentos)
    const pmp = elect.points.find(p => p.id === 'PMP');
    const cc = elect.points.find(p => p.id === 'CC');

    if (!pmp || !cc) {
      Alert.alert('Error de Referencias', 'Los puntos PMP y CC deben existir en la curva.');
      return;
    }

    const pmpMv = parseFloat(pmp.mv || '0');
    const pmpHv = parseFloat(pmp.hv || '0');
    const ccMv = parseFloat(cc.mv || '0');
    const ccHv = parseFloat(cc.hv || '0');

    if (!(pmpMv > 0 && pmpHv > 0 && ccMv > 0 && ccHv > 0)) {
      Alert.alert('Error de Curva', 'Complete PMP y CC con valores válidos (mV y %Vol > 0) para generar al menos dos segmentos.');
      return;
    }

    // 1. Validar Puntos y Densidad
    const validMvCount = elect.points.filter(p => parseFloat(p.mv || '0') > 0 && parseFloat(p.hv || '0') > 0).length;

    if (validMvCount < 2) {
        Alert.alert("Error de Curva", "Necesita al menos dos puntos (MV y %Vol) con valores válidos para crear la curva.");
        return;
    }
    if (!parseFloat(elect.density) || parseFloat(elect.density) <= 0) {
         Alert.alert("Error de Densidad", "La Densidad Aparente debe ser un valor positivo válido.");
         return;
    }

    // 2. Ejecutar la Lógica de Ecuaciones
    // Mapear el estado de string (UI) a CalibrationPoint (number)
    const dbPoints: CalibrationPoint[] = elect.points
        .map(p => ({
            ...p,
            hv: parseFloat(p.hv) || 0,
            hg: parseFloat(p.hg) || 0,
            mv: parseFloat(p.mv) || 0,
        }))
        .filter(p => p.mv > 0 && p.hv > 0) as CalibrationPoint[]; // El filtro asegura que son válidos
    
    const equations = generateCalibrationEquations(dbPoints); // <--- Lógica de segmentos

    if (equations.length === 0) {
        Alert.alert("Error", "No se pudieron generar las ecuaciones. Verifique que los MV no sean idénticos.");
        return;
    }

    // 3. Preparar la estructura a guardar en el config_json
    try {
        const sensor = await getSensorById(sensorId);
        if (sensor) {
            let config: any = {};
            if (sensor.config_json) config = JSON.parse(sensor.config_json);

            const existingElectrodes: ElectrodeCalibration[] = (config.calibration && Array.isArray(config.calibration.electrodes)) ? config.calibration.electrodes : [];

            // Aseguramos un array con 3 posiciones
            const merged = [...existingElectrodes];
            while (merged.length < 3) merged.push({ depth: 0, texture: 'Franco', density: 0, points: [], equations: [] });

            // Solo reemplazamos el electrodo activo
            merged[activeTab] = {
                depth: parseFloat(elect.depth) || 0,
                texture: elect.texture,
                density: parseFloat(elect.density) || 0,
                points: dbPoints,
                equations: equations
            } as ElectrodeCalibration;

            const newConfig = {
                ...config,
                calibration: {
                    electrodes: merged
                }
            };

            await saveSensor({
                ...sensor,
                config_json: JSON.stringify(newConfig)
            });

            // Formateamos SOLO el electrodo activo en la UI para mostrar valores "limpios"
            setElectrodes(prev => {
                const arr = ensureThreeElectrodes(prev);
                arr[activeTab] = {
                    ...arr[activeTab],
                    points: arr[activeTab].points.map(p => ({
                        ...p,
                        hv: (parseFloat(p.hv || '0') || 0).toFixed(1),
                        hg: (parseFloat(p.hg || '0') || 0).toFixed(1),
                        mv: (parseFloat(p.mv || '0') || 0).toFixed(0)
                    }))
                };
                return arr;
            });

            Alert.alert("Éxito", `Curva y ${equations.length} segmentos guardados localmente para Electrodo ${activeTab + 1}.\n(Pendiente de sincronizar a la nube)`);
        }
    } catch (error) {
        Alert.alert("Error", "No se pudo guardar la calibración.");
        console.error("Error guardando calibración:", error);
    }
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calibración de Suelo</Text>
        <View style={{width: 40}} />
      </View>

      <View style={styles.content}>
        <SegmentedControl 
          options={['Electrodo 1', 'Electrodo 2', 'Electrodo 3']} 
          selectedIndex={activeTab} 
          onChange={setActiveTab} 
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 100}}>
            
            {/* 1. PROPIEDADES FÍSICAS */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Propiedades Físicas</Text>
              <View style={styles.propsRow}>
                <View style={{flex: 1, marginRight: 10}}>
                  <Text style={styles.label}>Profundidad (cm)</Text>
                  <TextInput 
                    style={[styles.input, {textAlign: 'center'}]} // <--- UX: Centrado
                    keyboardType="numeric"
                    value={currentElec.depth}
                    onChangeText={(t) => updateProp('depth', t)}
                  />
                </View>
                <View style={{flex: 1}}>
                  <Text style={styles.label}>Densidad (g/cm³)</Text>
                  <TextInput 
                    style={[styles.input, {textAlign: 'center'}]} // <--- UX: Centrado
                    keyboardType="numeric"
                    placeholder="1.25"
                    value={currentElec.density}
                    onChangeText={(t) => updateProp('density', t)}
                  />
                </View>
              </View>

              <Text style={styles.label}>Textura del Suelo</Text>
              <TouchableOpacity style={styles.selector} onPress={() => setShowTextureModal(true)}>
                <Text style={styles.selectorText}>{currentElec.texture}</Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* 2. REFERENCIAS (GLOSARIO) */}
            <View style={styles.legendContainer}>
              <Text style={styles.legendTitle}>Referencias:</Text>
              <View style={styles.legendRow}>
                <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>PMP:</Text> Punto de Marchitez</Text>
                <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>CC:</Text> Capacidad Campo</Text>
              </View>
              <View style={styles.legendRow}>
                <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>SAT:</Text> Saturación</Text>
                <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>mV:</Text> Voltaje Crudo</Text>
              </View>
            </View>

            {/* 3. TABLA DE CALIBRACIÓN */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Curva de Calibración</Text>
              
              {/* HEADERS TABLA */}
              <View style={styles.tableHeader}>
                <Text style={[styles.colHeader, {width: 40}]}>Ref.</Text>
                <Text style={[styles.colHeader, {flex: 1}]}>%Vol</Text>
                <Text style={[styles.colHeader, {flex: 1}]}>%Grav</Text>
                <Text style={[styles.colHeader, {flex: 1}]}>mV</Text>
                <View style={{width: 30}} />
              </View>

              {/* FILAS */}
              {currentElec.points.map((point) => (
                <View key={point.id} style={styles.tableRow}>
                  {/* Etiqueta Corta (PMP, CC) */}
                  <View style={{width: 40, justifyContent: 'center'}}>
                    <Text style={[styles.rowLabel, !point.isFixed && {color: Colors.textSecondary}]}>
                      {point.labelShort}
                    </Text>
                  </View>

                  {/* Input Hv */}
                  <TextInput 
                    style={[styles.cellInput, {flex: 1, textAlign: 'center'}]} // <--- UX: Centrado
                    keyboardType="numeric"
                    placeholder="%"
                    value={point.hv}
                    onChangeText={(t) => handlePointChange(point.id, 'hv', t)}
                  />

                  {/* Input Hg */}
                  <TextInput 
                    style={[styles.cellInput, {flex: 1, textAlign: 'center'}]} // <--- UX: Centrado
                    keyboardType="numeric"
                    placeholder="%"
                    value={point.hg}
                    onChangeText={(t) => handlePointChange(point.id, 'hg', t)}
                  />

                  {/* Input mV */}
                  <TextInput 
                    style={[styles.cellInput, {flex: 1, backgroundColor: '#f0f7ff', borderColor: '#d0e5ff', textAlign: 'center'}]} // <--- UX: Centrado
                    keyboardType="numeric"
                    placeholder="mV"
                    value={point.mv}
                    onChangeText={(t) => handlePointChange(point.id, 'mv', t)}
                  />

                  {/* Borrar */}
                  <View style={{width: 30, alignItems: 'center', justifyContent: 'center'}}>
                    {!point.isFixed ? (
                      <TouchableOpacity onPress={() => removePoint(point.id)}>
                        <MaterialCommunityIcons name="trash-can-outline" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    ) : (
                      <View style={{width: 20}} />
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addButton} onPress={addPoint}>
                <MaterialCommunityIcons name="plus" size={20} color={Colors.primary} />
                <Text style={styles.addButtonText}>Agregar Punto Intermedio</Text>
              </TouchableOpacity>
            </View>

            {/* 4. BOTÓN GUARDAR (PRINCIPAL) */}
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <MaterialCommunityIcons name="content-save" size={22} color="#fff" style={{marginRight:8}} />
              <Text style={styles.saveButtonText}>GUARDAR CURVA</Text>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {/* MODAL TEXTURA (Igual que el original) */}
      <Modal visible={showTextureModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleccionar Textura</Text>
            {TEXTURES.map(tex => (
              <TouchableOpacity 
                key={tex} 
                style={styles.modalItem}
                onPress={() => {
                  updateProp('texture', tex);
                  setShowTextureModal(false);
                }}
              >
                <Text style={styles.modalItemText}>{tex}</Text>
                {currentElec.texture === tex && (
                  <MaterialCommunityIcons name="check" size={20} color={Colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowTextureModal(false)}>
              <Text style={{color: '#fff', fontWeight: 'bold'}}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
    // ... estilos, manteniendo los originales y añadiendo 'textAlign: center' a los inputs relevantes
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', elevation: 2
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  content: { flex: 1, padding: 16 },
  
  section: { backgroundColor: '#fff', padding: 16, borderRadius: 10, marginBottom: 15, elevation: 1 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.primary, marginBottom: 12 },
  label: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4, fontWeight: '600' },
  
  propsRow: { flexDirection: 'row', marginBottom: 10 },
  input: { 
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, fontSize: 16, color: '#000',
    backgroundColor: '#fff', height: 45, 
  },
  selector: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, height: 45,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  selectorText: { fontSize: 16, color: '#000' },

  // GLOSARIO / REFERENCIAS
  legendContainer: { marginBottom: 15, paddingHorizontal: 4 },
  legendTitle: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary, marginBottom: 4 },
  legendRow: { flexDirection: 'row', gap: 15, marginBottom: 2 },
  legendItem: { fontSize: 12, color: Colors.textSecondary },

  // TABLA MEJORADA
  tableHeader: { flexDirection: 'row', marginBottom: 8, paddingHorizontal: 0 },
  colHeader: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary, textAlign: 'center' },
  
  tableRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  rowLabel: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  
  cellInput: { 
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 0, marginHorizontal: 4,
    textAlign: 'center', fontSize: 15, height: 40, color: '#000' // <--- CENTRADO AQUÍ
  },
  
  addButton: { 
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', 
    padding: 12, borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed', borderRadius: 8, marginTop: 5 
  },
  addButtonText: { color: Colors.primary, fontWeight: 'bold', marginLeft: 8 },

  // BOTÓN GUARDAR GRANDE
  saveButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginTop: 10,
    marginBottom: 20,
    elevation: 3
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },

  // MODAL
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  modalItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalItemText: { fontSize: 16 },
  closeButton: { backgroundColor: Colors.textSecondary, padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 20 }
});
