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
import { Alert, PermissionsAndroid, Platform } from "react-native";
import {
  BleManager,
  Device,
  ScanMode,
  Subscription,
} from "react-native-ble-plx";
import { BLE_UUIDS } from "../constants/BleUUIDs";

// --- UTILIDADES ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper para timeout en promesas individuales (Evita que una lectura cuelgue todo)
const withTimeout = <T,>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
};

// --- CONSTANTE: TIMEOUT GLOBAL DE CONEXIÓN ---
// Aumentado a 20s para dar margen al Gateway N01 si está ocupado con WiFi
const CONNECTION_TIMEOUT_MS = 20000;

// --- LOGGING HELPER ---
const logTrace = (step: string, msg: string) =>
  console.log(`[BLE-TRACE] (${step}) ${msg}`);

// --- TIPOS Y ESTADOS ---
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
  // Datos B01 (Suelo)
  soilTemp?: number;
  moisture1?: number;
  moisture2?: number;
  moisture3?: number;
  // Datos C01 (Clima)
  airTemp?: number;
  humidity?: number;
  // Datos A01 (Agua)
  waterLevel?: number;
  flowRate?: number;
}

export interface DiagnosisStatus {
  // Comunes
  sdEnabled: boolean;
  loraEnabled: boolean;
  sdStatus: boolean;
  loraStatus: boolean;
  rtcStatus: "OK" | "WARNING" | "ERROR";

  // Exclusivos Gateway (N01)
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
  wifiStatus: undefined,
  syncStatus: undefined,
  lastSync: undefined,
  sensorsList: undefined,
};

// --- HELPERS DE DECODIFICACIÓN ---
const base64ToUtf8 = (value?: string | null): string => {
  if (!value) return "";
  return Buffer.from(value, "base64").toString("utf8").trim();
};
const decodeNumericString = (value?: string | null): number => {
  const str = base64ToUtf8(value);
  return parseFloat(str) || NaN;
};
const decodeBinaryByte = (value?: string | null): number => {
  if (!value) return 0;
  const buffer = Buffer.from(value, "base64");
  return buffer.length > 0 ? buffer.readUInt8(0) : 0;
};
const parseBooleanString = (val?: string | null): boolean => {
  const text = base64ToUtf8(val);
  return text.includes("1");
};

