/**
 * Paleta de colores centralizada.
 * Tema: Alto Contraste (Campo/INTA)
 */

const tintColorLight = '#004aad'; // Azul INTA principal

export const Colors = {
  // Base
  background: '#ffffff',
  textPrimary: '#000000',    // Negro puro para máximo contraste
  textSecondary: '#404040',  // Gris oscuro para subtítulos
  textInverse: '#ffffff',    // Texto sobre fondos oscuros

  // Marca / Acciones
  primary: '#004aad',        // Azul INTA (Botones, Headers)
  secondary: '#E63312',      // Rojo INTA (Detalles)
  
  // Estados
  success: '#2e7d32',        // Verde oscuro (Batería full, Conectado)
  warning: '#ed6c02',        // Naranja (Batería baja)
  error: '#d32f2f',          // Rojo (Desconectado, Error)
  offline: '#9e9e9e',        // Gris (Sensor desconectado)

  // Elementos UI
  cardBackground: '#f5f5f5', // Fondo suave para tarjetas
  border: '#e0e0e0',
};