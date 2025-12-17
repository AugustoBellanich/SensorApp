import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

import { Colors } from '../constants/Colors';
import { GlobalStyles } from '../constants/GlobalStyles';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if(loading) return;
    setLoading(true);

    // Intentamos loguear con Supabase
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error de Acceso', error.message);
    } else {
      // Si el login es exitoso, el AuthContext detectará el cambio de sesión
      // y el RootLayout te redirigirá, pero forzamos por seguridad UX:
      router.replace('/home');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={GlobalStyles.containerCentered}
    >
      <Text style={GlobalStyles.title}>PROYECTO</Text>
      
      <Image 
        source={require('../assets/images/isologotipo_light.png')} 
        style={localStyles.logoImage} 
        resizeMode="contain"
      />

      <View style={localStyles.formContainer}>
        <View style={localStyles.inputWrapper}>
          <Text style={localStyles.label}>Usuario (Email)</Text>
          <TextInput 
            style={localStyles.input}
            placeholder="usuario@inta.gob.ar"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View style={localStyles.inputWrapper}>
          <Text style={localStyles.label}>Contraseña</Text>
          <TextInput 
            style={localStyles.input}
            placeholder="********"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <TouchableOpacity 
          style={[GlobalStyles.primaryButton, loading && { opacity: 0.7 }]} 
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={GlobalStyles.buttonText}>INGRESAR</Text>
          )}
        </TouchableOpacity>
      </View>
      
      <Text style={localStyles.versionText}>v0.0.1 - Dev - INTA EEA Catamarca</Text>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  logoImage: {
    width: 200,
    height: 80,
    marginBottom: 30,
    marginTop: 10
  },
  formContainer: {
    width: '100%',
    paddingHorizontal: 40,
  },
  inputWrapper: {
    marginBottom: 15,
  },
  label: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 5,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  versionText: {
    position: 'absolute',
    bottom: 50,
    color: Colors.textSecondary,
    fontSize: 12
  }
});