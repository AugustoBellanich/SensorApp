import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors } from '../../constants/Colors';

interface Props {
  label: string;
  valueSeconds: number; // El valor real que se enviará al sensor
  onChangeSeconds: (seconds: number) => void;
}

export default function TimeIntervalInput({ label, valueSeconds, onChangeSeconds }: Props) {
  // Estado local para los inputs visuales
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [seconds, setSeconds] = useState('0');

  // 1. Al cargar, convertimos Segundos -> H:M:S
  useEffect(() => {
    const h = Math.floor(valueSeconds / 3600);
    const m = Math.floor((valueSeconds % 3600) / 60);
    const s = valueSeconds % 60;
    
    setHours(h.toString());
    setMinutes(m.toString());
    setSeconds(s.toString());
  }, [valueSeconds]);

  // 2. Al editar, convertimos H:M:S -> Segundos y avisamos al padre
  const handleChange = (h: string, m: string, s: string) => {
    setHours(h);
    setMinutes(m);
    setSeconds(s);

    const totalSeconds = (parseInt(h || '0') * 3600) + 
                         (parseInt(m || '0') * 60) + 
                         parseInt(s || '0');
    
    onChangeSeconds(totalSeconds);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {/* HORAS */}
        <View style={styles.inputGroup}>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={hours}
            onChangeText={(t) => handleChange(t, minutes, seconds)}
          />
          <Text style={styles.unit}>h</Text>
        </View>

        {/* MINUTOS */}
        <View style={styles.inputGroup}>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={minutes}
            onChangeText={(t) => handleChange(hours, t, seconds)}
          />
          <Text style={styles.unit}>m</Text>
        </View>

        {/* SEGUNDOS */}
        <View style={styles.inputGroup}>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={seconds}
            onChangeText={(t) => handleChange(hours, minutes, t)}
          />
          <Text style={styles.unit}>s</Text>
        </View>
        
        {/* Feedback visual del total */}
        <Text style={styles.totalText}>= {valueSeconds}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 15 },
  label: { fontSize: 14, color: Colors.textSecondary, marginBottom: 5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  inputGroup: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 4,
    padding: 5, width: 50, textAlign: 'center', fontSize: 16
  },
  unit: { marginLeft: 2, fontSize: 12, color: '#666' },
  totalText: { fontSize: 12, color: '#999', fontStyle: 'italic' }
});