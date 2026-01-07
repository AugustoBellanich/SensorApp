import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- COMPONENTES ---
import SegmentedControl from '../../../components/global/SegmentedControl';
import { Colors } from '../../../constants/Colors';

// --- DB & LÓGICA ---
// Eliminamos saveSensor y getSensorById porque ya no tocamos la tabla sensors aquí
import { syncService } from '@/services/syncService';
import { getElectrodesBySensor, saveElectrode } from '../../../database/ElectrodeRepository';
import { CalibrationPoint, ElectrodeEntity } from '../../../database/types';
import { generateCalibrationEquations } from '../../../utils/calibration';

// --- TIPOS LOCALES ---
interface LocalCalibrationPoint {
  id: string;
  type: 'PMP' | 'CC' | 'SAT' | 'EXTRA';
  labelShort: string; 
  description: string; 
  hv: string;
  hg: string;
  mv: string;
  isFixed: boolean; 
}

interface LocalElectrodeConfig {
  depth: string;
  texture: string;
  density: string; 
  points: LocalCalibrationPoint[];
}

const TEXTURES = [
  'Arenoso', 'Franco Arenoso', 'Franco', 'Franco Limoso', 
  'Limoso', 'Franco Arcilloso', 'Arcillo Arenoso', 'Arcilloso'
];

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
  const [electrodes, setElectrodes] = useState<LocalElectrodeConfig[]>([]);

  // Asegura siempre 3 elementos en el array visual
  const ensureThreeElectrodes = (arr: LocalElectrodeConfig[]) => {
    const copy = [...arr];
    while (copy.length < 3) copy.push(createDefaultElectrode(''));
    return copy.slice(0,3);
  };

  const currentElec = electrodes[activeTab] || createDefaultElectrode();

  const cleanNumber = (text: string) => {
    const cleaned = text.replace(',', '.').replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return parts[0] + '.' + parts.slice(1).join('');
    return cleaned;
  };
  
  // ===========================================================================
  // 1. CARGA INICIAL (DESDE TABLA DEVICE_ELECTRODES)
  // ===========================================================================
  useEffect(() => {
    const loadCalibrationData = async () => {
        console.log(`[CALIB-LOAD] Cargando electrodos desde SQLite para: ${sensorId}`);
        
        try {
            // Leemos solo de la tabla correcta
            const dbElectrodes = await getElectrodesBySensor(sensorId);
            
            if (dbElectrodes.length > 0) {
                console.log(`[CALIB-LOAD] Encontrados ${dbElectrodes.length} registros en device_electrodes.`);
                
                const tempElectrodes = [createDefaultElectrode(), createDefaultElectrode(), createDefaultElectrode()];

                dbElectrodes.forEach((dbElec) => {
                    const idx = dbElec.electrode_index - 1;
                    if (idx >= 0 && idx < 3) {
                        let parsedPoints: CalibrationPoint[] = [];
                        try {
                            parsedPoints = JSON.parse(dbElec.points_json || '[]');
                        } catch { parsedPoints = []; }

                        tempElectrodes[idx] = {
                            depth: dbElec.depth?.toString() ?? '',
                            texture: dbElec.texture ?? 'Franco',
                            density: dbElec.density?.toString() ?? '',
                            points: parsedPoints.map((p) => ({
                                id: p.id,
                                type: p.type,
                                labelShort: p.labelShort,
                                description: p.description,
                                hv: p.hv != null ? p.hv.toString() : '',
                                hg: p.hg != null ? p.hg.toString() : '',
                                mv: p.mv != null ? p.mv.toString() : '',
                                isFixed: !!p.isFixed
                            }))
                        };
                    }
                });
                
                setElectrodes(tempElectrodes);
            } else {
                console.log("[CALIB-LOAD] No hay registros en device_electrodes. Usando defaults.");
                setElectrodes(ensureThreeElectrodes([]));
            }
        } catch (e) {
            console.error("[CALIB-ERROR] Error cargando electrodos:", e);
            setElectrodes(ensureThreeElectrodes([]));
        } finally {
            setLoading(false);
        }
    };
    
    if (sensorId) loadCalibrationData();
  }, [sensorId]);


  // --- HANDLERS (Iguales que antes) ---
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

    point[field] = value;

    if (!isNaN(da) && da > 0 && value !== '') {
      const valNum = parseFloat(value);
      if (!isNaN(valNum)) {
        if (field === 'hv') {
          point.hg = (valNum / da).toFixed(1);
        } else if (field === 'hg') {
          point.hv = (valNum * da).toFixed(1);
        }
      }
    } else if (value === '') {
        if (field === 'hv') point.hg = '';
        if (field === 'hg') point.hv = '';
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
      id: newId, type: 'EXTRA', labelShort: `P${nextLabelIndex}`, description: 'Punto Intermedio', hv: '', hg: '', mv: '', isFixed: false
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
  
  // ===========================================================================
  // 4. GUARDAR (DB LOCAL + EMPUJAR A NUBE)
  // ===========================================================================
  const handleSave = async () => {
    if (!sensorId) return;
    
    const currentIdx = activeTab + 1;
    console.log(`[CALIB-SAVE] Guardando Electrodo ${currentIdx} (Tab: ${activeTab})`);

    const elect = ensureThreeElectrodes(electrodes)[activeTab];

    // --- Validaciones (Igual que antes) ---
    const pmp = elect.points.find(p => p.id === 'PMP');
    const cc = elect.points.find(p => p.id === 'CC');

    if (!pmp || !cc) { Alert.alert('Error', 'Faltan los puntos PMP o CC.'); return; }
    const pmpMv = parseFloat(pmp.mv || '0');
    const ccMv = parseFloat(cc.mv || '0');

    if (pmpMv <= 0 || ccMv <= 0) { Alert.alert('Datos Incompletos', 'PMP y CC deben tener un voltaje (mV) válido > 0.'); return; }
    if (!parseFloat(elect.density) || parseFloat(elect.density) <= 0) { Alert.alert("Dato Requerido", "Ingrese la Densidad Aparente."); return; }

    // --- Preparar datos limpios ---
    const dbPoints: CalibrationPoint[] = elect.points
        .map(p => ({
            ...p,
            hv: parseFloat(p.hv) || 0,
            hg: parseFloat(p.hg) || 0,
            mv: parseFloat(p.mv) || 0,
        }))
        .filter(p => p.mv > 0 && p.hv > 0) as CalibrationPoint[];
    
    const equations = generateCalibrationEquations(dbPoints);
    if (equations.length === 0) { Alert.alert("Error Matemático", "No se pudo generar la curva. Verifique voltajes distintos."); return; }

    setLoading(true); // Bloqueamos UI

    try {
        const uniqueElecId = `${sensorId}_E${currentIdx}`;
        const now = new Date().toISOString();
        
        const electrodeEntity: ElectrodeEntity = {
            id: uniqueElecId,
            sensor_id: sensorId,
            electrode_index: currentIdx,
            depth: parseFloat(elect.depth) || 0,
            texture: elect.texture,
            density: parseFloat(elect.density) || 0,
            points_json: JSON.stringify(dbPoints),
            equations_json: JSON.stringify(equations),
            is_synced: 0, // <--- CRUCIAL: Marcar como "sucio" para subir
            updated_at: now
        };

        // 1. Guardar Localmente
        await saveElectrode(electrodeEntity);
        console.log(`[CALIB-SAVE] Éxito guardando ${uniqueElecId} localmente.`);

        // 2. Intentar subir a Nube inmediatamente
        const isOnline = await syncService.isOnline();
        if (isOnline) {
             console.log("[CALIB-SAVE] Internet detectado. Subiendo...");
             await syncService.pushChanges();
        }

        // 3. Actualizar UI Visual
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

        Alert.alert(
            "Calibración Guardada", 
            isOnline ? "Curva generada y sincronizada con la nube." : "Curva guardada en el celular. Se subirá cuando tengas conexión."
        );

    } catch (error) {
        console.error("[CALIB-ERROR] Falló el guardado:", error);
        Alert.alert("Error", "Fallo al guardar en base de datos.");
    } finally {
        setLoading(false);
    }
  };

  if (loading) {
    return (
        <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={Colors.primary} />
        </View>
    );
  }

  const isDensityMissing = !currentElec.density || parseFloat(currentElec.density) <= 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calibración</Text>
        <View style={{width: 40}} />
      </View>

      <View style={styles.content}>
        <SegmentedControl 
          options={['E1', 'E2', 'E3']} 
          selectedIndex={activeTab} 
          onChange={setActiveTab} 
        />

        <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
            style={{flex:1}}
        >
          <ScrollView 
            showsVerticalScrollIndicator={false} 
            contentContainerStyle={{paddingBottom: 100}}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Suelo y Textura</Text>
              <View style={styles.propsRow}>
                <View style={{flex: 1, marginRight: 10}}>
                  <Text style={styles.label}>Profundidad (cm)</Text>
                  <TextInput 
                    style={[styles.input, styles.inputCenter]}
                    keyboardType="numeric"
                    value={currentElec.depth}
                    placeholder="20"
                    onChangeText={(t) => updateProp('depth', t)}
                  />
                </View>
                <View style={{flex: 1}}>
                  <Text style={[styles.label, isDensityMissing ? {color: Colors.warning} : {}]}>Densidad (g/cm³)*</Text>
                  <TextInput 
                    style={[styles.input, styles.inputCenter, isDensityMissing ? {borderColor: Colors.warning, borderWidth: 1.5} : {}]}
                    keyboardType="numeric"
                    placeholder="1.25"
                    value={currentElec.density}
                    onChangeText={(t) => updateProp('density', t)}
                  />
                </View>
              </View>
              <Text style={styles.label}>Textura</Text>
              <TouchableOpacity style={styles.selector} onPress={() => setShowTextureModal(true)}>
                <Text style={styles.selectorText}>{currentElec.texture}</Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.legendContainer}>
              <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>PMP:</Text> Marchitez</Text>
              <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>CC:</Text> Capacidad Campo</Text>
              <Text style={styles.legendItem}><Text style={{fontWeight:'bold'}}>mV:</Text> Milivoltios</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Puntos de Calibración</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.colHeader, {width: 45}]}>Ref</Text>
                <Text style={[styles.colHeader, {flex: 1}]}>% Vol</Text>
                <Text style={[styles.colHeader, {flex: 1}]}>% Grav</Text>
                <Text style={[styles.colHeader, {flex: 1}]}>mV</Text>
                <View style={{width: 30}} />
              </View>

              {currentElec.points.map((point) => (
                <View key={point.id} style={styles.tableRow}>
                  <View style={{width: 45, justifyContent: 'center'}}>
                    <Text style={[styles.rowLabel, !point.isFixed && {color: Colors.textSecondary}]}>
                      {point.labelShort}
                    </Text>
                  </View>
                  <TextInput 
                    style={[styles.cellInput, styles.inputCenter]}
                    keyboardType="numeric"
                    placeholder="%"
                    value={point.hv}
                    onChangeText={(t) => handlePointChange(point.id, 'hv', t)}
                  />
                  <TextInput 
                    style={[styles.cellInput, styles.inputCenter, {backgroundColor: '#fafafa'}]}
                    keyboardType="numeric"
                    placeholder="%"
                    value={point.hg}
                    onChangeText={(t) => handlePointChange(point.id, 'hg', t)}
                  />
                  <TextInput 
                    style={[styles.cellInput, styles.inputCenter, {backgroundColor: '#eef6ff', borderColor: '#cfe4ff'}]}
                    keyboardType="numeric"
                    placeholder="mV"
                    value={point.mv}
                    onChangeText={(t) => handlePointChange(point.id, 'mv', t)}
                  />
                  <View style={{width: 30, alignItems: 'center'}}>
                    {!point.isFixed && (
                      <TouchableOpacity onPress={() => removePoint(point.id)} hitSlop={{top:10, bottom:10, left:10, right:10}}>
                        <MaterialCommunityIcons name="close-circle" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addButton} onPress={addPoint}>
                <MaterialCommunityIcons name="plus" size={18} color={Colors.primary} />
                <Text style={styles.addButtonText}>Punto Intermedio</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>GUARDAR CURVA</Text>
              <MaterialCommunityIcons name="check" size={22} color="#fff" style={{marginLeft:8}} />
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <Modal visible={showTextureModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Textura del Suelo</Text>
            <ScrollView style={{maxHeight: 400}}>
                {TEXTURES.map(tex => (
                <TouchableOpacity 
                    key={tex} 
                    style={[styles.modalItem, currentElec.texture === tex && {backgroundColor: '#f0f9ff'}]}
                    onPress={() => {
                        updateProp('texture', tex);
                        setShowTextureModal(false);
                    }}
                >
                    <Text style={[styles.modalItemText, currentElec.texture === tex && {color: Colors.primary, fontWeight:'bold'}]}>{tex}</Text>
                    {currentElec.texture === tex && (
                        <MaterialCommunityIcons name="check" size={20} color={Colors.primary} />
                    )}
                </TouchableOpacity>
                ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowTextureModal(false)}>
              <Text style={styles.closeButtonText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  content: { flex: 1, padding: 16 },
  section: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.primary, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 12, color: Colors.textSecondary, marginBottom: 6, fontWeight: '600' },
  propsRow: { flexDirection: 'row', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 10, fontSize: 16, color: '#333', backgroundColor: '#fff', height: 48 },
  inputCenter: { textAlign: 'center' },
  selector: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 12, height: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff' },
  selectorText: { fontSize: 16, color: '#333' },
  legendContainer: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15, paddingHorizontal: 10 },
  legendItem: { fontSize: 12, color: Colors.textSecondary },
  tableHeader: { flexDirection: 'row', marginBottom: 8, paddingLeft: 45, paddingRight: 30 },
  colHeader: { fontSize: 11, fontWeight: 'bold', color: '#999', textAlign: 'center', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  rowLabel: { fontSize: 13, fontWeight: 'bold', color: Colors.textPrimary },
  cellInput: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 6, padding: 0, marginHorizontal: 4, fontSize: 15, height: 40, color: '#333', flex: 1 },
  addButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 12, marginTop: 5, borderRadius: 8, backgroundColor: '#f0f9ff' },
  addButtonText: { color: Colors.primary, fontWeight: 'bold', marginLeft: 6, fontSize: 14 },
  saveButton: { backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 16, borderRadius: 12, marginTop: 10, marginBottom: 30, elevation: 4, shadowColor: Colors.primary, shadowOpacity: 0.3 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center', color: Colors.textPrimary },
  modalItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  modalItemText: { fontSize: 16, color: '#444' },
  closeButton: { backgroundColor: '#f5f5f5', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  closeButtonText: { color: '#666', fontWeight: 'bold', fontSize: 16 }
});