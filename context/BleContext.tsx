import { Buffer } from "buffer";
import * as DeviceInfo from "expo-device";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  BleManager,
  ConnectionPriority,
  Device,
  ScanMode,
  Subscription,
} from "react-native-ble-plx";
// IMPORTAMOS TUS CONSTANTES GLOBALES
import { BLE_UUIDS } from "../constants/BleUUIDs";

// --- UTILIDADES ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T,>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  tag: string
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => {
        resolve(fallback);
      }, ms)
    ),
  ]);
};

// 30s es seguro para el N01
const CONNECTION_TIMEOUT_MS = 30000;

// Intervalo de lectura de datos (Polling) en ms. 
const POLLING_INTERVAL_MS = 2000;

const logTrace = (step: string, msg: string) =>
  console.log(`[BLE-TRACE] (${step}) ${msg}`);

// --- TIPOS ---
export type DeviceCategory =
  | "WATER"
  | "SOIL"
  | "CLIMATE"
  | "GATEWAY"
  | "UNKNOWN";

export interface SensorInfo {
  modelNumber: string;
  macAddress: string;
  category: DeviceCategory;
}

export interface SensorData {
  battery?: number;
  soilTemp?: number;
  moisture1?: number;
  moisture2?: number;
  moisture3?: number;
  airTemp?: number;
  humidity?: number;
  waterLevel?: number;
  flowRate?: number;
}

export interface DiagnosisStatus {
  sdEnabled: boolean;
  loraEnabled: boolean;
  sdStatus: boolean;
  loraStatus: boolean;
  rtcStatus: "OK" | "WARNING" | "ERROR";
  wifiStatus?: string;
  syncStatus?: string;
  lastSync?: string;
  sensorsList?: string;
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
  rtcStatus: "ERROR",
};

const STD_UUIDS = {
  DEV_INFO_SVC: "0000180a-0000-1000-8000-00805f9b34fb",
  MODEL_NUM: "00002a24-0000-1000-8000-00805f9b34fb",
  SERIAL_NUM: "00002a25-0000-1000-8000-00805f9b34fb",
  BATTERY_SVC: "0000180f-0000-1000-8000-00805f9b34fb",
  BATTERY_LVL: "00002a19-0000-1000-8000-00805f9b34fb",
};

// --- HELPERS DECODIFICACION ---
const base64ToUtf8 = (value?: string | null): string => {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
};

const decodeNumericString = (value?: string | null): number => {
  const str = base64ToUtf8(value);
  if (!str) return NaN;
  const num = parseFloat(str);
  return isNaN(num) ? NaN : num;
};

const decodeBinaryByte = (value?: string | null): number => {
  if (!value) return 0;
  try {
    const buffer = Buffer.from(value, "base64");
    return buffer.length > 0 ? buffer.readUInt8(0) : 0;
  } catch {
    return 0;
  }
};

const parseBooleanString = (val?: string | null): boolean => {
  const text = base64ToUtf8(val);
  return text.includes("1");
};

const getDeviceCategory = (modelRaw: string): DeviceCategory => {
  const cleanModel = modelRaw.trim().toUpperCase();
  if (cleanModel.includes("A01")) return "WATER";
  if (cleanModel.includes("B01")) return "SOIL";
  if (cleanModel.includes("C01")) return "CLIMATE";
  if (cleanModel.includes("N01")) return "GATEWAY";
  return "UNKNOWN";
};

