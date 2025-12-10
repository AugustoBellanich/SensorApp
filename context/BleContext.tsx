import { Buffer } from 'buffer';
import * as DeviceInfo from 'expo-device';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, ScanMode, Subscription } from 'react-native-ble-plx';
import { BLE_UUIDS } from '../constants/BleUUIDs';

// --- UTILIDAD: SLEEP ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- CONSTANTE: TIMEOUT DE CONEXIÓN ---
const CONNECTION_TIMEOUT_MS = 15000; // Aumentamos a 15s por seguridad

// --- LOGGING HELPER ---
const logTrace = (step: string, msg: string) => console.log(`[BLE-TRACE] (${step}) ${msg}`);

// ... (Interfaces SensorInfo, SensorData, DiagnosisStatus IGUALES) ...
export interface SensorInfo {
  modelNumber: string;
  macAddress: string;
}

export interface SensorData {
  battery?: number; 
  soilTemp?: number;
  moisture1?: number; 
  moisture2?: number; 
  moisture3?: number; 
  airTemp?: number;
  humidity?: number;
}

export interface DiagnosisStatus {
  sdEnabled: boolean;
  loraEnabled: boolean;
  sdStatus: boolean;      
  loraStatus: boolean;    
  rtcStatus: 'OK' | 'WARNING' | 'ERROR';
}

interface BleContextType {
  manager: BleManager;
  isScanning: boolean;
  isBusy: boolean; 
  connectedDevice: Device | null;
  sensorInfo: SensorInfo | null;
  sensorData: SensorData; 
  diagnosisStatus: DiagnosisStatus;
  scannedDevices: Device[];
  startScan: () => void;
  stopScan: () => void;
  connectToDevice: (device: Device) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  clearScannedDevices: () => void; 
  requestPermissions: () => Promise<boolean>;
}

const BleContext = createContext<BleContextType | null>(null);

const INITIAL_DIAGNOSIS_STATUS: DiagnosisStatus = {
    sdEnabled: false,
    loraEnabled: false,
    sdStatus: false,
    loraStatus: false,
    rtcStatus: 'ERROR', 
};

// ... (Helpers de decodificación IGUALES) ...
const base64ToUtf8 = (value?: string | null): string => {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf8').trim();
};
const decodeNumericString = (value?: string | null): number => {
  const str = base64ToUtf8(value);
  return parseFloat(str) || NaN;
};
const decodeBinaryByte = (value?: string | null): number => {
  if (!value) return 0;
  const buffer = Buffer.from(value, 'base64');
  return buffer.length > 0 ? buffer.readUInt8(0) : 0;
};
const parseBooleanString = (val?: string | null): boolean => {
    const text = base64ToUtf8(val);
    return text.includes('1');
};

