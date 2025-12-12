import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto'; // <--- 1. OBLIGATORIO: Esto debe ir primero para que no falle en Android

// 2. Leemos las variables del archivo .env
// En Expo, las variables que empiezan con EXPO_PUBLIC_ están disponibles globalmente aquí.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// 3. Validación de seguridad
// Esto evita que la app crashee con un error raro si te olvidaste de crear el archivo .env
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ ERROR CRÍTICO SUPABASE: Faltan las variables de entorno.");
  console.error("Asegúrate de crear el archivo .env en la raíz con:");
  console.error(" - EXPO_PUBLIC_SUPABASE_URL");
  console.error(" - EXPO_PUBLIC_SUPABASE_ANON_KEY");
}

// 4. Inicializamos el cliente
// Usamos el operador '!' para decirle a TypeScript que confiamos en que las variables existen (ya validamos arriba)
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    storage: AsyncStorage,       // Usa el almacenamiento del celular para guardar la sesión
    autoRefreshToken: true,      // Refresca el token automáticamente
    persistSession: true,        // Mantiene al usuario logueado si cierra la app
    detectSessionInUrl: false,   // Importante en React Native (deshabilita detección de URL de navegador)
  },
});