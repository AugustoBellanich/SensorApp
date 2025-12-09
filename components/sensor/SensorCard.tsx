import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface SensorCardProps {
  id: string;
  rssi?: number | null;
  isSaved: boolean;
  alias?: string | null;
  onPress: () => void;
}

const getSensorMeta = (rawId: string) => {
  if (rawId.includes('B01')) return { type: 'Humedad de Suelo', icon: 'water-percent', color: Colors.primary };
  if (rawId.includes('C01')) return { type: 'Clima', icon: 'weather-partly-cloudy', color: Colors.secondary };
  return { type: 'Sensor Genérico', icon: 'chip', color: Colors.textSecondary };
};

export default function SensorCard({ 
  id, 
  rssi, 
  isSaved, 
  alias, 
  onPress 
}: SensorCardProps) {

  const meta = getSensorMeta(id);
  const isAvailable = rssi !== null && rssi !== undefined;
  const cleanId = id.replace('SEN-', '');
  const displayTitle = alias ? alias : cleanId;

  // Lógica del Botón
  let buttonText = '';
  let buttonStyle = {};
  let buttonTextStyle = {};

  if (isAvailable && !isSaved) {
    buttonText = 'VINCULAR';
    buttonStyle = styles.btnLink;
    buttonTextStyle = { color: '#fff' };
  } else if (isAvailable && isSaved) {
    buttonText = 'CONECTAR';
    buttonStyle = styles.btnConnect;
    buttonTextStyle = { color: '#fff' };
  } else {
    buttonText = 'VER / EDITAR';
    buttonStyle = styles.btnOffline;
    buttonTextStyle = { color: Colors.primary };
  }

  return (
    <View style={[styles.cardContainer, !isAvailable && styles.cardOffline]}>
      
      {/* 1. ICONO (Arriba a la Izquierda) */}
      <View style={[styles.iconBox, { backgroundColor: isAvailable ? meta.color : '#ccc' }]}>
        <MaterialCommunityIcons name={meta.icon as any} size={28} color="#fff" />
      </View>

      {/* 2. INFO (Ocupa el centro) */}
      <View style={styles.infoContainer}>
        
        {/* Nombre / Alias */}
        <Text style={styles.lineDescription} numberOfLines={1}>
          {displayTitle}
        </Text>
        
        {/* Tipo */}
        <Text style={styles.lineType} numberOfLines={1}>
          {meta.type}
        </Text>

        {/* ID Técnico */}
        <Text style={styles.lineId}>
          ID: {cleanId}
        </Text>

        {/* RSSI */}
        {isAvailable ? (
          <Text style={styles.lineRssi}>📶 {rssi} dBm</Text>
        ) : (
          <Text style={styles.lineOffline}>💤 Offline</Text>
        )}
      </View>

      {/* 3. BOTÓN (Abajo a la derecha - Posición Absoluta) */}
      <TouchableOpacity style={[styles.actionButton, buttonStyle]} onPress={onPress}>
        <Text style={[styles.btnText, buttonTextStyle]}>{buttonText}</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    // CLAVE 1: Alineamos todo arriba (flex-start) en vez de al centro
    alignItems: 'flex-start', 
    
    // Necesario para que el botón absoluto se posicione respecto a la tarjeta
    position: 'relative', 
    minHeight: 110, // Aseguramos altura mínima para que entre todo

    elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: {width: 0, height: 2},
    borderWidth: 1, borderColor: '#e0e0e0',
  },
  cardOffline: {
    backgroundColor: '#f9f9f9',
    borderColor: '#eee',
    elevation: 0,
  },
  
  // Icono
  iconBox: { 
    width: 45, 
    height: 45, 
    borderRadius: 8, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 12,
    marginTop: 0 // Asegura que esté pegado arriba
  },

  // Info
  infoContainer: { 
    flex: 1, 
    // CLAVE 2: Dejamos espacio abajo (paddingBottom) para que el texto no toque el botón
    paddingBottom: 25 
  },
  
  // Textos
  lineDescription: { fontSize: 17, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 2 },
  lineType: { fontSize: 15, color: Colors.textSecondary, fontWeight: '600', marginBottom: 2 },
  lineId: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'monospace', marginBottom: 4 },
  lineRssi: { fontSize: 12, color: Colors.success, fontWeight: 'bold' },
  lineOffline: { fontSize: 11, color: '#9e9e9e', fontStyle: 'italic' },

  // Botón (Posicionamiento Absoluto)
  actionButton: { 
    // CLAVE 3: Lo anclamos a la esquina inferior derecha
    position: 'absolute',
    bottom: 12,
    right: 12,

    paddingVertical: 8, 
    paddingHorizontal: 16, 
    borderRadius: 6, 
    minWidth: 100, 
    alignItems: 'center',
    justifyContent: 'center'
  },
  
  // Estilos de botón
  btnLink: { backgroundColor: Colors.secondary },
  btnConnect: { backgroundColor: Colors.primary },
  btnOffline: { backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.primary },
  btnText: { fontSize: 12, fontWeight: 'bold' }
});