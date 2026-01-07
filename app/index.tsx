import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { SUPABASE_URL, supabase } from '../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      // Intentamos obtener la sesión actual
      const { data, error } = await supabase.auth.getSession();
      
      // Si hay error (token inválido, etc.) o si hay sesión pero no redirigió
      if (error) {
        console.log("⚠️ Sesión inválida detectada en Login. Limpiando...", error.message);
        await supabase.auth.signOut(); // Forzamos limpieza
      }
    };
    checkSession();
  }, []);

  // VERIFICACIÓN DE SEGURIDAD VISUAL
  const isConfigMissing = !SUPABASE_URL || SUPABASE_URL === "";

  const handleLogin = async () => {
    if(loading) return;
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error de Acceso', error.message);
    } else {
      router.replace('/home');
    }
  };

  return (
    // 1. Contenedor Principal (Fijo)
    <View style={localStyles.mainContainer}>
      
      {/* 2. Área que reacciona al teclado (Título, Logo, Formulario) */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[GlobalStyles.containerCentered, { flex: 1, width: '100%' }]}
      >
        <Text style={GlobalStyles.title}>PROYECTO</Text>
        
        <Image 
          source={require('../assets/images/isologotipo_light.png')} 
          style={localStyles.logoImage} 
          resizeMode="contain"
        />

        {isConfigMissing && (
          <View style={{backgroundColor: '#ffebee', padding: 10, borderRadius: 8, marginBottom: 20}}>
            <Text style={{color: '#d32f2f', textAlign: 'center', fontWeight: 'bold'}}>
              ⚠️ ERROR: API URL NO DEFINIDA
            </Text>
            <Text style={{color: '#d32f2f', fontSize: 10, textAlign: 'center'}}>
              El archivo .env no se cargó en el build.
            </Text>
          </View>
        )}

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
      </KeyboardAvoidingView>
      
      {/* 3. Texto Fijo (Fuera del KeyboardAvoidingView) */}
      <Text style={localStyles.versionText}>v0.0.1 - Dev - INTA EEA Catamarca</Text>
    </View>
  );
}

const localStyles = StyleSheet.create({
  // Nuevo contenedor principal
  mainContainer: {
    flex: 1,
    backgroundColor: Colors.background || '#f2f2f2', // Asegura el color de fondo
  },
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
    bottom: 70, // Ajustado un poco para margen seguro
    alignSelf: 'center', // Centrado horizontalmente
    color: Colors.textSecondary,
    fontSize: 12
  }
});