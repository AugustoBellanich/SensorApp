import * as DeviceInfo from 'expo-device';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { BLE_UUIDS } from '../constants/BleUUIDs'; // <--- Importamos los UUIDs

// Necesitamos importar Buffer para decodificar Base64 en React Native
import { Buffer } from 'buffer';

// --- TIPOS DE DATOS ---
export interface SensorInfo {
  modelNumber: string; // Ej: "SEN-B01" o "SEN-C01"
  macAddress: string; // MAC Address del sensor
}

interface BleContextType {
  manager: BleManager;
  isScanning: boolean;
  connectedDevice: Device | null;
  sensorInfo: SensorInfo | null; // Guardamos la info de identificación aquí
  scannedDevices: Device[];
  startScan: () => void;
  stopScan: () => void;
  connectToDevice: (device: Device) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  requestPermissions: () => Promise<boolean>;
}

const BleContext = createContext<BleContextType | null>(null);

// --- FUNCIÓN HELPER DE DECODIFICACIÓN ---
// Las características BLE se leen en Base64, necesitamos convertirlas a texto (UTF8)
const base64ToUtf8 = (value?: string | null): string => {
  if (!value) return '';
  // Convertir Base64 a string usando Buffer
  const binaryString = Buffer.from(value, 'base64').toString('utf8');
  return binaryString.trim();
};

export const BleProvider = ({ children }: { children: React.ReactNode }) => {
  const managerRef = useRef(new BleManager());
  const manager = managerRef.current;
  
  const [isScanning, setIsScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [sensorInfo, setSensorInfo] = useState<SensorInfo | null>(null);
  const [scannedDevices, setScannedDevices] = useState<Device[]>([]);

  // --- 1. GESTIÓN DE PERMISOS (CRÍTICO para Android 12+) ---
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      if ((DeviceInfo.platformApiLevel ?? -1) < 31) {
        // Android < 12
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        // Android 12+ (SDK 31+) - Requiere estos 3 permisos
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        return (
          result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }
    return true; // iOS lo maneja el Info.plist (plugin)
  };

  // --- 2. LECTURA DE IDENTIFICACIÓN ---
  // Lee las características 2A24 (Modelo) y 2A25 (Serial/MAC)
  const getDeviceInfo = async (device: Device): Promise<SensorInfo> => {
    try {
        // 1. Leer Model Number (2A24)
        const modelChar = await manager.readCharacteristicForDevice(
            device.id,
            BLE_UUIDS.SVC_DEVICE_INFO,
            BLE_UUIDS.CHAR_MODEL_NUM
        );
        
        // 2. Leer Serial Number (2A25) para obtener MAC Address (ID real)
        const serialChar = await manager.readCharacteristicForDevice(
            device.id,
            BLE_UUIDS.SVC_DEVICE_INFO,
            BLE_UUIDS.CHAR_SERIAL_NUM
        );

        return {
            modelNumber: base64ToUtf8(modelChar.value), // Ej: "SEN-B01"
            macAddress: base64ToUtf8(serialChar.value),   // Ej: "AABBCCDDEEFF"
        };
    } catch (e) {
        console.error("Error leyendo info del dispositivo:", e);
        // Devolvemos valores de fallback
        return { modelNumber: 'UNKNOWN', macAddress: 'UNKNOWN' };
    }
  };

  // --- 3. ESCANEO ---
  const startScan = async () => {
    const hasPerm = await requestPermissions();
    if (!hasPerm) {
      Alert.alert("Permiso denegado", "No se puede escanear sin permisos Bluetooth.");
      return;
    }

    if (isScanning) return;

    setScannedDevices([]);
    setIsScanning(true);

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error("Error escaneando:", error);
        setIsScanning(false);
        return;
      }

      // FILTRO: Solo dispositivos con nombre que empieza con 'SEN-'
      if (device && device.name && device.name.includes('SEN-')) {
        setScannedDevices((prevState) => {
          if (!prevState.find(d => d.id === device.id)) {
            return [...prevState, device];
          }
          return prevState;
        });
      }
    });

    // Parar automáticamente a los 10 segundos
    setTimeout(() => {
      stopScan();
    }, 10000);
  };

  const stopScan = () => {
    manager.stopDeviceScan();
    setIsScanning(false);
  };

  // --- 4. CONEXIÓN (El punto de entrada) ---
  const connectToDevice = async (device: Device) => {
    try {
      stopScan();
      
      console.log(`Conectando a ${device.name}...`);
      const connected = await device.connect();
      
      console.log("Descubriendo servicios y características...");
      await connected.discoverAllServicesAndCharacteristics();

      // Leer la info crítica para identificar el sensor (B01/C01)
      const info = await getDeviceInfo(connected);
      console.log(`[BLE] Conectado. Modelo: ${info.modelNumber}`);
      
      setConnectedDevice(connected);
      setSensorInfo(info); // Guardamos el tipo de sensor en el estado global
      
      // Listener para desconexión inesperada
      const subscription = connected.onDisconnected((error, disconnectedDevice) => {
        console.log("Desconectado inesperadamente:", disconnectedDevice?.id);
        setConnectedDevice(null);
        setSensorInfo(null);
        subscription.remove();
      });

    } catch (error) {
      console.error("Error de conexión:", error);
      Alert.alert("Error de Conexión", "No se pudo conectar al sensor.");
      setConnectedDevice(null);
      setSensorInfo(null);
      throw error;
    }
  };

  const disconnectDevice = async () => {
    if (connectedDevice) {
      await connectedDevice.cancelConnection();
      setConnectedDevice(null);
      setSensorInfo(null);
    }
  };
  
  // Limpieza inicial del manager
  useEffect(() => {
    const subscription = manager.onStateChange((state) => {
      console.log("Estado BLE:", state);
    }, true);
    return () => subscription.remove();
  }, [manager]);

  return (
    <BleContext.Provider
      value={{
        manager,
        isScanning,
        connectedDevice,
        sensorInfo,
        scannedDevices,
        startScan,
        stopScan,
        connectToDevice,
        disconnectDevice,
        requestPermissions
      }}
    >
      {children}
    </BleContext.Provider>
  );
};

export const useBle = () => {
  const context = useContext(BleContext);
  if (!context) throw new Error("useBle debe usarse dentro de un BleProvider");
  return context;
};

// Necesario para el helper base64ToUtf8 (Asegúrate de que 'buffer' esté disponible, 
// a veces hay que importarlo en el entry point. Si falla, ejecuta: npm install buffer)
global.Buffer = global.Buffer || Buffer;