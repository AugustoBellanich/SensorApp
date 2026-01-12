import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../database/DatabaseInit';
import { supabase } from '../lib/supabase';

type AuthContextType = {
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean; // Opcional, por si quieres diferenciar roles globales
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  isAdmin: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Verificar sesión actual al iniciar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    // 2. Escuchar cambios (Login, Logout, Auto-refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
        console.log("🧹 Limpiando base de datos y caché de sincronización...");
        
        // A. Borrar tablas SQLITE (Lo que ya hiciste)
        await db.execAsync(`
            DELETE FROM sensors;
            DELETE FROM device_electrodes; 
            DELETE FROM readings_b01; 
            DELETE FROM readings_c01;
        `);

        // B. BORRAR LA FECHA DE ÚLTIMA SYNC (¡ESTO ES LO NUEVO!) 🔑
        // Esto obliga a que el próximo Login haga un "Full Pull"
        await AsyncStorage.removeItem("LAST_SYNC_TIMESTAMP"); 

    } catch (e) {
        console.error("Error limpiando datos locales:", e);
    }

    // C. Cerrar sesión en Nube
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, isAdmin: false, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};