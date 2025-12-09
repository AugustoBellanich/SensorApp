import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface Props {
  id: string;
  alias?: string;
  location?: string;
  onEditPress: () => void;
}

export default function SensorInfoBar({ id, alias, location, onEditPress }: Props) {
  const cleanId = id.replace('SEN-', '');
  const displayName = alias || `Sensor ${cleanId}`;
  const displayLocation = location || 'Sin ubicación definida';

  return (
    <View style={styles.container}>
      
      {/* Icono Grande a la Izquierda */}
      <View style={styles.iconContainer}>
        <MaterialCommunityIcons name="map-marker-radius" size={28} color={Colors.primary} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.alias} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.details}>
          ID: <Text style={{fontFamily: 'monospace'}}>{cleanId}</Text> • {displayLocation}
        </Text>
      </View>
      
      <TouchableOpacity onPress={onEditPress} style={styles.editButton}>
        <MaterialCommunityIcons name="cog" size={20} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15, // Más alto
    paddingHorizontal: 16,
    backgroundColor: '#f4f6f8', 
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  iconContainer: {
    marginRight: 12,
    opacity: 0.8
  },
  alias: { 
    fontSize: 18, // Letra más grande
    fontWeight: 'bold', 
    color: Colors.textPrimary 
  },
  details: { 
    fontSize: 13, 
    color: Colors.textSecondary, 
    marginTop: 2 
  },
  editButton: { 
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 1
  },
});