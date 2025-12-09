// app/_layout.tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from 'react';

// 1. Servicios de Arquitectura
import { BleProvider } from '../context/BleContext'; // Importamos el motor BLE
import { initDatabase } from '../database/DatabaseInit'; // Importamos la inicialización de la BD

export default function RootLayout() {

  // Iniciamos la BD al arrancar la aplicación
  useEffect(() => {
    initDatabase();
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      
      {/* 2. ENVUELVE TODA LA NAVEGACIÓN CON EL PROVEEDOR BLE */}
      <BleProvider>
        <Stack screenOptions={{ headerShown: false }}>
          
          {/* Rutas Principales */}
          <Stack.Screen name="index" /> 
          <Stack.Screen name="home/index" /> 

          {/* Rutas del Sensor (Todas las rutas dinámicas [id] deben definirse aquí) */}
          <Stack.Screen name="sensor/[id]/dashboard" /> 
          <Stack.Screen name="sensor/[id]/info" options={{ presentation: 'modal', title: 'Configuración' }} />
          <Stack.Screen name="sensor/[id]/calibration" options={{ presentation: 'modal', title: 'Calibración' }} />
          
          {/* Rutas de Datos */}
          <Stack.Screen name="sensor/[id]/sd-data" />
          <Stack.Screen name="sensor/[id]/sd-data-climate" />
          <Stack.Screen name="sensor/[id]/local-data" />
          
          {/* Aquí podrías añadir un catch-all para errores 404 si usas una ruta específica */}

        </Stack>
      </BleProvider>
    </>
  );
}