const getDeviceCategory = (modelRaw: string): DeviceCategory => {
  const cleanModel = modelRaw.trim().toUpperCase();
  const prefix = cleanModel.charAt(0);
  switch (prefix) {
    case "A":
      return "WATER";
    case "B":
      return "SOIL";
    case "C":
      return "CLIMATE";
    case "N":
      return "GATEWAY";
    default:
      return "UNKNOWN";
  }
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
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>(
    INITIAL_DIAGNOSIS_STATUS
  );

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

  // --- LECTURA SEGURA (BULLETPROOF) ---
  // Si una característica tarda más de 3s, la salta y devuelve null.
  const safeReadCharacteristic = useCallback(
    async (
      deviceId: string,
      serviceUUID: string,
      charUUID: string
    ): Promise<string | null> => {
      return withTimeout(
        (async () => {
          try {
            const char = await managerRef.current.readCharacteristicForDevice(
              deviceId,
              serviceUUID,
              charUUID
            );
            return char.value;
          } catch (error) {
            return null;
          }
        })(),
        3000, // 3 segundos máximo por lectura
        null
      );
    },
    []
  );

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

  const getDeviceInfo = useCallback(
    async (device: Device): Promise<SensorInfo> => {
      try {
        // Lectura crítica: Modelo y Serial. Si esto falla, falla todo.
        const modelChar = await device.readCharacteristicForService(
          BLE_UUIDS.SVC_DEVICE_INFO,
          BLE_UUIDS.CHAR_MODEL_NUM
        );
        const serialChar = await device.readCharacteristicForService(
          BLE_UUIDS.SVC_DEVICE_INFO,
          BLE_UUIDS.CHAR_SERIAL_NUM
        );

        const rawModel = base64ToUtf8(modelChar.value);
        return {
          modelNumber: rawModel,
          macAddress: base64ToUtf8(serialChar.value),
          category: getDeviceCategory(rawModel),
        };
      } catch (error) {
        console.error("Error leyendo info:", error);
        return {
          modelNumber: "UNKNOWN",
          macAddress: "UNKNOWN",
          category: "UNKNOWN",
        };
      }
    },
    []
  );

  // --- LECTURA DE DIAGNÓSTICO SECUENCIAL (ANTI-CONGESTIÓN) ---
  const readDiagnosisAndConfig = useCallback(
    async (
      device: Device,
      category: DeviceCategory
    ): Promise<DiagnosisStatus> => {
      try {
        logTrace("DIAGNOSIS", "Iniciando lectura robusta...");

        // 1. Configuración Base (Secuencial o grupos pequeños)
        // RTC_SYNC es importante, lo leemos solo.
        const rtcSync = await safeReadCharacteristic(
          device.id,
          BLE_UUIDS.SVC_CONFIG,
          BLE_UUIDS.CONFIG.RTC_SYNC
        );

        await sleep(100); // Pequeña pausa para el ESP32

        const [sdEn, loraEn] = await Promise.all([
          safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_CONFIG,
            BLE_UUIDS.CONFIG.SD_ENABLE
          ),
          safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_CONFIG,
            BLE_UUIDS.CONFIG.LORA_ENABLE
          ),
        ]);

        await sleep(100);

        // 2. Estados de Hardware
        const [sdSt, loraSt, rtcSt] = await Promise.all([
          safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_STATUS,
            BLE_UUIDS.CHAR_SD_STATUS
          ),
          safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_STATUS,
            BLE_UUIDS.CHAR_LORA_STATUS
          ),
          safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_STATUS,
            BLE_UUIDS.CHAR_RTC_STATUS
          ),
        ]);

        // 3. Exclusivo Gateway: Leer WiFi y Sync (Datos pesados)
        let wifiStatus = undefined;
        let lastSync = undefined;
        let sensorsList = undefined;

        if (category === "GATEWAY") {
          await sleep(200); // Pausa mayor antes de paquetes grandes
          logTrace("DIAGNOSIS", "Leyendo WiFi Status...");

          const ws = await safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_STATUS,
            BLE_UUIDS.STATUS.WIFI_STATUS
          );
          wifiStatus = base64ToUtf8(ws);

          await sleep(150);

          logTrace("DIAGNOSIS", "Leyendo Last Sync...");
          const ls = await safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_STATUS,
            BLE_UUIDS.STATUS.LAST_SYNC
          );
          lastSync = base64ToUtf8(ls);

          await sleep(150);

          logTrace("DIAGNOSIS", "Leyendo Sensors List...");
          const sl = await safeReadCharacteristic(
            device.id,
            BLE_UUIDS.SVC_STATUS,
            BLE_UUIDS.STATUS.SENSORS_LIST
          );
          sensorsList = base64ToUtf8(sl);
        }

        // --- PROCESAMIENTO ---
        const sdEnabled = parseBooleanString(sdEn);
        const loraEnabled = parseBooleanString(loraEn);
        const sdStatus = parseBooleanString(sdSt);
        const loraStatus = parseBooleanString(loraSt);

        const rtcHardwareOK = parseBooleanString(rtcSt);
        let rtcState: "OK" | "WARNING" | "ERROR" = "OK";

        if (!rtcHardwareOK) {
          rtcState = "ERROR";
        } else if (rtcSync) {
          const rtcString = base64ToUtf8(rtcSync);
          // Validación básica de fecha para detectar reset (1970)
          if (rtcString.length < 5 || rtcString.includes("1970")) {
            rtcState = "ERROR";
          }
        }

        return {
          sdEnabled,
          loraEnabled,
          sdStatus,
          loraStatus,
          rtcStatus: rtcState,
          wifiStatus,
          lastSync,
          syncStatus: "IDLE",
          sensorsList,
        };
      } catch (error) {
        console.log("Error recuperable en diagnosis:", error);
        return INITIAL_DIAGNOSIS_STATUS;
      }
    },
    [safeReadCharacteristic]
  );

  // --- MONITOREO DE DATOS ---
  const stopMonitoringData = useCallback(
    (forceNativeRemove: boolean = true) => {
      if (activeSubscriptions.current.length === 0) return;

      if (forceNativeRemove) {
        logTrace(
          "MONITOR",
          `Removiendo ${activeSubscriptions.current.length} suscripciones...`
        );
        activeSubscriptions.current.forEach((subscription) => {
          try {
            // Protección contra el crash de Android NullPointerException
            if (subscription && typeof subscription.remove === "function") {
              subscription.remove();
            }
          } catch (e) {
            // Silenciamos fallos nativos durante la desconexión
          }
        });
      }
      activeSubscriptions.current = [];
    },
    []
  );

  const startMonitoringData = useCallback(
    async (device: Device, category: DeviceCategory) => {
      stopMonitoringData(true);
      logTrace("MONITOR", `Iniciando monitoreo para: ${category}`);

      const charsToMonitor: {
        service: string;
        char: string;
        updateKey?: keyof SensorData;
        isBinary: boolean;
        isStatus?: boolean;
      }[] = [
        {
          service: BLE_UUIDS.SVC_BATTERY,
          char: BLE_UUIDS.CHAR_BATTERY_LVL,
          updateKey: "battery",
          isBinary: true,
        },
      ];

      switch (category) {
        case "SOIL":
          charsToMonitor.push(
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.B01.TEMP_SOIL,
              updateKey: "soilTemp",
              isBinary: false,
            },
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.B01.MOIST_1,
              updateKey: "moisture1",
              isBinary: false,
            },
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.B01.MOIST_2,
              updateKey: "moisture2",
              isBinary: false,
            },
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.B01.MOIST_3,
              updateKey: "moisture3",
              isBinary: false,
            }
          );
          break;
        case "CLIMATE":
          charsToMonitor.push(
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.C01.TEMP_AMB,
              updateKey: "airTemp",
              isBinary: false,
            },
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.C01.HUM_AMB,
              updateKey: "humidity",
              isBinary: false,
            }
          );
          break;
        case "WATER":
          charsToMonitor.push(
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.A01.WATER_LEVEL,
              updateKey: "waterLevel",
              isBinary: false,
            },
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.A01.FLOW_RATE,
              updateKey: "flowRate",
              isBinary: false,
            }
          );
          break;
        case "GATEWAY":
          // Monitoreo de Status (WiFi/Sync)
          charsToMonitor.push(
            {
              service: BLE_UUIDS.SVC_STATUS,
              char: BLE_UUIDS.STATUS.WIFI_STATUS,
              isBinary: false,
              isStatus: true,
            },
            {
              service: BLE_UUIDS.SVC_STATUS,
              char: BLE_UUIDS.STATUS.SYNC_STATUS,
              isBinary: false,
              isStatus: true,
            },
            {
              service: BLE_UUIDS.SVC_STATUS,
              char: BLE_UUIDS.STATUS.SENSORS_LIST,
              isBinary: false,
              isStatus: true,
            }
          );
          // Monitoreo de Sensores Locales (Gateway actuando como nodo)
          charsToMonitor.push(
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.B01.TEMP_SOIL,
              updateKey: "soilTemp",
              isBinary: false,
            },
            {
              service: BLE_UUIDS.SVC_SENSORS,
              char: BLE_UUIDS.B01.MOIST_1,
              updateKey: "moisture1",
              isBinary: false,
            }
          );
          break;
      }

      charsToMonitor.forEach(
        ({ service, char, updateKey, isBinary, isStatus }) => {
          const sub = device.monitorCharacteristicForService(
            service,
            char,
            (error, characteristic) => {
              if (error || !characteristic?.value) return;

              if (isStatus && category === "GATEWAY") {
                const valStr = base64ToUtf8(characteristic.value);
                if (char === BLE_UUIDS.STATUS.WIFI_STATUS) {
                  setDiagnosisStatus((prev) => ({
                    ...prev,
                    wifiStatus: valStr,
                  }));
                } else if (char === BLE_UUIDS.STATUS.SYNC_STATUS) {
                  setDiagnosisStatus((prev) => ({
                    ...prev,
                    syncStatus: valStr,
                  }));
                } else if (char === BLE_UUIDS.STATUS.SENSORS_LIST) {
                  setDiagnosisStatus((prev) => ({
                    ...prev,
                    sensorsList: valStr,
                  }));
                }
              } else if (updateKey) {
                let value: number;
                if (isBinary) value = decodeBinaryByte(characteristic.value);
                else value = decodeNumericString(characteristic.value);

                if (!isNaN(value)) {
                  setSensorData((prevData) => ({
                    ...prevData,
                    [updateKey]: value,
                  }));
                }
              }
            }
          );
          activeSubscriptions.current.push(sub);
        }
      );
    },
    [stopMonitoringData]
  );

  // --- SCANNING ---
  const startScan = useCallback(async () => {
    const hasPerm = await requestPermissions();
    if (!hasPerm) return;
    if (isScanningRef.current) return;

    logTrace("SCAN", "Iniciando escaneo LowLatency...");
    setScannedDevices([]);
    updateScanningState(true);

    manager.startDeviceScan(
      null,
      { scanMode: ScanMode.LowLatency },
      (error, device) => {
        if (error) {
          logTrace("SCAN", "Error: " + error.message);
          updateScanningState(false);
          return;
        }
        if (device && device.name && device.name.includes("SEN-")) {
          setScannedDevices((prevState) => {
            if (!prevState.find((d) => d.id === device.id))
              return [...prevState, device];
            return prevState;
          });
        }
      }
    );
  }, [manager, requestPermissions]);

  const stopScan = useCallback(() => {
    logTrace("SCAN", "Deteniendo escaneo.");
    manager.stopDeviceScan();
    updateScanningState(false);
  }, [manager]);

  // --- DISCONNECT ---
  const disconnectDevice = useCallback(async () => {
    if (isDisconnectingRef.current) return;

    if (connectedDevice) {
      setIsBusy(true);
      logTrace("DISCONNECT", `Desconectando ${connectedDevice.id}...`);
      isDisconnectingRef.current = true;

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

  // --- CONNECT (LÓGICA PRINCIPAL) ---
  const connectToDevice = useCallback(
    async (device: Device) => {
      setIsBusy(true);
      logTrace(
        "CONNECT",
        `Iniciando conexión a ${device.id || device.name}...`
      );

      try {
        stopScan();

        if (connectedDevice) {
          logTrace("CONNECT", "Dispositivo previo detectado. Desconectando...");
          await disconnectDevice();
          await sleep(500);
        }

        isDisconnectingRef.current = false;
        setSensorData({});

        // --- SUB-FUNCIÓN DE CONEXIÓN ---
        const performConnection = async () => {
          logTrace("CONNECT", "Conectando nativo...");
          // Agregamos opciones para evitar el autoConnect que a veces causa demoras
          const connected = await device.connect({ autoConnect: false });

          logTrace("CONNECT", "Descubriendo servicios...");
          await connected.discoverAllServicesAndCharacteristics();

          logTrace("CONNECT", "Leyendo info...");
          const info = await getDeviceInfo(connected);

          logTrace("CONNECT", "Leyendo diagnóstico...");
          const diagnosis = await readDiagnosisAndConfig(
            connected,
            info.category
          );
          setDiagnosisStatus(diagnosis);

          logTrace("CONNECT", "Iniciando monitoreo...");
          await startMonitoringData(connected, info.category);

          return { connected, info };
        };

        // --- TIMEOUT CONTROLADO DESDE JS ---
        // Definimos un error específico para nuestro timeout
        const JS_TIMEOUT_ERROR = "JS_TIMEOUT_CRITICAL";

        const timeoutPromise = new Promise(
          (_, reject) =>
            setTimeout(() => reject(new Error(JS_TIMEOUT_ERROR)), 20000) // 20 segundos para el handshake inicial
        );

        // Carrera entre la conexión y nuestro timeout de JS
        // @ts-ignore
        const result: { connected: Device; info: SensorInfo } =
          await Promise.race([performConnection(), timeoutPromise]);

        // Si llegamos aquí, la conexión fue exitosa
        setConnectedDevice(result.connected);
        setSensorInfo(result.info);

        // Suscripción de desconexión con limpieza segura
        const discSub = result.connected.onDisconnected(
          (error, disconnectedDevice) => {
            if (isDisconnectingRef.current) {
              discSub.remove();
              return;
            }
            logTrace("DISCONNECT", "INESPERADA (Sensor se durmió o alejó).");
            stopMonitoringData(true);
            setConnectedDevice(null);
            setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
            discSub.remove();
          }
        );

        logTrace("CONNECT", "¡Conexión Exitosa!");
      } catch (error: any) {
        logTrace("CONNECT_ERROR_CATCH", error.message);

        // Si falló por nuestro timeout o por error nativo, limpiamos agresivamente
        let msg = "No se pudo conectar. Intente nuevamente.";

        if (error.message === "JS_TIMEOUT_CRITICAL") {
          msg = "El sensor no respondió a tiempo. Intente despertarlo.";
          logTrace("CONNECT", "Cancelando conexión colgada por Timeout JS.");
        }

        Alert.alert("Error de Conexión", msg);

        stopMonitoringData(false);

        // Intentamos cancelar la conexión nativa para liberar el stack de Bluetooth
        try {
          // Usamos el ID directamente si el objeto device está en un estado inconsistente
          await manager.cancelDeviceConnection(device.id);
        } catch (e) {
          logTrace("CONNECT", "Error al liberar stack nativo (ignorable).");
        }

        setConnectedDevice(null);
        setSensorInfo(null);
        setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);

        // LANZAMOS EL ERROR para que el componente que llamó (HomeScreen) se entere
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [
      stopScan,
      connectedDevice,
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
      manager.destroy();
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
