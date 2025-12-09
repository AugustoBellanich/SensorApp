import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { Colors } from '../../constants/Colors';

interface Props {
  data: any[]; 
  type: 'line' | 'bar';
  unit: string;
  color: string;
  referenceLines?: { value: number; label: string; color: string }[];
}

export default function SensorChart({ 
  data, 
  type, 
  unit, 
  color, 
  referenceLines = [] 
}: Props) {
  
  const screenWidth = Dimensions.get('window').width;
  // Ajustamos ancho para que entre bien en la tarjeta
  const availableWidth = screenWidth - 60; 

  // 1. CÁLCULO DE TECHO (MAX VALUE)
  const dataMax = Math.max(...data.map(d => d.value));
  
  // Buscar el valor más alto de las referencias (si existen)
  let refMax = 0;
  if (referenceLines.length > 0) {
    refMax = Math.max(...referenceLines.map(r => r.value));
  }

  // El techo es el máximo entre datos y referencias + 20% de aire
  // Esto GARANTIZA que las líneas de CC/PMP entren en el gráfico
  const yAxisMaxValue = Math.max(dataMax, refMax) * 1.2;

  const commonProps = {
    height: 220,
    scrollable: true,
    initialSpacing: 20,
    endSpacing: 50,
    maxValue: yAxisMaxValue, // <--- ESTO ES LA CLAVE
    noOfSections: 4,
    yAxisTextStyle: { color: '#888', fontSize: 10 },
    xAxisLabelTextStyle: { color: '#888', fontSize: 10 },
    rulesColor: '#f5f5f5',
    yAxisLabelSuffix: '',
    
    // LÍNEAS DE REFERENCIA
    showReferenceLine1: referenceLines.length > 0,
    referenceLine1Config: referenceLines[0] ? {
      color: referenceLines[0].color,
      thickness: 2,
      dashWidth: 6,
      dashGap: 4,
      labelText: referenceLines[0].label,
      labelTextStyle: { color: referenceLines[0].color, fontSize: 10, fontWeight: 'bold' },
      value: referenceLines[0].value,
      zIndex: 100, // Forzamos que esté bien arriba
    } : undefined,
    
    showReferenceLine2: referenceLines.length > 1,
    referenceLine2Config: referenceLines[1] ? {
      color: referenceLines[1].color,
      thickness: 2,
      dashWidth: 6,
      dashGap: 4,
      labelText: referenceLines[1].label,
      labelTextStyle: { color: referenceLines[1].color, fontSize: 10, fontWeight: 'bold' },
      value: referenceLines[1].value,
      zIndex: 100,
    } : undefined,
  };

  return (
    <View style={styles.card}>
      {/* Título de unidad limpio arriba */}
      <Text style={styles.unitLabel}>{unit}</Text>

      <View style={styles.chartWrapper}>
        {type === 'bar' ? (
          <BarChart
            {...commonProps}
            data={data}
            barWidth={18}
            spacing={25}
            roundedTop
            frontColor={data[0]?.frontColor ? undefined : color}
            isAnimated
          />
        ) : (
          <LineChart
            {...commonProps}
            data={data}
            color={color}
            thickness={3}
            curved
            isAnimated
            startFillColor={color}
            endFillColor="#ffffff"
            startOpacity={0.2}
            endOpacity={0.0}
            areaChart
            // Puntos visibles para entender dónde están los datos
            hideDataPoints={false}
            dataPointsColor={color}
            dataPointsRadius={3}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 12,
    marginVertical: 10,
    elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: {width:0, height:2},
    borderWidth: 1, borderColor: '#eee',
  },
  chartWrapper: {
    overflow: 'hidden',
    marginTop: 10, // Espacio para la etiqueta de unidad
  },
  unitLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    marginLeft: 4
  }
});