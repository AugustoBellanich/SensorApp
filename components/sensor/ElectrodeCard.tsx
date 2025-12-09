import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import { GlobalStyles } from '../../constants/GlobalStyles';

interface Props {
  number: 1 | 2 | 3;
  depthCm: number;
  volumetricMoisture: number;
  gravimetricMoisture?: number;
  voltageMv: number;
  isCalibrated: boolean;
  onCalibratePress: () => void;
}

export default function ElectrodeCard({
  number,
  depthCm,
  volumetricMoisture,
  gravimetricMoisture,
  voltageMv,
  isCalibrated,
  onCalibratePress
}: Props) {
  
  const displayHv = isCalibrated ? volumetricMoisture.toFixed(1) : '--.-';
  const displayHg = isCalibrated && gravimetricMoisture ? gravimetricMoisture.toFixed(1) + '%' : '-- %';

  return (
    <View style={[GlobalStyles.card, styles.cardNoMargin]}>
      {/* HEADER */}
      <View style={styles.cardHeader}>
        <Text style={styles.headerTitle}>ELECTRODO {number}</Text>
        <TouchableOpacity onPress={onCalibratePress} style={styles.calButton}>
          <MaterialCommunityIcons name="tune" size={14} color={Colors.primary} />
          <Text style={styles.calText}>Calibrar</Text>
        </TouchableOpacity>
      </View>

      {/* BODY */}
      <View style={styles.cardBody}>
        
        {/* IZQUIERDA: Valor Gigante */}
        <View style={styles.mainValueSection}>
          <View style={styles.bigNumberContainer}>
             {/* El Número Gigante */}
            <Text style={styles.bigNumber}>{displayHv}</Text>
            
            {/* Unidad al pie del número (bottom) */}
            <View style={{ marginBottom: 12 }}>
               <Text style={styles.unitSymbol}>%θ</Text>
            </View>
          </View>
          
          {/* Advertencia SOLO si no está calibrado */}
          {!isCalibrated && (
            <Text style={styles.notCalibratedWarning}>⚠️ Sin Calibrar</Text>
          )}
        </View>

        {/* DERECHA: Detalles */}
        <View style={styles.detailsColumn}>
          <DetailItem icon="arrow-expand-vertical" value={`${depthCm} cm`} label="Prof." />
          <DetailItem icon="weight" value={displayHg} label="Hg" />
          <DetailItem icon="flash" value={`${voltageMv}`} label="mV" color={Colors.textSecondary} />
        </View>
      </View>
    </View>
  );
}

const DetailItem = ({icon, value, label, color = Colors.textPrimary}: any) => (
  <View style={styles.detailItem}>
    <MaterialCommunityIcons name={icon} size={16} color={Colors.textSecondary} style={{width: 22}} />
    <Text style={[styles.detailValue, {color}]}>
      {value} <Text style={styles.detailLabel}>{label}</Text>
    </Text>
  </View>
);

const styles = StyleSheet.create({
  cardNoMargin: { marginVertical: 6, padding: 0 }, 
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: '#fafafa', borderTopLeftRadius: 10, borderTopRightRadius: 10
  },
  headerTitle: { fontSize: 13, fontWeight: 'bold', color: Colors.textSecondary, letterSpacing: 1 },
  calButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eef6fc', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4 },
  calText: { fontSize: 11, color: Colors.primary, marginLeft: 4, fontWeight: '600' },
  
  cardBody: { flexDirection: 'row', padding: 16 },
  
  // SECCIÓN IZQUIERDA
  mainValueSection: { 
    flex: 3, 
    justifyContent: 'center', 
    alignItems: 'center', // Centramos el número en su bloque
    paddingRight: 10 
  },
  bigNumberContainer: { 
    flexDirection: 'row', 
    alignItems: 'flex-end', // Alineamos el % a la base del número
  },
  bigNumber: { 
    fontSize: 70, // Aumenté el tamaño para que impacte
    fontWeight: 'bold', 
    color: Colors.textPrimary, 
    includeFontPadding: false,
    lineHeight: 75,
  },
  unitSymbol: {
    fontSize: 24, // Tamaño de la unidad
    color: Colors.textSecondary,
    fontWeight: 'bold',
    marginLeft: 2,
    marginBottom: 8 // Ajuste fino para que quede bien alineado con la base
  },
  notCalibratedWarning: { fontSize: 12, color: Colors.warning, marginTop: -5, fontWeight: 'bold' },

  // SECCIÓN DERECHA
  detailsColumn: { 
    flex: 2, 
    justifyContent: 'space-around',
    borderLeftWidth: 1, 
    borderLeftColor: '#e0e0e0',
    paddingLeft: 16,
    paddingVertical: 4
  },
  detailItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  detailValue: { fontSize: 15, fontWeight: 'bold' },
  detailLabel: { fontSize: 11, fontWeight: 'normal', color: Colors.textSecondary, marginLeft: 2 }
});