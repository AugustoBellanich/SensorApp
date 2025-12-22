import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface ElectrodeCardProps {
  number: 1 | 2 | 3;
  depthCm: number;
  // Permitimos undefined para cuando la app inicia y aún no hay datos
  voltageMv: number | undefined; 
  volumetricMoisture: number | undefined; 
  gravimetricMoisture?: number | undefined; 
  isCalibrated: boolean;
  texture: string;
  onCalibratePress: () => void;
  disabled?: boolean;
  isNoData?: boolean;
}

export default function ElectrodeCard({
  number,
  depthCm,
  voltageMv,
  volumetricMoisture,
  gravimetricMoisture = 0,
  isCalibrated,
  texture,
  onCalibratePress,
  disabled,
  isNoData = false,
}: ElectrodeCardProps) {
  
  // Lógica para detectar si realmente no hay dato (undefined o isNoData explícito)
  const hasData = typeof volumetricMoisture === 'number' && !isNoData;

  // Colores dinámicos según humedad
  const getMoistureColor = (val: number | undefined) => {
    if (!hasData || val === undefined) return '#ccc'; 
    if (!isCalibrated) return '#999';
    if (val < 10) return '#e21e08ff'; 
    if (val < 30) return '#eede04ff'; 
    return '#098a3fff'; 
  };

  return (
    <View style={styles.card}>
      {/* HEADER: Número y Profundidad */}
      <View style={styles.header}>
        <View style={styles.badgeContainer}>
          <View style={[styles.badge, { backgroundColor: Colors.primary }]}>
            <Text style={styles.badgeText}>E{number}</Text>
          </View>
          <Text style={styles.depthText}>{depthCm > 0 ? `${depthCm} cm` : '-- cm'}</Text>
        </View>
        
        {/* Botón Calibrar */}
        <TouchableOpacity onPress={onCalibratePress} disabled={disabled}>
          <MaterialCommunityIcons 
            name="tune" 
            size={20} 
            color={disabled ? '#ccc' : Colors.primary} 
          />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* COLUMNA IZQUIERDA: DATOS PRINCIPALES (Hv) */}
        <View style={styles.mainData}>
          <Text style={styles.label}>Humedad Volumétrica</Text>
          <View style={styles.valueContainer}>
            <MaterialCommunityIcons 
              name="water-percent" 
              size={32} 
              color={getMoistureColor(volumetricMoisture)} 
            />
            <Text style={[
              styles.valueText, 
              { color: !hasData ? '#ccc' : Colors.textPrimary, fontWeight: 'bold' }
            ]}>
              {/* LÓGICA DISPLAY SEGURA: ?. evita el crash si es undefined */}
              {!hasData ? "--" : (isCalibrated ? volumetricMoisture?.toFixed(1) ?? "--" : "--")}
              {hasData && <Text style={styles.unitText}>%</Text>}
            </Text>
          </View>
          
          {/* NUEVO: DATO SECUNDARIO (Hg) */}
          <View style={styles.secondaryRow}>
             <Text style={styles.secondaryLabel}>Gravimétrica (Hg): </Text>
             <Text style={styles.secondaryValue}>
                {!hasData ? "--" : (isCalibrated ? gravimetricMoisture?.toFixed(1) ?? "--" : "--")} %
             </Text>
          </View>
        </View>

        {/* COLUMNA DERECHA: INFO TÉCNICA */}
        <View style={styles.techData}>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Voltaje</Text>
            <Text style={styles.techValue}>
                {!hasData ? "--" : voltageMv?.toFixed(0) ?? "--"} mV
            </Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Suelo</Text>
            <Text style={styles.techValue} numberOfLines={1}>{texture}</Text>
          </View>
          {!isCalibrated && hasData && (
            <View style={styles.warningContainer}>
              <Text style={styles.warningText}>Sin Calibrar</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    paddingBottom: 8
  },
  badgeContainer: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8
  },
  badgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  depthText: { fontWeight: '600', color: '#555' },
  
  body: { flexDirection: 'row' },
  
  mainData: { flex: 1.2, paddingRight: 10, borderRightWidth: 1, borderRightColor: '#f0f0f0' },
  label: { fontSize: 11, color: '#999', textTransform: 'uppercase', marginBottom: 4 },
  valueContainer: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 }, 
  
  valueText: { 
      fontSize: 34, 
      fontWeight: 'bold', 
      lineHeight: 38,
      marginLeft: 4 
  }, 
  unitText: { fontSize: 16, marginBottom: 6, color: '#999', fontWeight: 'normal' },

  secondaryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  secondaryLabel: { fontSize: 12, color: '#777' },
  secondaryValue: { fontSize: 13, fontWeight: 'bold', color: '#555' },

  techData: { flex: 0.8, paddingLeft: 12, justifyContent: 'center' },
  techItem: { marginBottom: 8 },
  techLabel: { fontSize: 10, color: '#aaa' },
  techValue: { fontSize: 14, fontWeight: '600', color: '#333' },
  warningContainer: { backgroundColor: '#fff3cd', padding: 4, borderRadius: 4, alignItems: 'center', marginTop: 4 },
  warningText: { color: '#856404', fontSize: 10, fontWeight: 'bold' }
});