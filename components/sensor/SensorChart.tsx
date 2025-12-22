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
  yAxisMax?: number;
  spacing: number;
}

// Helper para dar opacidad a los colores Hex
const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export default function SensorChart({ 
  data, 
  type, 
  unit, 
  color, 
  referenceLines = [],
  yAxisMax,
  spacing
}: Props) {
  
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = screenWidth - 50; 

  // 1. Sanitización
  const safeData = data.map(d => ({
      ...d,
      value: (typeof d.value === 'number' && !isNaN(d.value)) ? d.value : 0
  }));

  // 2. Cálculo de Techo
  const dataMax = safeData.length > 0 ? Math.max(...safeData.map(d => d.value)) : 0;
  
  let refMax = 0;
  if (referenceLines.length > 0) {
    refMax = Math.max(...referenceLines.map(r => r.value));
  }

  const calculatedMax = Math.max(dataMax, refMax) * 1.15;
  const finalMaxValue = yAxisMax ? Math.max(yAxisMax, calculatedMax) : calculatedMax;
  
  const validColor = color || Colors.primary;

  // Helper para generar configuración de línea
  // isBottomLine: true si es la línea de PMP (para asegurarnos que el texto vaya arriba)
  const getLineConfig = (ref: any, isBottomLine: boolean = false) => {
      const colorWithOpacity = hexToRgba(ref.color, 0.7); // Opacidad 0.7 en línea y texto
      
      return {
          color: colorWithOpacity,
          thickness: 1,
          dashWidth: 5,  // Hace la línea punteada
          dashGap: 5,    // Espacio entre puntos
          labelText: ref.label,
          labelTextStyle: { 
              color: colorWithOpacity, 
              fontSize: 12, 
              fontWeight: '900' as const,
              marginLeft: 5,   // Padding left solicitado
              marginTop: -15, // Esto empuja el texto HACIA ARRIBA de la línea
              opacity: 0.7     // Refuerzo de opacidad en el texto
          },
          zIndex: 1000,
      };
  };

  const commonProps = {
    height: 220,
    width: chartWidth, 
    scrollable: true,
    initialSpacing: 20,
    spacing: spacing,
    endSpacing: 50,
    
    maxValue: finalMaxValue || 10,
    noOfSections: 5,
    yAxisTextStyle: { color: '#888', fontSize: 10 },
    
    xAxisLabelTextStyle: { 
        color: '#888', 
        fontSize: 9, 
        textAlign: 'center' as const, 
        width: 60 
    },
    xAxisTextNumberOfLines: 2,
    rulesColor: '#f0f0f0',
    rulesType: 'solid',
    yAxisLabelSuffix: '',
    
    // --- LÍNEAS DE REFERENCIA ---
    
    // Línea 1 (SAT - Arriba)
    showReferenceLine1: referenceLines.length > 0,
    referenceLine1Position: referenceLines[0]?.value || 0,
    referenceLine1Config: referenceLines[0] ? getLineConfig(referenceLines[0]) : undefined,
    
    // Línea 2 (CC - Medio)
    showReferenceLine2: referenceLines.length > 1,
    referenceLine2Position: referenceLines[1]?.value || 0,
    referenceLine2Config: referenceLines[1] ? getLineConfig(referenceLines[1]) : undefined,

    // Línea 3 (PMP - Abajo)
    // Al usar getLineConfig con marginBottom: 5, aseguramos que el texto quede "sobre" la línea
    showReferenceLine3: referenceLines.length > 2,
    referenceLine3Position: referenceLines[2]?.value || 0,
    referenceLine3Config: referenceLines[2] ? getLineConfig(referenceLines[2], true) : undefined,
  };

  return (
    <View style={styles.card}>
      <Text style={styles.unitLabel}>{unit}</Text>

      <View style={styles.chartWrapper}>
        {type === 'bar' ? (
          <BarChart
            {...commonProps}
            data={safeData}
            barWidth={Math.max(4, spacing * 0.5)}
            roundedTop
            frontColor={validColor}
            isAnimated={false} 
          />
        ) : (
          <LineChart
            {...commonProps}
            data={safeData}
            color={validColor}
            thickness={2.5}
            curved={true} 
            curvature={0.2} 
            areaChart={true} 
            startFillColor={validColor}
            endFillColor="#ffffff"
            startOpacity={0.2}
            endOpacity={0.0}
            isAnimated={false} 
            hideDataPoints={spacing < 25}
            dataPointsColor={validColor}
            dataPointsRadius={2}
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
    paddingHorizontal: 5,
    marginVertical: 10,
    elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: {width:0, height:2},
    borderWidth: 1, borderColor: '#eee',
  },
  chartWrapper: {
    overflow: 'hidden',
    marginTop: 5,
  },
  unitLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textSecondary,
    marginLeft: 15,
    marginBottom: 5,
    textTransform: 'uppercase'
  }
});