export const BleProvider = ({ children }: { children: React.ReactNode }) => {
  const managerRef = useRef<BleManager | null>(null);
  if (!managerRef.current) managerRef.current = new BleManager();
  const manager = managerRef.current;

  const [isScanning, setIsScanning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [sensorInfo, setSensorInfo] = useState<SensorInfo | null>(null);
  const [sensorData, setSensorData] = useState<SensorData>({});
  const [scannedDevices, setScannedDevices] = useState<Device[]>([]);
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>(
    INITIAL_DIAGNOSIS_STATUS
  );

  const isScanningRef = useRef(false);
  const isDisconnectingRef = useRef(false);
  
  // Referencias para limpieza
  const activeSubscriptions = useRef<Subscription[]>([]);
  // Usamos 'any' para evitar conflictos entre Timeout de Node y number de Web
  const pollingIntervalRef = useRef<any>(null);
  // Referencia para el Zombie Killer
  const pendingDisconnectId = useRef<string | null>(null);

  const updateScanningState = (scanning: boolean) => {
    isScanningRef.current = scanning;
    setIsScanning(scanning);
  };

  const clearScannedDevices = useCallback(() => {
    setScannedDevices([]);
  }, []);

  // ----------------------------------------------------------------
  // 1. HELPERS LECTURA Y PERMISOS
  // ----------------------------------------------------------------

  const requestPermissions = useCallback(async () => {
    if (Platform.OS === "android") {
      if ((DeviceInfo.platformApiLevel ?? -1) < 31) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          result["android.permission.BLUETOOTH_CONNECT"] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result["android.permission.BLUETOOTH_SCAN"] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result["android.permission.ACCESS_FINE_LOCATION"] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }
    return true;
  }, []);

  const safeReadCharacteristic = useCallback(
    async (
      deviceId: string,
      serviceUUID: string,
      charUUID: string
    ): Promise<string | null> => {
      const uuidShort = charUUID ? charUUID.slice(-4) : "????";
      if (isDisconnectingRef.current) return null;

      const performRead = async () => {
        try {
          if (isDisconnectingRef.current) return null;
          const isAlive = await manager
            .isDeviceConnected(deviceId)
            .catch(() => false);
          if (!isAlive) return null;
          
          const char = await manager.readCharacteristicForDevice(
            deviceId,
            serviceUUID,
            charUUID
          );
          return char?.value || null;
        } catch (e: any) {
          // Ignoramos errores si estamos desconectando
          if (isDisconnectingRef.current || e.message?.includes("not connected")) {
             return null;
          }
          console.log(`[READ-ERR] ${uuidShort}: ${e.message}`);
          return null;
        }
      };

      let result = await withTimeout(
        performRead(),
        2500,
        null,
        `Read-${uuidShort}`
      );

      // Reintento simple si falla y no estamos desconectando
      if (result === null && !isDisconnectingRef.current) {
        await sleep(300);
        if (isDisconnectingRef.current) return null;
        result = await withTimeout(
          performRead(),
          2500,
          null,
          `Retry-${uuidShort}`
        );
      }
      return result;
    },
    [manager]
  );

  const getDeviceInfo = useCallback(
    async (device: Device): Promise<SensorInfo> => {
      let rawModel = "UNKNOWN";
      const deviceName = device.name || device.localName || "";

      if (deviceName.includes("B01")) rawModel = "B01";
      else if (deviceName.includes("C01")) rawModel = "C01";
      else if (deviceName.includes("N01")) rawModel = "N01";
      else if (deviceName.includes("A01")) rawModel = "A01";

      if (rawModel === "UNKNOWN" && !isDisconnectingRef.current) {
        try {
          console.log("[DEV-INFO] Nombre desconocido, intentando lectura nativa...");
          const modelChar = await safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_DEVICE_INFO,
            BLE_UUIDS.CHAR_MODEL_NUM
          );
          if (modelChar) rawModel = base64ToUtf8(modelChar);
        } catch {
          console.log("[DEV-INFO] Lectura nativa falló o bloqueada por ProGuard.");
        }
      }

      return {
        modelNumber: rawModel,
        macAddress: device.id,
        category: getDeviceCategory(rawModel),
      };
    },
    [safeReadCharacteristic]
  );

  const readDiagnosisAndConfig = useCallback(
    async (
      device: Device,
      category: DeviceCategory
    ): Promise<DiagnosisStatus> => {
      let status: DiagnosisStatus = { ...INITIAL_DIAGNOSIS_STATUS };

      try {
        if (isDisconnectingRef.current) return status;

        logTrace("DIAGNOSIS", "--- Iniciando ---");

        if (!(await manager.isDeviceConnected(device.id).catch(() => false))) {
          return status;
        }

        const sdEn = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.SD_ENABLE);
        if (isDisconnectingRef.current) return status; await sleep(50);

        const loraEn = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.LORA_ENABLE);
        if (isDisconnectingRef.current) return status; await sleep(50);

        const sdSt = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_SD_STATUS);
        if (isDisconnectingRef.current) return status; await sleep(50);

        const loraSt = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_LORA_STATUS);
        if (isDisconnectingRef.current) return status; await sleep(50);

        const rtcSt = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_RTC_STATUS);

        if (category === "GATEWAY" && !isDisconnectingRef.current) {
          await sleep(100);
          try {
            const ws = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.STATUS.WIFI_STATUS);
            status.wifiStatus = base64ToUtf8(ws);
          } catch {}
        }

        status.sdEnabled = parseBooleanString(sdEn);
        status.loraEnabled = parseBooleanString(loraEn);
        status.sdStatus = parseBooleanString(sdSt);
        status.loraStatus = parseBooleanString(loraSt);

        const rtcHardwareOK = parseBooleanString(rtcSt);
        status.rtcStatus = rtcHardwareOK ? "OK" : "ERROR";
        status.syncStatus = "IDLE";

        if (!isDisconnectingRef.current) {
            logTrace("DIAGNOSIS", "✅ Finalizada");
        }
        return status;
      } catch (e) {
        console.log("[DIAG] Error en lectura liviana", e);
        return INITIAL_DIAGNOSIS_STATUS;
      }
    },
    [safeReadCharacteristic, manager]
  );

  // ----------------------------------------------------------------
  // 2. LOGICA DE MONITOREO (ESTRATEGIA POLLING)
  // ----------------------------------------------------------------

  const stopMonitoringData = useCallback(() => {
    // 1. Limpiamos intervalo de JS (Polling)
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    // 2. Limpiamos suscripciones nativas si las hubiera
    activeSubscriptions.current.forEach((sub) => {
      try { if (sub) sub.remove(); } catch {}
    });
    activeSubscriptions.current = [];
  }, []);

  const startMonitoringData = useCallback(
    async (device: Device, category: DeviceCategory) => {
      stopMonitoringData();
      logTrace("MONITOR", `Iniciando Polling (Modo Seguro - ${category})`);

      const charsToRead: { service: string; char: string; updateKey: string; isBinary: boolean }[] = [
        { service: BLE_UUIDS.SVC_BATTERY, char: BLE_UUIDS.CHAR_BATTERY_LVL, updateKey: "battery", isBinary: true },
      ];

      if (category === "SOIL") {
        charsToRead.push(
          { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.TEMP_SOIL, updateKey: "soilTemp", isBinary: false },
          { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_1, updateKey: "moisture1", isBinary: false },
          { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_2, updateKey: "moisture2", isBinary: false },
          { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_3, updateKey: "moisture3", isBinary: false }
        );
      } else if (category === "CLIMATE") {
        charsToRead.push(
          { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.C01.TEMP_AMB, updateKey: "airTemp", isBinary: false },
          { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.C01.HUM_AMB, updateKey: "humidity", isBinary: false }
        );
      }

      const readAllSensors = async () => {
        if (!device || isDisconnectingRef.current) return;

        for (const target of charsToRead) {
          if (isDisconnectingRef.current) break; 

          try {
            const char = await manager.readCharacteristicForDevice(
               device.id, 
               target.service, 
               target.char
            ).catch(() => null);

            if (char && char.value && !isDisconnectingRef.current) {
               const val = target.isBinary
                 ? decodeBinaryByte(char.value)
                 : decodeNumericString(char.value);
               
               if (!isNaN(val)) {
                  setSensorData((prev) => ({ ...prev, [target.updateKey]: val }));
               }
            }
          } catch {
             // Ignoramos errores puntuales
          }
        }
      };

      await readAllSensors();

      if (!isDisconnectingRef.current) {
         pollingIntervalRef.current = setInterval(readAllSensors, POLLING_INTERVAL_MS);
      }
    },
    [stopMonitoringData, manager] 
  );

  // ----------------------------------------------------------------
  // 3. FUNCIONES PRINCIPALES
  // ----------------------------------------------------------------

  const stopScan = useCallback(() => {
    manager.stopDeviceScan();
    updateScanningState(false);
  }, [manager]);

  const startScan = useCallback(async () => {
    if (pendingDisconnectId.current) {
        console.log(`[SCAN] Limpiando conexión zombie: ${pendingDisconnectId.current}`);
        try {
            await manager.cancelDeviceConnection(pendingDisconnectId.current);
        } catch {}
        pendingDisconnectId.current = null;
        await sleep(500); 
    }

    const perm = await requestPermissions();
    if (!perm || isScanningRef.current) return;
    setScannedDevices([]);
    updateScanningState(true);
    manager.startDeviceScan(
      null,
      { scanMode: ScanMode.LowLatency },
      (error, device) => {
        if (error) {
          updateScanningState(false);
          return;
        }
        if (device?.name?.includes("SEN-")) {
          setScannedDevices((prev) =>
            !prev.find((d) => d.id === device.id) ? [...prev, device] : prev
          );
        }
      }
    );
  }, [manager, requestPermissions]);

  const disconnectDevice = useCallback(async () => {
    if (isDisconnectingRef.current) return;
    
    if (connectedDevice) {
      setIsBusy(true);
      isDisconnectingRef.current = true;
      
      console.log("[BLE] Desconectando: Deteniendo Polling (Seguro)...");
      
      // 1. Detener el polling
      stopMonitoringData();

      try {
          const isAlive = await manager.isDeviceConnected(connectedDevice.id).catch(() => false);
          if (isAlive) {
            await connectedDevice.cancelConnection();
            console.log("[BLE] Conexión cancelada exitosamente");
          }
      } catch (e) {
          console.log("[BLE] Error al cancelar conexión:", e);
      }

      setConnectedDevice(null);
      setSensorInfo(null);
      setSensorData({});
      setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS); 
      
      // 2. Zombie killer set
      pendingDisconnectId.current = connectedDevice.id;
      const deviceId = connectedDevice.id;
      setTimeout(async () => {
          try {
             if (pendingDisconnectId.current === deviceId) {
                 await manager.cancelDeviceConnection(deviceId);
                 pendingDisconnectId.current = null;
             }
          } catch {}
      }, 2000);

      isDisconnectingRef.current = false;
      setIsBusy(false);
    }
  }, [connectedDevice, stopMonitoringData, manager]);

  const connectToDevice = useCallback(
    async (device: Device) => {
      if (isBusy) return;
      setIsBusy(true);
      logTrace("CONNECT", `Conectando a ${device.id}...`);

      try {
        stopScan();
        if (connectedDevice) {
          await disconnectDevice();
          await sleep(500);
        }
        
        if (pendingDisconnectId.current && pendingDisconnectId.current !== device.id) {
             try { await manager.cancelDeviceConnection(pendingDisconnectId.current); } catch {}
             pendingDisconnectId.current = null;
        }

        isDisconnectingRef.current = false;

        logTrace("CONNECT", "Iniciando...");
        const connected = await device.connect({
          autoConnect: false,
          timeout: CONNECTION_TIMEOUT_MS,
        });

        if (Platform.OS === "android") {
          logTrace("CONNECT", "Solicitando Alta Prioridad...");
          await connected
            .requestConnectionPriority(ConnectionPriority.High)
            .catch(() => {});
          await sleep(300);
        }

        logTrace("CONNECT", "Discovery...");
        await connected.discoverAllServicesAndCharacteristics();

        console.log("[CONNECT] ⏳ Estabilizando (1.0s)...");
        await sleep(1000);

        const info = await getDeviceInfo(connected);

        logTrace("CONNECT", "Diagnosis...");
        const diagnosis = await readDiagnosisAndConfig(
          connected,
          info.category
        );
        
        if (isDisconnectingRef.current) {
             throw new Error("Desconexión solicitada durante el inicio");
        }

        setDiagnosisStatus(diagnosis);

        logTrace("CONNECT", "Monitoreo (Polling)...");
        await startMonitoringData(connected, info.category);

        setConnectedDevice(connected);
        setSensorInfo(info);

        const discSub = connected.onDisconnected(() => {
          logTrace("DISCONNECT", "Inesperada");
          stopMonitoringData(); 
          setConnectedDevice(null);
          setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
          discSub.remove();
        });

        logTrace("CONNECT", "✅ Exitoso");
      } catch (error: any) {
        logTrace("CONNECT_ERR", error.message || "Error");
        stopMonitoringData();
        await manager.cancelDeviceConnection(device.id).catch(() => {});
        setConnectedDevice(null);
        if (error.message?.includes("keep awake")) return;
        if (!isDisconnectingRef.current) {
            throw error;
        }
      } finally {
        setIsBusy(false);
      }
    },
    [
      stopScan,
      connectedDevice,
      isBusy,
      disconnectDevice,
      getDeviceInfo,
      readDiagnosisAndConfig,
      startMonitoringData,
      stopMonitoringData,
      manager,
    ]
  );

  useEffect(() => {
    return () => {
      manager.stopDeviceScan();
    };
  }, [manager]);

  return (
    <BleContext.Provider
      value={{
        manager,
        isScanning,
        isBusy,
        connectedDevice,
        sensorInfo,
        sensorData,
        diagnosisStatus,
        scannedDevices,
        startScan,
        stopScan,
        connectToDevice,
        disconnectDevice,
        clearScannedDevices,
        requestPermissions,
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