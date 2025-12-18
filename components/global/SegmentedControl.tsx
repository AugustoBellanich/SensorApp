import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface Props {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  disabled?: boolean;
}

export default function SegmentedControl({ options, selectedIndex, onChange, disabled }: Props) {
  return (
    <View style={[styles.container, disabled && { opacity: 0.5 }]}> 
      {options.map((option, index) => (
        <TouchableOpacity
          key={index}
          // Aquí usas 'segment' y 'activeSegment', que ahora sí existen abajo
          style={[styles.segment, index === selectedIndex && styles.activeSegment]}
          onPress={() => onChange(index)}
          disabled={disabled}
        >
          <Text style={[styles.text, index === selectedIndex && styles.activeText]}>
            {option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
  },
  // CORRECCIÓN: Renombrado de 'option' a 'segment'
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  // CORRECCIÓN: Renombrado de 'activeOption' a 'activeSegment'
  activeSegment: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2,
  },
  text: {
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  activeText: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
});