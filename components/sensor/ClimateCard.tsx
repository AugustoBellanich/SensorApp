import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import { GlobalStyles } from '../../constants/GlobalStyles';

interface Props {
  type: 'temp' | 'hum';
  value: number | null | undefined; // <--- Agregado undefined por seguridad
  label?: string;
}

export default function ClimateCard({ type, value, label }: Props) {
  
  const displayLabel = label || (type === 'temp' ? 'Temperatura' : 'Humedad');
  
  const config = type === 'temp' ? {
    title: 'TEMPERATURA',
    icon: 'thermometer',
    color: Colors.secondary,
    unit: '°C',
    description: 'Aire'
  } : {
    title: 'HUMEDAD',
    icon: 'water-percent',
    color: Colors.primary,
    unit: '%',
    description: 'Ambiente'
  };

  // --- VALIDACIÓN SEGURA ---
  // Verifica que sea estrictamente un número antes de usar toFixed
  const safeValue = typeof value === 'number' ? value.toFixed(1) : "--";

  return (
    <View style={[GlobalStyles.card, styles.cardContainer]}>
      
      {/* HEADER COMPACTO */}
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: config.color }]}>
          <MaterialCommunityIcons name={config.icon as any} size={20} color="#fff" />
        </View>
        <View style={{marginLeft: 8, flex: 1}}>
          <Text style={styles.title} numberOfLines={1}>{config.title}</Text>
        </View>
      </View>

      {/* BODY COMPACTO */}
      <View style={styles.body}>
        <Text style={[styles.value, { color: config.color }]}>
          {safeValue}
        </Text>
        <Text style={[styles.unit, { color: config.color }]}>
          {config.unit}
        </Text>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    padding: 0, 
    borderRadius: 12,
    flex: 1, 
    marginHorizontal: 4, 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fafafa',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  iconBox: {
    width: 32, height: 32,
    borderRadius: 6,
    justifyContent: 'center', alignItems: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  body: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    paddingVertical: 15,
  },
  value: {
    fontSize: 42, 
    fontWeight: 'bold',
    includeFontPadding: false,
  },
  unit: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 4,
  }
});