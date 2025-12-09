import { StyleSheet } from 'react-native';
import { Colors } from './Colors';

export const GlobalStyles = StyleSheet.create({
  // Contenedores
  containerCentered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: 20,
  },
  
  // Tipografía base
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSecondary,
    marginBottom: 20,
  },

  // Botones
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 50, 
    paddingVertical: 15, 
    borderRadius: 8,
    // Sombras estándar
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    alignItems: 'center',
  },
  buttonText: {
    color: Colors.textInverse,
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  // Tarjetas (Card)
  card: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 2, // Sombra suave
  }
});