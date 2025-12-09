import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { Colors } from '../../constants/Colors';

interface Props {
  data: any[]; // Array de objetos {value, label, ...}
  type: 'line' | 'bar';
  unit: string;
  color: string;
  referenceLines?: { value: number; label: string; color: string }[];
  yAxisLabelSuffix?: string;
}

export default function SensorChart({ 
  data, 
  type, 
  unit, 
  color, 
  referenceLines = [],
  yAxisLabelSuffix = '' 
}: Props) {
  
  const screenWidth = Dimensions.get('window').width;

  // Configuración común para ambos gráficos
  const commonProps = {
    height: 220,
    width: screenWidth - 60, // Ajuste para padding
    noOfSections: 4,
    yAxisTextStyle: { color: '#999', fontSize: 10 },
    xAxisLabelTextStyle: { color: '#999', fontSize: 10 },
    yAxisLabelSuffix: yAxisLabelSuffix,
    rulesColor: '#f0f0f0',
    initialSpacing: 10,
    // Aquí inyectamos las líneas de referencia (PMP, CC)
    showReferenceLine1: referenceLines.length > 0,
    referenceLine1Config: referenceLines[0] ? {
      color: referenceLines[0].color,
      thickness: 1,
      dashWidth: 5,
      dashGap: 5,
      labelText: referenceLines[0].label,
      value: referenceLines[0].value,
    } : undefined,
    showReferenceLine2: referenceLines.length > 1,
    referenceLine2Config: referenceLines[1] ? {
      color: referenceLines[1].color,
      thickness: 1,
      dashWidth: 5,
      dashGap: 5,
      labelText: referenceLines[1].label,
      value: referenceLines[1].value,
    } : undefined,
  };

  if (type === 'bar') {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.unitLabel}>{unit}</Text>
        <BarChart
          {...commonProps}
          data={data}
          barWidth={18}
          spacing={20}
          roundedTop
          frontColor={color}
          isAnimated
        />
      </View>
    );
  }

  // Por defecto LineChart
  return (
    <View style={styles.chartContainer}>
      <Text style={styles.unitLabel}>{unit}</Text>
      <LineChart
        {...commonProps}
        data={data}
        color={color}
        thickness={2}
        startFillColor={color}
        endFillColor="#ffffff"
        startOpacity={0.2}
        endOpacity={0.0}
        areaChart // Relleno suave abajo
        curved // Curvas suaves
        isAnimated
        hideDataPoints={data.length > 20} // Ocultar puntos si hay muchos datos
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chartContainer: {
    marginVertical: 10,
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 12,
    elevation: 2,
  },
  unitLabel: {
    position: 'absolute',
    top: 10,
    left: 10,
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    zIndex: 10,
  }
});