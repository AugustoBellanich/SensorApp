import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

// Servicios
import { AuthProvider, useAuth } from '../context/AuthContext';
import { BleProvider } from '../context/BleContext';
import { initDatabase } from '../database/DatabaseInit';

function RootNavigation() {
  const { session, isLoading: isAuthLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isAuthLoading) return;

    const currentRoute = segments[0] as string | undefined;
    const isTryingToAccessProtected = 
        currentRoute === 'home' || 
        currentRoute === 'sensor' || 
        currentRoute === 'gateway';

    if (!session && isTryingToAccessProtected) {
       router.replace('/'); 
    } 
    else if (session && (currentRoute === undefined || currentRoute === 'index')) {
       router.replace('/home'); 
    }
  }, [session, segments, isAuthLoading, router]);

  if (isAuthLoading) {
    return (
      <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" /> 
      <Stack.Screen name="home/index" /> 
      {/* Las rutas dinámicas se manejan mejor sin declararlas aquí explícitamente 
          si ya tienen sus propios _layout dentro de las carpetas, 
          pero para evitar errores las dejamos genéricas */}
    </Stack>
  );
}

export default function RootLayout() {
  const [isDbReady, setIsDbReady] = useState(false);

  // 1. INICIALIZAR BD ANTES DE MOSTRAR NADA
  useEffect(() => {
    const prepare = async () => {
      try {
        await initDatabase();
        setIsDbReady(true); // ¡Solo ahora permitimos renderizar la App!
      } catch (e) {
        console.error("Error iniciando DB:", e);
      }
    };
    prepare();
  }, []);

  if (!isDbReady) {
    return (
      <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
        <ActivityIndicator size="large" color="#000"/>
        <Text style={{marginTop:10}}>Iniciando Sistema...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <AuthProvider> 
        <BleProvider>
           <RootNavigation />
        </BleProvider>
      </AuthProvider>
    </>
  );
}