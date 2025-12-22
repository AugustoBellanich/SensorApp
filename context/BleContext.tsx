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
  Device,
  ScanMode,
  Subscription,
} from "react-native-ble-plx";
import { BLE_UUIDS } from "../constants/BleUUIDs";

// --- UTILIDADES ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const CONNECTION_TIMEOUT_MS = 20000;

const logTrace = (step: string, msg: string) =>
  console.log(`[BLE-TRACE] (${step}) ${msg}`);

// --- TIPOS ---
export type DeviceCategory = "WATER" | "SOIL" | "CLIMATE" | "GATEWAY" | "UNKNOWN";

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

// --- HELPERS DECODIFICACIÓN REFORZADOS (ANTI-CRASH) ---
const base64ToUtf8 = (value?: string | null): string => {
  try {
    if (!value || value.length < 2) return "";
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
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>(INITIAL_DIAGNOSIS_STATUS);

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

  const safeReadCharacteristic = useCallback(
    async (deviceId: string, serviceUUID: string, charUUID: string): Promise<string | null> => {
      return withTimeout(
        (async () => {
          try {
            const isAlive = await manager.isDeviceConnected(deviceId);
            if (!isAlive) return null;
            const char = await manager.readCharacteristicForDevice(deviceId, serviceUUID, charUUID);
            return char?.value || null;
          } catch {
            return null;
          }
        })(),
        3000,
        null
      );
    },
    [manager]
  );

  const requestPermissions = useCallback(async () => {
    if (Platform.OS === "android") {
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
          result["android.permission.BLUETOOTH_CONNECT"] === PermissionsAndroid.RESULTS.GRANTED &&
          result["android.permission.BLUETOOTH_SCAN"] === PermissionsAndroid.RESULTS.GRANTED &&
          result["android.permission.ACCESS_FINE_LOCATION"] === PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }
    return true;
  }, []);

  const getDeviceInfo = useCallback(async (device: Device): Promise<SensorInfo> => {
    let rawModel = "UNKNOWN";
    let macAddress = device.id;
    try {
      const modelChar = await device.readCharacteristicForService(BLE_UUIDS.SVC_DEVICE_INFO, BLE_UUIDS.CHAR_MODEL_NUM).catch(() => null);
      if (modelChar?.value) rawModel = base64ToUtf8(modelChar.value);
      const serialChar = await device.readCharacteristicForService(BLE_UUIDS.SVC_DEVICE_INFO, BLE_UUIDS.CHAR_SERIAL_NUM).catch(() => null);
      if (serialChar?.value) macAddress = base64ToUtf8(serialChar.value);
    } catch {}

    if (rawModel === "UNKNOWN" || getDeviceCategory(rawModel) === "UNKNOWN") {
      const name = device.name || "";
      if (name.includes("B01")) rawModel = "B01";
      else if (name.includes("C01")) rawModel = "C01";
      else if (name.includes("A01")) rawModel = "A01";
      else if (name.includes("N01")) rawModel = "N01";
    }
    return { modelNumber: rawModel, macAddress: macAddress, category: getDeviceCategory(rawModel) };
  }, []);

  // --- DIAGNOSIS SECUENCIAL (EVITA CRASHES POR BATCH) ---
  const readDiagnosisAndConfig = useCallback(async (device: Device, category: DeviceCategory): Promise<DiagnosisStatus> => {
    let status: DiagnosisStatus = { ...INITIAL_DIAGNOSIS_STATUS };
    try {
      logTrace("DIAGNOSIS", "Iniciando lectura secuencial...");
      
      const rtcSync = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.RTC_SYNC);
      await sleep(100);
      const sdEn = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.SD_ENABLE);
      await sleep(100);
      const loraEn = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_CONFIG, BLE_UUIDS.CONFIG.LORA_ENABLE);
      await sleep(100);
      const sdSt = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_SD_STATUS);
      await sleep(100);
      const loraSt = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_LORA_STATUS);
      await sleep(100);
      const rtcSt = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.CHAR_RTC_STATUS);

      if (category === "GATEWAY") {
        await sleep(150);
        const ws = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.STATUS.WIFI_STATUS);
        status.wifiStatus = base64ToUtf8(ws);
        await sleep(100);
        const ls = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.STATUS.LAST_SYNC);
        status.lastSync = base64ToUtf8(ls);
        await sleep(100);
        const sl = await safeReadCharacteristic(device.id, BLE_UUIDS.SVC_STATUS, BLE_UUIDS.STATUS.SENSORS_LIST);
        status.sensorsList = base64ToUtf8(sl);
      }

      const rtcHardwareOK = parseBooleanString(rtcSt);
      let rtcState: "OK" | "WARNING" | "ERROR" = "OK";
      if (!rtcHardwareOK) rtcState = "ERROR";
      else if (rtcSync) {
        const rtcString = base64ToUtf8(rtcSync);
        if (rtcString.length < 5 || rtcString.includes("1970")) rtcState = "WARNING";
      }

      status.sdEnabled = parseBooleanString(sdEn);
      status.loraEnabled = parseBooleanString(loraEn);
      status.sdStatus = parseBooleanString(sdSt);
      status.loraStatus = parseBooleanString(loraSt);
      status.rtcStatus = rtcState;
      status.syncStatus = "IDLE";
      return status;
    } catch {
      return INITIAL_DIAGNOSIS_STATUS;
    }
  }, [safeReadCharacteristic]);

  const stopMonitoringData = useCallback((forceNativeRemove: boolean = true) => {
    if (activeSubscriptions.current.length === 0) return;
    if (forceNativeRemove) {
      activeSubscriptions.current.forEach((sub) => {
        try { if (sub) sub.remove(); } catch {}
      });
    }
    activeSubscriptions.current = [];
  }, []);

  const stopScan = useCallback(() => {
    logTrace("SCAN", "Stop.");
    manager.stopDeviceScan();
    updateScanningState(false);
  }, [manager]);

  const startScan = useCallback(async () => {
    const perm = await requestPermissions();
    if (!perm || isScanningRef.current) return;
    logTrace("SCAN", "Iniciando escaneo...");
    setScannedDevices([]);
    updateScanningState(true);
    manager.startDeviceScan(null, { scanMode: ScanMode.LowLatency }, (error, device) => {
      if (error) { updateScanningState(false); return; }
      if (device?.name?.includes("SEN-")) {
        setScannedDevices(prev => (!prev.find(d => d.id === device.id) ? [...prev, device] : prev));
      }
    });
  }, [manager, requestPermissions]);

  const disconnectDevice = useCallback(async () => {
    if (isDisconnectingRef.current) return;
    if (connectedDevice) {
      setIsBusy(true);
      isDisconnectingRef.current = true;
      stopMonitoringData(false);
      try { 
          const isAlive = await manager.isDeviceConnected(connectedDevice.id).catch(() => false);
          if (isAlive) await connectedDevice.cancelConnection(); 
      } catch {}
      setConnectedDevice(null);
      setSensorInfo(null);
      setSensorData({});
      setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
      isDisconnectingRef.current = false;
      setIsBusy(false);
    }
  }, [connectedDevice, stopMonitoringData, manager]);

  const startMonitoringData = useCallback(async (device: Device, category: DeviceCategory) => {
    stopMonitoringData(true);
    logTrace("MONITOR", `Iniciando monitoreo (${category})...`);

    const UUID_BAT_SVC = "0000180f-0000-1000-8000-00805f9b34fb";
    const UUID_BAT_CHAR = "00002a19-0000-1000-8000-00805f9b34fb";

    try {
        const batChar = await device.readCharacteristicForService(UUID_BAT_SVC, UUID_BAT_CHAR).catch(() => null);
        if (batChar?.value) {
            const val = decodeBinaryByte(batChar.value);
            setSensorData(prev => ({ ...prev, battery: val }));
        }
    } catch {}

    const charsToMonitor = [
      { service: UUID_BAT_SVC, char: UUID_BAT_CHAR, updateKey: "battery", isBinary: true },
    ];

    if (category === "SOIL") {
      charsToMonitor.push(
        { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.TEMP_SOIL, updateKey: "soilTemp", isBinary: false },
        { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_1, updateKey: "moisture1", isBinary: false },
        { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_2, updateKey: "moisture2", isBinary: false },
        { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.B01.MOIST_3, updateKey: "moisture3", isBinary: false }
      );
    } else if (category === "CLIMATE") {
      charsToMonitor.push(
        { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.C01.TEMP_AMB, updateKey: "airTemp", isBinary: false },
        { service: BLE_UUIDS.SVC_SENSORS, char: BLE_UUIDS.C01.HUM_AMB, updateKey: "humidity", isBinary: false }
      );
    }

    charsToMonitor.forEach(({ service, char, updateKey, isBinary }: any) => {
      const sub = device.monitorCharacteristicForService(service, char, (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const value = isBinary ? decodeBinaryByte(characteristic.value) : decodeNumericString(characteristic.value);
        if (!isNaN(value)) setSensorData(prev => ({ ...prev, [updateKey]: value }));
      });
      activeSubscriptions.current.push(sub);
    });
  }, [stopMonitoringData]);

  const connectToDevice = useCallback(async (device: Device) => {
    if (isBusy) return;
    setIsBusy(true);
    logTrace("CONNECT", `Conectando a ${device.id}...`);

    try {
      stopScan();
      if (connectedDevice) {
        await disconnectDevice();
        await sleep(500);
      }
      isDisconnectingRef.current = false;

      logTrace("CONNECT", "Iniciando...");
      const connected = await device.connect({ autoConnect: false, timeout: 15000 });
      
      if (Platform.OS === 'android') {
          logTrace("CONNECT", "Negociando MTU...");
          await connected.requestMTU(512).catch(() => {});
      }

      logTrace("CONNECT", "Discovery...");
      await connected.discoverAllServicesAndCharacteristics();
      
      const info = await getDeviceInfo(connected);
      logTrace("CONNECT", "Diagnosis...");
      const diagnosis = await readDiagnosisAndConfig(connected, info.category);
      setDiagnosisStatus(diagnosis);

      logTrace("CONNECT", "Monitoreo...");
      await startMonitoringData(connected, info.category);

      setConnectedDevice(connected);
      setSensorInfo(info);

      const discSub = connected.onDisconnected(() => {
        logTrace("DISCONNECT", "Inesperada");
        stopMonitoringData(false);
        setConnectedDevice(null);
        setDiagnosisStatus(INITIAL_DIAGNOSIS_STATUS);
        discSub.remove();
      });

      logTrace("CONNECT", "✅ Exitoso");
    } catch (error: any) {
      logTrace("CONNECT_ERR", error.message || "Error");
      stopMonitoringData(false);
      await manager.cancelDeviceConnection(device.id).catch(() => {});
      setConnectedDevice(null);
      throw error;
    } finally {
      setIsBusy(false);
    }
  }, [stopScan, connectedDevice, isBusy, disconnectDevice, getDeviceInfo, readDiagnosisAndConfig, startMonitoringData, stopMonitoringData, manager]);

  useEffect(() => {
    return () => { manager.stopDeviceScan(); };
  }, [manager]);

  return (
    <BleContext.Provider value={{ manager, isScanning, isBusy, connectedDevice, sensorInfo, sensorData, diagnosisStatus, scannedDevices, startScan, stopScan, connectToDevice, disconnectDevice, clearScannedDevices, requestPermissions }}>
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