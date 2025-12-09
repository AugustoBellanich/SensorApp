import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../../../components/global/SegmentedControl';
import { Colors } from '../../../constants/Colors';

// --- TIPOS ---
interface CalibrationPoint {
  id: string;
  type: 'PMP' | 'CC' | 'SAT' | 'EXTRA';
  labelShort: string; // "PMP"
  description: string; // "Punto de Marchitez"
  hv: string;    
  hg: string;    
  mv: string;    
  isFixed: boolean; 
}

interface ElectrodeConfig {
  depth: string;
  texture: string;
  density: string; 
  points: CalibrationPoint[];
}

const TEXTURES = [
  'Arenoso', 'Franco Arenoso', 'Franco', 'Franco Limoso', 
  'Limoso', 'Franco Arcilloso', 'Arcillo Arenoso', 'Arcilloso'
];

export default function CalibrationScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState(0); 
  const [showTextureModal, setShowTextureModal] = useState(false);

  // --- HELPER: Normalizar entrada (Coma a Punto) ---
  const cleanNumber = (text: string) => {
    // Reemplaza comas por puntos y elimina caracteres no numéricos (salvo el punto)
    return text.replace(',', '.').replace(/[^0-9.]/g, '');
  };

  // ESTADO INICIAL
  const createDefaultPoints = (): CalibrationPoint[] => [
    { id: '1', type: 'PMP', labelShort: 'PMP', description: 'Punto de Marchitez', hv: '', hg: '', mv: '', isFixed: true },
    { id: '2', type: 'CC',  labelShort: 'CC',  description: 'Capacidad de Campo', hv: '', hg: '', mv: '', isFixed: true },
    { id: '3', type: 'SAT', labelShort: 'SAT', description: 'Saturación',         hv: '', hg: '', mv: '', isFixed: true },
  ];

  const [electrodes, setElectrodes] = useState<ElectrodeConfig[]>([
    { depth: '10', texture: 'Franco', density: '1.25', points: createDefaultPoints() },
    { depth: '30', texture: 'Franco', density: '1.30', points: createDefaultPoints() },
    { depth: '60', texture: 'Franco Arcilloso', density: '1.40', points: createDefaultPoints() },
  ]);

  const currentElec = electrodes[activeTab];

  // --- HANDLERS ---

  const updateProp = (field: keyof ElectrodeConfig, rawValue: string) => {
    // Si es numérico, limpiamos la coma
    const value = (field === 'depth' || field === 'density') ? cleanNumber(rawValue) : rawValue;
    
    const newElectrodes = [...electrodes];
    newElectrodes[activeTab] = { ...newElectrodes[activeTab], [field]: value };
    setElectrodes(newElectrodes);
  };

  const handlePointChange = (pointId: string, field: 'hv' | 'hg' | 'mv', rawText: string) => {
    // 1. Normalizar entrada (Coma -> Punto)
    const value = cleanNumber(rawText);

    const newElectrodes = [...electrodes];
    const points = newElectrodes[activeTab].points;
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
      }
    }

    points[pointIndex] = point;
    setElectrodes(newElectrodes);
  };

  const addPoint = () => {
    const newElectrodes = [...electrodes];
    newElectrodes[activeTab].points.push({
      id: Date.now().toString(),
      type: 'EXTRA',
      labelShort: 'Extra',
      description: 'Punto Intermedio',
      hv: '', hg: '', mv: '',
      isFixed: false
    });
    setElectrodes(newElectrodes);
  };

  const removePoint = (pointId: string) => {
    const newElectrodes = [...electrodes];
    newElectrodes[activeTab].points = newElectrodes[activeTab].points.filter(p => p.id !== pointId);
    setElectrodes(newElectrodes);
  };

  const handleSave = () => {
    // Ordenar puntos por mV antes de guardar
    const sortedPoints = [...currentElec.points].sort((a, b) => parseFloat(a.mv || '0') - parseFloat(b.mv || '0'));
    Alert.alert("Éxito", `Curva guardada para Electrodo ${activeTab + 1} con ${sortedPoints.length} puntos.`);
  };

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
                    style={styles.input} 
                    keyboardType="numeric"
                    value={currentElec.depth}
                    onChangeText={(t) => updateProp('depth', t)}
                  />
                </View>
                <View style={{flex: 1}}>
                  <Text style={styles.label}>Densidad (g/cm³)</Text>
                  <TextInput 
                    style={styles.input} 
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

            {/* 2. REFERENCIAS (GLOSARIO) - Nuevo */}
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
                    style={[styles.cellInput, {flex: 1}]}
                    keyboardType="numeric"
                    placeholder="%"
                    value={point.hv}
                    onChangeText={(t) => handlePointChange(point.id, 'hv', t)}
                  />

                  {/* Input Hg */}
                  <TextInput 
                    style={[styles.cellInput, {flex: 1}]}
                    keyboardType="numeric"
                    placeholder="%"
                    value={point.hg}
                    onChangeText={(t) => handlePointChange(point.id, 'hg', t)}
                  />

                  {/* Input mV */}
                  <TextInput 
                    style={[styles.cellInput, {flex: 1, backgroundColor: '#f0f7ff', borderColor: '#d0e5ff'}]}
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
                      // Espacio vacío para mantener alineación en filas fijas
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

            {/* 4. BOTÓN GUARDAR (PRINCIPAL) - Nuevo Ubicación */}
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <MaterialCommunityIcons name="content-save" size={22} color="#fff" style={{marginRight:8}} />
              <Text style={styles.saveButtonText}>GUARDAR CURVA</Text>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {/* MODAL TEXTURA */}
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
    backgroundColor: '#fff', height: 45 // Altura fija para evitar problemas
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
    textAlign: 'center', fontSize: 15, height: 40, color: '#000'
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