export const BleProvider = ({ children }: { children: React.ReactNode }) => {
  const managerRef = useRef(new BleManager());
  const manager = managerRef.current;
  
  // Estados
  const [isScanning, setIsScanning] = useState(false);
  const [isBusy, setIsBusy] = useState(false); 
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [sensorInfo, setSensorInfo] = useState<SensorInfo | null>(null);
  const [sensorData, setSensorData] = useState<SensorData>({});
  const [scannedDevices, setScannedDevices] = useState<Device[]>([]);
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>(INITIAL_DIAGNOSIS_STATUS);

  // Refs de control
  const isScanningRef = useRef(false); 
  const isDisconnectingRef = useRef(false);
  const activeSubscriptions = useRef<Subscription[]>([]);

  const updateScanningState = (scanning: boolean) => {
      isScanningRef.current = scanning;
      setIsScanning(scanning);
  };

  const clearScannedDevices = useCallback(() => {
      setScannedDevices([]);
  }, []);

  const safeReadCharacteristic = async (deviceId: string, serviceUUID: string, charUUID: string): Promise<string | null> => {
      try {
          const char = await managerRef.current.readCharacteristicForDevice(deviceId, serviceUUID, charUUID);
          return char.value;
      } catch (error: any) {
          // Log leve, no queremos llenar la consola
          return null; 
      }
  };

  const requestPermissions = useCallback(async () => {
    if (Platform.OS === 'android') {
      if ((DeviceInfo.platformApiLevel ?? -1) < 31) {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
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
    return true;
  }, []);

  const getDeviceInfo = useCallback(async (device: Device): Promise<SensorInfo> => {
    try {
        const modelChar = await manager.readCharacteristicForDevice(device.id, BLE_UUIDS.SVC_DEVICE_INFO, BLE_UUIDS.CHAR_MODEL_NUM);
        const serialChar = await manager.readCharacteristicForDevice(device.id, BLE_UUIDS.SVC_DEVICE_INFO, BLE_UUIDS.CHAR_SERIAL_NUM);
        return {
            modelNumber: base64ToUtf8(modelChar.value), 
            macAddress: base64ToUtf8(serialChar.value),
        };
    } catch (error) {
        console.error("Error leyendo info:", error);
        return { modelNumber: 'UNKNOWN', macAddress: 'UNKNOWN' };
    }
  }, [manager]);

  const readDiagnosisAndConfig = useCallback(async (device: Device): Promise<DiagnosisStatus> => {
    try {
        const [sdEn, loraEn, sdSt, loraSt, rtcSt, rtcSync] = await Promise.all([
            safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.SD_ENABLE),
            safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.LORA_ENABLE),
            safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_SD_STATUS), 
            safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_LORA_STATUS), 
            safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_RTC_STATUS), 
            safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.RTC_SYNC), 
        ]);
        
        const sdEnabled = parseBooleanString(sdEn);
        const loraEnabled = parseBooleanString(loraEn);
        const sdStatus = parseBooleanString(sdSt);
        const loraStatus = parseBooleanString(loraSt);
        const rtcHardwareOK = parseBooleanString(rtcSt); 
        let rtcState: 'OK' | 'WARNING' | 'ERROR' = 'OK';
        
        if (!rtcHardwareOK) {
            rtcState = 'ERROR';
        } else if (rtcSync) {
            const rtcString = base64ToUtf8(rtcSync);
            const sensorTime = new Date(rtcString);
            if (!isNaN(sensorTime.getTime())) {
                const diffMinutes = Math.abs(new Date().getTime() - sensorTime.getTime()) / (1000 * 60);
                if (diffMinutes > 10) rtcState = 'WARNING'; 
            } else { rtcState = 'WARNING'; }
        }
        return { sdEnabled, loraEnabled, sdStatus, loraStatus, rtcStatus: rtcState };
    } catch (error) {
        return INITIAL_DIAGNOSIS_STATUS;
    }
  }, []);

  // --- STOP MONITORING: Limpieza suave ---
  const stopMonitoringData = useCallback((forceNativeRemove: boolean = true) => {
    if (activeSubscriptions.current.length === 0) return;
    
    // Si forceNativeRemove es false, SOLO limpiamos el array de JS y NO llamamos al puente nativo.
    // Esto evita el crash durante la desconexión.
    if (forceNativeRemove) {
        logTrace("MONITOR", `Intentando remover ${activeSubscriptions.current.length} suscripciones...`);
        activeSubscriptions.current.forEach(subscription => {
            try { subscription.remove(); } catch (e) {}
        });
    } else {
        logTrace("MONITOR", "Omitiendo .remove() nativo para evitar crash.");
    }

    activeSubscriptions.current = [];
  }, []);

  const startMonitoringData = useCallback(async (device: Device, model: 'B01' | 'C01') => {
    // Aquí sí queremos limpiar nativamente si había algo viejo
    stopMonitoringData(true);
    
    logTrace("MONITOR", "Iniciando nuevas suscripciones...");
    const characteristicsToMonitor: { service: string; char: string; updateKey: keyof SensorData; isBinary: boolean }[] = [
        { service: BLE_UUIDS.SVC_BATTERY, char: BLE_UUIDS.CHAR_BATTERY_LVL, updateKey: 'battery', isBinary: true }, 
    ];
    if (model === 'B01') {
        characteristicsToMonitor.push(
            { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.TEMP_SOIL, updateKey: 'soilTemp', isBinary: false },
            { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_1, updateKey: 'moisture1', isBinary: false },
            { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_2, updateKey: 'moisture2', isBinary: false },
            { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_3, updateKey: 'moisture3', isBinary: false }
        );
    } else if (model === 'C01') {
        characteristicsToMonitor.push(
            { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.C01.TEMP_AMB, updateKey: 'airTemp', isBinary: false },
            { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.C01.HUM_AMB, updateKey: 'humidity', isBinary: false }
        );
    }
    
    characteristicsToMonitor.forEach(({ service, char, updateKey, isBinary }) => {
        const sub = device.monitorCharacteristicForService(
            service, char, (error, characteristic) => {
                if (error) return; 
                if (characteristic?.value) {
                    let value: number;
                    if (isBinary) value = decodeBinaryByte(characteristic.value);
                    else value = decodeNumericString(characteristic.value);
                    if (!isNaN(value)) {
                        setSensorData(prevData => ({ ...prevData, [updateKey]: value }));
                    }
                }
            }
        );
        activeSubscriptions.current.push(sub);
    });
  }, [stopMonitoringData]);

  const startScan = useCallback(async () => {
    const hasPerm = await requestPermissions();
    if (!hasPerm) return;
    if (isScanningRef.current) return;
    
    logTrace("SCAN", "Iniciando escaneo LowLatency...");
    setScannedDevices([]);
    updateScanningState(true);

    manager.startDeviceScan(null, { scanMode: ScanMode.LowLatency }, (error, device) => {
      if (error) {
        logTrace("SCAN", "Error: " + error.message);
        updateScanningState(false);
        return;
      }
      if (device && device.name && device.name.includes('SEN-')) {
        setScannedDevices((prevState) => {
          if (!prevState.find(d => d.id === device.id)) return [...prevState, device];
          return prevState;
        });
      }
    });
  }, [manager, requestPermissions]);

  const stopScan = useCallback(() => {
    logTrace("SCAN", "Deteniendo escaneo.");
    manager.stopDeviceScan();
    updateScanningState(false);
  }, [manager]);

  // --- DISCONNECT (MODIFICADO PARA NO CRASHEAR) ---
  const disconnectDevice = useCallback(async () => {
    if (isDisconnectingRef.current) return;
    
    if (connectedDevice) {
      setIsBusy(true); 
      logTrace("DISCONNECT", `Desconectando ${connectedDevice.id}...`);
      isDisconnectingRef.current = true; 

      // --- CAMBIO CLAVE: FALSE ---
      // NO llamamos a .remove() nativamente. Solo limpiamos el array de JS.
      // Al cancelar la conexión, Android matará las suscripciones.
      stopMonitoringData(false);

      await sleep(500);

      try {
        await connectedDevice.cancelConnection();
        logTrace("DISCONNECT", "cancelConnection exitoso.");
      } catch (e) {
        logTrace("DISCONNECT", "Error cancelConnection (ignorable): " + e);
      }

      setConnectedDevice(null);
      setSensorInfo(null);
      setSensorData({});
      setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
      
      isDisconnectingRef.current = false;
      setIsBusy(false); 
    }
  }, [connectedDevice, stopMonitoringData]);

  // --- CONNECT ---
  const connectToDevice = useCallback(async (device: Device) => {
    setIsBusy(true); 
    logTrace("CONNECT", `Iniciando conexión a ${device.id || device.name}...`);
    
    try {
      stopScan();

      if (connectedDevice) {
          logTrace("CONNECT", "Dispositivo previo detectado. Desconectando...");
          await disconnectDevice(); 
          await sleep(500); 
      }

      isDisconnectingRef.current = false; 
      setSensorData({});
      
      const performConnection = async () => {
          logTrace("CONNECT", "Conectando a nivel nativo...");
          const connected = await device.connect();
          
          logTrace("CONNECT", "Descubriendo servicios...");
          await connected.discoverAllServicesAndCharacteristics();

          logTrace("CONNECT", "Leyendo info...");
          const info = await getDeviceInfo(connected);
          
          const diagnosis = await readDiagnosisAndConfig(connected);
          setDiagnosisStatus(diagnosis);

          const batteryVal = await safeReadCharacteristic(connected.id, BLE_UUIDS.SVC_BATTERY, BLE_UUIDS.CHAR_BATTERY_LVL);
          if (batteryVal) {
              const battPct = decodeBinaryByte(batteryVal);
              setSensorData(prev => ({ ...prev, battery: battPct }));
          }

          const model = info.modelNumber.includes('B01') ? 'B01' : 'C01';
          logTrace("CONNECT", "Iniciando monitoreo...");
          await startMonitoringData(connected, model);

          const subscription = connected.onDisconnected((error, disconnectedDevice) => {
            if (isDisconnectingRef.current) {
                subscription.remove();
                return;
            }
            logTrace("DISCONNECT", "Evento nativo: Desconexión INESPERADA.");
            // Si es inesperada, sí intentamos limpiar nativamente porque la conexión se cayó
            stopMonitoringData(true); 
            setConnectedDevice(null);
            setSensorInfo(null);
            setSensorData({});
            setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
            subscription.remove();
          });

          return { connected, info };
      };

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), CONNECTION_TIMEOUT_MS)
      );

      // @ts-ignore
      const result: { connected: Device, info: SensorInfo } = await Promise.race([performConnection(), timeoutPromise]);

      setConnectedDevice(result.connected);
      setSensorInfo(result.info);
      
      logTrace("CONNECT", "¡Conexión Exitosa!");

    } catch (error: any) {
      logTrace("CONNECT_ERROR", error.message);
      
      const msg = error.message === "TIMEOUT" 
          ? "El sensor tardó demasiado. Asegúrese que esté despierto." 
          : "No se pudo conectar. Intente nuevamente.";

      Alert.alert("Error de Conexión", msg);
      
      stopMonitoringData(false); // Limpieza segura
      try { await device.cancelConnection(); } catch (e) {}
      setConnectedDevice(null);
      setSensorInfo(null);
      setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
    } finally {
        setIsBusy(false); 
    }
  }, [stopScan, connectedDevice, disconnectDevice, getDeviceInfo, readDiagnosisAndConfig, startMonitoringData, stopMonitoringData]);

  useEffect(() => {
    return () => {
        manager.stopDeviceScan();
        manager.destroy();
    };
  }, [manager]);

  return (
    <BleContext.Provider
      value={{
        manager, isScanning, isBusy, connectedDevice, sensorInfo, sensorData, diagnosisStatus, scannedDevices,
        startScan, stopScan, connectToDevice, disconnectDevice, clearScannedDevices, requestPermissions
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

global.Buffer = global.Buffer || Buffer;