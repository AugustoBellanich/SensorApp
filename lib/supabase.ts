import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

// 1. Leemos con fallback a cadena vacía para evitar CRASH inmediato
// En Expo, las variables que empiezan con EXPO_PUBLIC_ están disponibles globalmente aquí.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const ingestToken = process.env.EXPO_PUBLIC_INGEST_TOKEN || "";
const functionUrl = process.env.EXPO_PUBLIC_SUPABASE_FUNCTION_URL || "";

// 2. Logging para depuración (solo se verá en logs, no crashea la UI)
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ ADVERTENCIA: Variables de entorno Supabase no detectadas.");
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

// 4. Exportamos constantes seguras
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;
export const INGEST_TOKEN = ingestToken;
export const SUPABASE_FUNCTION_URL = functionUrl;