import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface Props {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

export default function SegmentedControl({ options, selectedIndex, onChange }: Props) {
  return (
    <View style={styles.container}>
      {options.map((option, index) => {
        const isActive = index === selectedIndex;
        return (
          <TouchableOpacity
            key={index}
            style={[styles.option, isActive && styles.activeOption]}
            onPress={() => onChange(index)}
          >
            <Text style={[styles.text, isActive && styles.activeText]}>
              {option}
            </Text>
          </TouchableOpacity>
        );
      })}
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
  option: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeOption: {
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