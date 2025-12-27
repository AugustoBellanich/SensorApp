import { Buffer } from 'buffer';
import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { Device } from 'react-native-ble-plx';
import { BLE_UUIDS } from '../constants/BleUUIDs';

export type TimeRange = 'Hoy' | '1D' | '7D' | '30D' | 'Custom';
export type DownloadStatus = 'idle' | 'downloading' | 'processing' | 'ready' | 'error';

interface DownloadResult {
  timestamp: number;
  [key: string]: number;
}

export const useSDDownloader = () => {
  // --- ESTADOS UI ---
  const [status, setStatus] = useState<DownloadStatus>('idle');
  const [progressMsg, setProgressMsg] = useState('');
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
  const accummulatedData = useRef<DownloadResult[]>([]);
  
  // --- CONTROL DE CONCURRENCIA ---
  const abortRef = useRef(false);
  const currentSessionId = useRef<number>(0); 
  
  // --- WATCHDOG (TIMEOUT DINÁMICO) ---
  // CORRECCIÓN 1: Usamos 'any' para evitar conflicto entre number (RN) y NodeJS.Timeout
  const watchdogTimer = useRef<any>(null);

  // Función para reiniciar el "Perro Guardián"
  const kickWatchdog = () => {
      if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
      
      watchdogTimer.current = setTimeout(() => {
          if (activeResolver.current) {
              console.warn(`[SD] 🛑 Watchdog: Silencio detectado > 3s. Cerrando archivo.`);
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
  const generateFileQueue = (range: TimeRange, customStart?: Date, customEnd?: Date): string[] => {
    const files: string[] = [];
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    switch (range) {
        case 'Hoy': startDate = now; endDate = now; break;
        case '1D':  startDate = new Date(); startDate.setDate(now.getDate() - 1); endDate = now; break; 
        case '7D':  startDate = new Date(); startDate.setDate(now.getDate() - 7); endDate = now; break;
        case '30D': startDate = new Date(); startDate.setDate(now.getDate() - 30); endDate = now; break;
        case 'Custom':
            if (customStart) startDate = customStart;
            if (customEnd) endDate = customEnd;
            else endDate = customStart || now;
            break;
    }

    let current = new Date(startDate);
    current.setHours(0,0,0,0);
    const endLimit = new Date(endDate);
    endLimit.setHours(23,59,59,999);

    while (current <= endLimit) {
        const yy = current.getFullYear().toString().substring(2);
        const mm = (current.getMonth() + 1).toString().padStart(2, '0');
        const dd = current.getDate().toString().padStart(2, '0');
        files.push(`/${yy}${mm}${dd}.csv`);
        current.setDate(current.getDate() + 1);
    }
    return files.reverse();
  };

  // 2. CANAL DE DATOS
  const setupNotificationChannel = async (device: Device, sessionId: number) => {
    if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
    }

    await new Promise(r => setTimeout(r, 200));

    subscriptionRef.current = device.monitorCharacteristicForService(
      BLE_UUIDS.SVC_STORAGE,
      BLE_UUIDS.STORAGE.FILE_CONTENT,
      (error, characteristic) => {
        if (currentSessionId.current !== sessionId) return;

        if (error) {
            if (error.errorCode !== 2 && !abortRef.current) console.error("[SD] ErrMon:", error);
            return;
        }
        
        if (!characteristic?.value) return;

        kickWatchdog();

        const chunk = Buffer.from(characteristic.value, 'base64').toString('utf-8');

        // 1. Detectar Metadata (Firmware envía "SIZE=12345")
        if (chunk.startsWith("SIZE=") || chunk.startsWith("META:")) {
            const sizeMatch = chunk.match(/SIZE=(\d+)/);
            if (sizeMatch) fileSizeRef.current = parseInt(sizeMatch[1]);
            currentFileBuffer.current = ""; 
            lastProgressUpdate.current = 0;
            console.log(`[SD] Inicio descarga. Tamaño: ${fileSizeRef.current}`);
        
        // 2. Detectar Fin de Archivo (Firmware envía "EOF")
        } else if (chunk.includes("EOF") || chunk.includes("DONE")) {
            if (activeResolver.current) {
                if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
                activeResolver.current(currentFileBuffer.current.slice(0));
                activeResolver.current = null;
            }
        
        } else if (chunk.includes("ERR") || chunk.includes("NOFILE")) {
            console.warn("[SD] Error reportado por firmware:", chunk);
            if (activeResolver.current) {
                if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
                activeResolver.current(null);
                activeResolver.current = null;
            }
        
        } else {
            currentFileBuffer.current += chunk;
            
            const now = Date.now();
            if (fileSizeRef.current > 0 && (now - lastProgressUpdate.current > 300)) {
                const pct = Math.min(100, Math.floor((currentFileBuffer.current.length / fileSizeRef.current) * 100));
                setFileProgress(pct);
                lastProgressUpdate.current = now;
            }
        }
      }
    );
  };

  // 3. DESCARGA UNITARIA
  const downloadSingleFile = async (device: Device, filename: string): Promise<string | null> => {
    return new Promise(async (resolve) => {
        activeResolver.current = resolve;
        currentFileBuffer.current = "";
        fileSizeRef.current = 0;
        
        if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
        // Timeout inicial por si nunca llega respuesta
        watchdogTimer.current = setTimeout(() => {
             console.warn(`[SD] Timeout Inicial: No hubo respuesta para ${filename}`);
             if (activeResolver.current) {
                 activeResolver.current(null);
                 activeResolver.current = null;
             }
        }, 4000); 
        const command = filename; 
        const base64Cmd = Buffer.from(command).toString('base64');
        
        try {
            await device.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_STORAGE, 
                BLE_UUIDS.STORAGE.FILE_CONTENT, 
                base64Cmd
            );
        } catch (e) {
            console.error(`[SD] ErrWrite:`, e);
            if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
            resolve(null);
        }
    });
  };

  // 4. PARSEADOR
  const parseFullFileContent = (fullText: string, sensorType: string) => {
    let cleanText = fullText
        .replace(/SIZE=\d+/g, '')
        .replace(/EOF/g, '')
        .replace(/META:.*?\n/g, '')
        .replace(/DATA_START\n?/g, '')
        .replace(/DATA_END\n?/g, '')
        .replace(/DONE\n?/g, '')
        .replace(/\0/g, '') 
        .replace(/\r\n/g, '\n'); 
    
    const rawLines = cleanText.split('\n');
    const uniqueLines = new Set<string>();
    
    rawLines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.length > 15 && !trimmed.startsWith('#')) {
            uniqueLines.add(trimmed);
        }
    });

    const isB01 = sensorType === 'B01';

    uniqueLines.forEach((line) => {
        if (line.includes('datetime')) return;
        const parts = line.split(',');
        if (parts.length < 4) return;

        const dateStr = parts[0].replace(/"/g, '').trim(); 
        let timestamp = Date.parse(dateStr.replace(' ', 'T'));
        
        if (isNaN(timestamp)) {
             const dtParts = dateStr.split(/[- :]/);
             if (dtParts.length >= 6) {
                 timestamp = new Date(
                     parseInt(dtParts[0]), parseInt(dtParts[1]) - 1, parseInt(dtParts[2]), 
                     parseInt(dtParts[3]), parseInt(dtParts[4]), parseInt(dtParts[5])
                 ).getTime();
             }
        }

        if (isNaN(timestamp)) return;

        const item: any = { timestamp };

        if (isB01) {
            item.soil_temp = parseFloat(parts[1]) || 0;
            item.e1_mv = parseFloat(parts[2]) || 0;
            item.e2_mv = parseFloat(parts[3]) || 0;
            item.e3_mv = parseFloat(parts[4]) || 0;
            item.battery_mv = (parseFloat(parts[5]) || 0) * 1000; 
        } else {
            item.air_temp = parseFloat(parts[1]) || 0;
            item.humidity = parseFloat(parts[2]) || 0;
            item.battery_mv = (parseFloat(parts[3]) || 0) * 1000;
        }
        accummulatedData.current.push(item);
    });
  };

  // 5. START DOWNLOAD
  const startDownload = async (
      device: Device | null, 
      sensorType: string, 
      range: TimeRange,
      customStart?: Date,
      customEnd?: Date
  ) => {
    if (!device) {
        Alert.alert("Error", "No conectado");
        return;
    }
    
    currentSessionId.current += 1; 
    const mySessionId = currentSessionId.current;

    setStatus('downloading');
    setFilesProcessed(0);
    accummulatedData.current = []; 
    abortRef.current = false;
    let consecutiveErrors = 0; 

    try {
        if (Platform.OS === 'android') {
            // CORRECCIÓN 2: Eliminado variable 'e' no usada
            try { await device.requestMTU(512); } catch {}
        }

        const queue = generateFileQueue(range, customStart, customEnd);
        setTotalFiles(queue.length);
        
        await setupNotificationChannel(device, mySessionId);
        
        await new Promise(r => setTimeout(r, 300));

        for (const filename of queue) {
            if (abortRef.current || currentSessionId.current !== mySessionId) break;

            if (range !== 'Custom' && consecutiveErrors >= 5) {
                console.log("[SD] Parada inteligente.");
                break;
            }

            setProgressMsg(`Bajando ${filename}...`);
            setFileProgress(0);
            
            await new Promise(r => setTimeout(r, 400));

            try {
                const content = await downloadSingleFile(device, filename);
                
                if (content && content.length > 20) { 
                    parseFullFileContent(content, sensorType);
                    consecutiveErrors = 0; 
                } else {
                    consecutiveErrors++; 
                }
            } catch (err) {
                // CORRECCIÓN 3: Uso de la variable 'err' para logging
                console.warn(`[SD-HOOK] Error descargando ${filename}:`, err);
                consecutiveErrors++;
            }
            setFilesProcessed(prev => prev + 1);
        }

        console.log(`[SD] Fin. Registros: ${accummulatedData.current.length}`);
        
        if (watchdogTimer.current) clearTimeout(watchdogTimer.current);

        setStatus('processing');
        accummulatedData.current.sort((a, b) => a.timestamp - b.timestamp);
        
        setStatus('ready');
        return accummulatedData.current;

    } catch (e) {
        console.error("[SD] Fatal:", e);
        Alert.alert("Error", "Fallo descarga");
        setStatus('error');
        return [];
    }
  };

  const cancelDownload = () => {
      abortRef.current = true;
      currentSessionId.current += 1;
      if (watchdogTimer.current) clearTimeout(watchdogTimer.current);
      if (subscriptionRef.current) subscriptionRef.current.remove();
      setStatus('idle');
  };

  return {
    startDownload,
    cancelDownload,
    status,
    progressMsg,
    fileProgress,
    totalFiles,
    filesProcessed,
    resetStatus: () => setStatus('idle')
  };
};