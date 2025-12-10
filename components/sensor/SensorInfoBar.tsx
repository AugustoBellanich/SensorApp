import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "../../constants/Colors";

interface Props {
  id: string;
  alias: string;
  location: string;
  onEditPress: () => void;
  isOffline?: boolean; // <--- NUEVA PROP
}

export default function SensorInfoBar({ id, alias, location, onEditPress, isOffline = false }: Props) {
  
  const textColor = isOffline ? Colors.textSecondary : Colors.textPrimary;
  const subTextColor = isOffline ? '#aaa' : Colors.textSecondary;

  return (
    <View style={styles.container}>
      <View style={styles.infoCol}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text style={[styles.alias, { color: textColor }]}>{alias}</Text>
            {isOffline && (
                <View style={styles.offlineBadge}>
                    <Text style={styles.offlineText}>OFFLINE</Text>
                </View>
            )}
        </View>
        <View style={styles.row}>
            <MaterialCommunityIcons name="map-marker" size={12} color={subTextColor} />
            <Text style={[styles.subText, { color: subTextColor }]}> {location}</Text>
            <Text style={[styles.subText, { color: subTextColor }]}> • ID: {id}</Text>
        </View>
      </View>

      <TouchableOpacity onPress={onEditPress} style={styles.editBtn}>
        <MaterialCommunityIcons name="pencil" size={20} color={Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },
  infoCol: { flex: 1 },
  alias: { fontSize: 18, fontWeight: 'bold', marginRight: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  subText: { fontSize: 12 },
  editBtn: { padding: 8 },
  
  offlineBadge: {
      backgroundColor: '#eee', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4
  },
  offlineText: { fontSize: 10, fontWeight: 'bold', color: '#888' }
});