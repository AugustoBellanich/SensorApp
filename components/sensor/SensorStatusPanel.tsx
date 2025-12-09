import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';

interface Props {
  batteryMv: number; // Ej: 4150
  soilTemp: number;
  status: { sd: boolean; lora: boolean; rtc: boolean; };
}

export default function SensorStatusPanel({ batteryMv, soilTemp, status }: Props) {
  const insets = useSafeAreaInsets();

  // 1. Lógica de Porcentaje de Batería (Estimación Lineal para Li-Ion)
  // 4200mV = 100%, 3300mV = 0%
  const getBatPercentage = (mv: number) => {
    const min = 3300;
    const max = 4200;
    let pct = ((mv - min) / (max - min)) * 100;
    
    // Limitamos entre 0 y 100
    if (pct > 100) pct = 100;
    if (pct < 0) pct = 0;
    
    return Math.round(pct);
  };

  const batPct = getBatPercentage(batteryMv);

  // 2. Icono y Color Dinámico
  let batIcon = 'battery';
  let batColor = Colors.success; // Verde por defecto

  if (batPct < 20) { 
    batIcon = 'battery-alert'; 
    batColor = Colors.error;   // Rojo si < 20%
  } else if (batPct < 50) { 
    batIcon = 'battery-50'; 
    batColor = Colors.warning; // Naranja si < 50%
  }

  const StatusIcon = ({ name, active }: { name: any, active: boolean }) => (
    <MaterialCommunityIcons 
      name={name} 
      size={22} // Aumenté un poco el tamaño del icono (era 20)
      color={active ? Colors.primary : Colors.textSecondary} 
      style={{ opacity: active ? 1 : 0.3, marginRight: 15 }} 
    />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 15 }]}> 
      {/* Aumenté el padding top extra (+15) para que sea más alto */}

      {/* IZQUIERDA: Módulos */}
      <View style={styles.modulesRow}>
        <StatusIcon name="sd" active={status.sd} />
        <StatusIcon name="radio-tower" active={status.lora} />
        <StatusIcon name="clock-outline" active={status.rtc} />
      </View>

      {/* DERECHA: Datos */}
      <View style={styles.metricsRow}>
        
        {/* Temperatura */}
        <View style={styles.metricItem}>
          <MaterialCommunityIcons name="thermometer" size={20} color={Colors.secondary} />
          <Text style={styles.metricText}>{soilTemp.toFixed(1)}°C</Text>
        </View>

        {/* Batería en % */}
        <View style={styles.metricItem}>
          <MaterialCommunityIcons name={batIcon as any} size={20} color={batColor} />
          <Text style={[styles.metricText, { color: batColor }]}>
            {batPct}%
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    // Aumenté el padding vertical para darle más cuerpo a la barra
    paddingBottom: 16, 
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    elevation: 4,
    zIndex: 10,
  },
  modulesRow: { flexDirection: 'row' },
  metricsRow: { flexDirection: 'row', gap: 20 }, // Más separación entre temp y batería
  metricItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Aumenté un puntito la fuente
  metricText: { fontWeight: 'bold', fontSize: 15, color: Colors.textPrimary },
});