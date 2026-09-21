import { Buffer } from "buffer";
import { useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { Device } from "react-native-ble-plx";
import { BLE_UUIDS } from "../constants/BleUUIDs";

// --- CAMBIO 1: IMPORTAMOS EL PARSER CENTRALIZADO ---
import { parseSensorCSV } from "../utils/dataProcessing";

export type TimeRange = "Hoy" | "1D" | "7D" | "30D" | "Custom";
export type DownloadStatus =
  | "idle"
  | "downloading"
  | "processing"
  | "ready"
  | "error";

// (La interfaz DownloadResult ya no es estrictamente necesaria porque usamos any[], pero la dejamos por referencia)
interface DownloadResult {
  timestamp: number;
  [key: string]: number;
}

export const useSDDownloader = () => {
  // --- ESTADOS UI ---
  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [progressMsg, setProgressMsg] = useState("");
  const [fileProgress, setFileProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);

  // --- CONTROL INTERNO ---
  const subscriptionRef = useRef<any>(null);
  const activeResolver = useRef<((value: string | null) => void) | null>(null);

  // Buffers
  const currentFileBuffer = useRef<string>("");
  const fileSizeRef = useRef<number>(0);
  const lastProgressUpdate = useRef<number>(0);
  const inPayloadRef = useRef<boolean>(false); // true entre DATA_START y DATA_END

  // --- CAMBIO 2: Usamos any[] para recibir los datos limpios del parser ---
  const accummulatedData = useRef<any[]>([]);

  // --- CONTROL DE CONCURRENCIA ---
  const abortRef = useRef(false);
  const currentSessionId = useRef<number>(0);

  // --- WATCHDOG ---
  const watchdogTimer = useRef<any>(null);

  const kickWatchdog = () => {
    if (watchdogTimer.current) clearTimeout(watchdogTimer.current);

    watchdogTimer.current = setTimeout(() => {
      if (activeResolver.current) {
        console.warn(`[SD] 🛑 Watchdog: Silencio detectado > 3s.`);
        // Si tenemos algo de buffer, lo devolvemos para no perder todo
        if (currentFileBuffer.current.length > 50) {
          activeResolver.current(currentFileBuffer.current);
        } else {
          activeResolver.current(null);
        }
        activeResolver.current = null;
      }
    }, 3000);
  };

  // 1. GENERAR COLA
  const generateFileQueue = (
    range: TimeRange,
    customStart?: Date,
    customEnd?: Date,
  ): string[] => {
    const files: string[] = [];
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    switch (range) {
      case "Hoy":
        startDate = now;
        endDate = now;
        break;
      case "1D":
        startDate = new Date();
        startDate.setDate(now.getDate() - 1);
        endDate = now;
        break;
      case "7D":
        startDate = new Date();
        startDate.setDate(now.getDate() - 7);
        endDate = now;
        break;
      case "30D":
        startDate = new Date();
        startDate.setDate(now.getDate() - 30);
        endDate = now;
        break;
      case "Custom":
        if (customStart) startDate = customStart;
        if (customEnd) endDate = customEnd;
        else endDate = customStart || now;
        break;
    }

    let current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const endLimit = new Date(endDate);
    endLimit.setHours(23, 59, 59, 999);

    while (current <= endLimit) {
      const yy = current.getFullYear().toString().substring(2);
      const mm = (current.getMonth() + 1).toString().padStart(2, "0");
      const dd = current.getDate().toString().padStart(2, "0");
      files.push(`/${yy}${mm}${dd}.csv`);
      current.setDate(current.getDate() + 1);
    }
    return files.reverse();
  };

  // 2. CANAL DE DATOS
  const setupNotificationChannel = async (
    device: Device,
    sessionId: number,
  ) => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }

    await new Promise((r) => setTimeout(r, 200));

    subscriptionRef.current = device.monitorCharacteristicForService(
      BLE_UUIDS.SVC_STORAGE,
      BLE_UUIDS.STORAGE.FILE_CONTENT,
      (error, characteristic) => {
        if (currentSessionId.current !== sessionId) return;

        if (error) {
          if (error.errorCode !== 2 && !abortRef.current)
            console.error("[SD] ErrMon:", error);
          return;
        }

        if (!characteristic?.value) return;

        kickWatchdog();

        const chunk = Buffer.from(characteristic.value, "base64").toString(
          "utf-8",
        );

        // Tokens de control: comparación EXACTA (no substring), para que jamás
        // se confundan con datos crudos del CSV.
        if (chunk.startsWith("META:")) {
          const sizeMatch = chunk.match(/SIZE=(\d+)/);
          if (sizeMatch) fileSizeRef.current = parseInt(sizeMatch[1]);
          currentFileBuffer.current = "";
          lastProgressUpdate.current = 0;
          inPayloadRef.current = false;
          console.log(`[SD] Inicio descarga. Tamaño: ${fileSizeRef.current}`);
        } else if (chunk === "DATA_START") {
          inPayloadRef.current = true;
        } else if (chunk === "DATA_END") {
          inPayloadRef.current = false;
        } else if (chunk === "DONE") {
          if (activeResolver.current) {
            if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
            activeResolver.current(currentFileBuffer.current.slice(0));
            activeResolver.current = null;
          }
        } else if (
          chunk === "ERR SD" ||
          chunk === "ERR OPEN" ||
          chunk === "ERR NOFILE" ||
          chunk === "ERR MEM"
        ) {
          console.warn("[SD] Error reportado por firmware:", chunk);
          if (activeResolver.current) {
            if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
            activeResolver.current(null);
            activeResolver.current = null;
          }
        } else if (inPayloadRef.current) {
          // Solo acumulamos si estamos DENTRO de DATA_START..DATA_END
          currentFileBuffer.current += chunk;
          const now = Date.now();
          if (
            fileSizeRef.current > 0 &&
            now - lastProgressUpdate.current > 300
          ) {
            const pct = Math.min(
              100,
              Math.floor(
                (currentFileBuffer.current.length / fileSizeRef.current) * 100,
              ),
            );
            setFileProgress(pct);
            lastProgressUpdate.current = now;
          }
        }
      },
    );
  };

  // 3. DESCARGA UNITARIA
  const downloadSingleFile = async (
    device: Device,
    filename: string,
  ): Promise<string | null> => {
    return new Promise(async (resolve) => {
      activeResolver.current = resolve;
      currentFileBuffer.current = "";
      fileSizeRef.current = 0;
      inPayloadRef.current = false;

      if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
      watchdogTimer.current = setTimeout(() => {
        console.warn(
          `[SD] Timeout Inicial: No hubo respuesta para ${filename}`,
        );
        if (activeResolver.current) {
          activeResolver.current(null);
          activeResolver.current = null;
        }
      }, 4000);
      const command = filename;
      const base64Cmd = Buffer.from(command).toString("base64");

      try {
        await device.writeCharacteristicWithResponseForService(
          BLE_UUIDS.SVC_STORAGE,
          BLE_UUIDS.STORAGE.FILE_CONTENT,
          base64Cmd,
        );
      } catch (e) {
        console.error(`[SD] ErrWrite:`, e);
        if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
        resolve(null);
      }
    });
  };

  // --- CAMBIO 3: ELIMINADA parseFullFileContent (Ahora usamos la importada) ---

  // 4. START DOWNLOAD (Refactorizado)
  const startDownload = async (
    device: Device | null,
    sensorType: string,
    range: TimeRange,
    customStart?: Date,
    customEnd?: Date,
  ) => {
    if (!device) {
      Alert.alert("Error", "No conectado");
      return;
    }

    currentSessionId.current += 1;
    const mySessionId = currentSessionId.current;

    setStatus("downloading");
    setFilesProcessed(0);
    accummulatedData.current = [];
    abortRef.current = false;
    let consecutiveErrors = 0;

    try {
      if (Platform.OS === "android") {
        try {
          await device.requestMTU(512);
        } catch {}
      }

      const queue = generateFileQueue(range, customStart, customEnd);
      setTotalFiles(queue.length);

      await setupNotificationChannel(device, mySessionId);
      await new Promise((r) => setTimeout(r, 300));

      for (const filename of queue) {
        if (abortRef.current || currentSessionId.current !== mySessionId) break;

        if (range !== "Custom" && consecutiveErrors >= 5) {
          console.log("[SD] Parada inteligente.");
          break;
        }

        setProgressMsg(`Bajando ${filename}...`);
        setFileProgress(0);

        await new Promise((r) => setTimeout(r, 400));

        try {
          // Obtenemos el contenido CRUDO del archivo (string gigante)
          const contentRaw = await downloadSingleFile(device, filename);

          if (contentRaw && contentRaw.length > 20) {
            // --- CAMBIO 4: USAMOS EL PARSER EXTERNO ---
            // Esto limpia el string, arregla fechas y devuelve objetos
            const parsedItems = parseSensorCSV(contentRaw, sensorType);

            if (parsedItems.length > 0) {
              // Agregamos al acumulador
              accummulatedData.current.push(...parsedItems);
            }
            consecutiveErrors = 0;
          } else {
            consecutiveErrors++;
          }
        } catch (err) {
          console.warn(`[SD-HOOK] Error descargando ${filename}:`, err);
          consecutiveErrors++;
        }
        setFilesProcessed((prev) => prev + 1);
      }

      console.log(`[SD] Fin. Registros: ${accummulatedData.current.length}`);

      if (watchdogTimer.current) clearTimeout(watchdogTimer.current);

      setStatus("processing");
      // Ordenamos por fecha al final para asegurar consistencia
      accummulatedData.current.sort((a, b) => a.timestamp - b.timestamp);

      setStatus("ready");
      return accummulatedData.current;
    } catch (e) {
      console.error("[SD] Fatal:", e);
      Alert.alert("Error", "Fallo descarga");
      setStatus("error");
      return [];
    }
  };

  const cancelDownload = () => {
    abortRef.current = true;
    currentSessionId.current += 1;
    if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
    if (subscriptionRef.current) subscriptionRef.current.remove();
    setStatus("idle");
  };

  return {
    startDownload,
    cancelDownload,
    status,
    progressMsg,
    fileProgress,
    totalFiles,
    filesProcessed,
    resetStatus: () => setStatus("idle"),
  };
};
