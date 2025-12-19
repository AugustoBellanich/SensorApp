import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface Props {
  stats: { min: number; avg: number; max: number };
  unit: string;
}

export default function StatPanel({ stats, unit }: Props) {
  return (
    <View style={styles.statsRow}>
      <View style={styles.statItem}>
        <Text style={styles.statLabel}>MÍN</Text>
        <Text style={styles.statValue}>
          {stats.min.toFixed(1)} <Text style={styles.unitText}>{unit}</Text>
        </Text>
      </View>
      
      <View style={[styles.statItem, styles.statBorder]}>
        <Text style={styles.statLabel}>MEDIANA</Text>
        <Text style={styles.statValue}>
          {stats.avg.toFixed(1)} <Text style={styles.unitText}>{unit}</Text>
        </Text>
      </View>
      
      <View style={styles.statItem}>
        <Text style={styles.statLabel}>MÁX</Text>
        <Text style={styles.statValue}>
          {stats.max.toFixed(1)} <Text style={styles.unitText}>{unit}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 10, 
    backgroundColor: '#fff', 
    paddingVertical: 12, 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 1 
  },
  statItem: { alignItems: 'center', flex: 1 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#eee' },
  statLabel: { fontSize: 10, color: '#888', fontWeight: 'bold', marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  unitText: { fontSize: 12, color: Colors.textSecondary, fontWeight: 'normal' }
});