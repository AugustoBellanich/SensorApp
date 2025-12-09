import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
// 1. Importamos nuestros estándares
import { Colors } from '../constants/Colors';
import { GlobalStyles } from '../constants/GlobalStyles';

export default function LoginScreen() {
  const router = useRouter();

  return (
    // Usamos el estilo global de contenedor centrado
    <View style={GlobalStyles.containerCentered}>
      
      {/* Usamos el estilo global de título */}
      <Text style={GlobalStyles.title}>PROYECTO</Text>
      
      <Image 
        source={require('../assets/images/isologotipo_light.png')} 
        style={localStyles.logoImage} // Este estilo es único de esta pantalla, se queda local
        resizeMode="contain"
      />

      <View style={{ height: 20 }} />

      <TouchableOpacity 
        style={GlobalStyles.primaryButton} // Botón estándar
        onPress={() => router.replace('/home')} 
      >
        <Text style={GlobalStyles.buttonText}>INGRESAR</Text>
      </TouchableOpacity>
      
      <Text style={localStyles.versionText}>v0.0.1 - Dev - INTA EEA Catamarca</Text>
    </View>
  );
}

// Aquí SOLO dejamos lo que es único y exclusivo de esta pantalla
const localStyles = StyleSheet.create({
  logoImage: {
    width: '100%',
    height: 110,
    marginBottom: 20,
    marginTop: 20
  },
  versionText: {
    position: 'absolute',
    bottom: 50,
    color: Colors.textSecondary, // Usamos la variable, no el hex
    fontSize: 12
  }
});