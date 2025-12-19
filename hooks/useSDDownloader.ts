import { Buffer } from 'buffer';
import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { Device } from 'react-native-ble-plx';
import { BLE_UUIDS } from '../constants/BleUUIDs';

// Definición de Tipos
export type TimeRange = 'Hoy' | '1D' | '7D' | '30D' | 'Custom';
export type DownloadStatus = 'idle' | 'downloading' | 'processing' | 'ready' | 'error';

interface DownloadResult {
  timestamp: number;
  [key: string]: number; // Propiedades dinámicas (e1_mv, temp, etc)
}

export const useSDDownloader = () => {
  // --- ESTADOS REACT (UI) ---
  const [status, setStatus] = useState<DownloadStatus>('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [fileProgress, setFileProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);
  
  // --- REFERENCIAS (Lógica Interna) ---
  const subscriptionRef = useRef<any>(null);
  const activeResolver = useRef<((value: string | null) => void) | null>(null);
  
  // Buffers y Control
  const currentFileBuffer = useRef<string>("");
  const fileSizeRef = useRef<number>(0);
  const lastProgressUpdate = useRef<number>(0); // Para evitar re-renders excesivos
  const accummulatedData = useRef<DownloadResult[]>([]);
  const abortRef = useRef(false);

  // ---------------------------------------------------------
  // 1. GENERADOR DE COLA DE ARCHIVOS
  // ---------------------------------------------------------
  const generateFileQueue = (range: TimeRange, customStart?: Date, customEnd?: Date): string[] => {
    const files: string[] = [];
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    // Determinar fechas de inicio y fin según el rango
    switch (range) {
        case 'Hoy': 
            startDate = now; 
            endDate = now; 
            break;
        case '1D':  
            startDate = new Date(); 
            startDate.setDate(now.getDate() - 1); 
            endDate = now;
            break; 
        case '7D':  
            startDate = new Date(); 
            startDate.setDate(now.getDate() - 7); 
            endDate = now;
            break;
        case '30D': 
            startDate = new Date(); 
            startDate.setDate(now.getDate() - 30); 
            endDate = now;
            break;
        case 'Custom':
            if (customStart) startDate = customStart;
            if (customEnd) endDate = customEnd;
            else endDate = customStart || now;
            break;
    }

    console.log(`[SD-HOOK] Generando cola desde ${startDate.toLocaleDateString()} hasta ${endDate.toLocaleDateString()}`);

    // Iterar día por día para generar nombres de archivo /YYMMDD.csv
    // Clonamos para no mutar las originales
    let current = new Date(startDate);
    current.setHours(0,0,0,0); // Normalizar a medianoche
    
    const endLimit = new Date(endDate);
    endLimit.setHours(23,59,59,999);

    while (current <= endLimit) {
        const yy = current.getFullYear().toString().substring(2);
        const mm = (current.getMonth() + 1).toString().padStart(2, '0');
        const dd = current.getDate().toString().padStart(2, '0');
        files.push(`/${yy}${mm}${dd}.csv`);
        
        // Avanzar un día
        current.setDate(current.getDate() + 1);
    }

    // Invertimos el array para descargar desde el más reciente al más antiguo.
    // Esto es útil para la "Parada Inteligente" (si hoy y ayer no hay datos, probablemente hace un mes tampoco).
    return files.reverse();
  };

  // ---------------------------------------------------------
  // 2. CANAL DE NOTIFICACIONES (ACUMULADOR)
  // ---------------------------------------------------------
  const setupNotificationChannel = async (device: Device) => {
    // Limpieza agresiva de suscripciones previas
    if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
    }

    // Pequeña pausa para estabilizar el stack BLE
    await new Promise(r => setTimeout(r, 200));

    console.log("[SD-HOOK] Suscribiéndose al canal de datos...");

    subscriptionRef.current = device.monitorCharacteristicForService(
      BLE_UUIDS.SVC_STORAGE,
      BLE_UUIDS.STORAGE.FILE_CONTENT,
      (error, characteristic) => {
        if (error) {
            // Ignorar error si fue cancelado voluntariamente
            if (error.errorCode !== 2 && !abortRef.current) console.error("[SD-HOOK] Error monitor:", error);
            return;
        }
        
        if (!characteristic?.value) return;

        // Decodificación
        const chunk = Buffer.from(characteristic.value, 'base64').toString('utf-8');

        // MÁQUINA DE ESTADOS DEL PROTOCOLO
        if (chunk.startsWith("META:")) {
            // Inicio de archivo: Resetear buffer
            const sizeMatch = chunk.match(/SIZE=(\d+)/);
            if (sizeMatch) fileSizeRef.current = parseInt(sizeMatch[1]);
            currentFileBuffer.current = ""; 
            lastProgressUpdate.current = 0;
        
        } else if (chunk.includes("DONE")) {
            // Fin de archivo: Entregar buffer completo
            console.log(`[SD-HOOK] DONE recibido. Buffer final: ${currentFileBuffer.current.length} bytes.`);
            if (activeResolver.current) {
                // Devolvemos una copia del string acumulado
                activeResolver.current(currentFileBuffer.current.slice(0));
                activeResolver.current = null;
            }
        
        } else if (chunk.includes("ERR NOFILE")) {
            // Archivo no encontrado
            if (activeResolver.current) {
                activeResolver.current(null);
                activeResolver.current = null;
            }
        
        } else if (!chunk.startsWith("DATA_") && !chunk.startsWith("GET") && !chunk.startsWith("ERR")) {
            // === ACUMULACIÓN DE DATOS ===
            currentFileBuffer.current += chunk;
            
            // === THROTTLE DE UI (OPTIMIZACIÓN CLAVE) ===
            // Solo actualizamos el estado de React cada 200ms para no congelar la app
            const now = Date.now();
            if (fileSizeRef.current > 0 && (now - lastProgressUpdate.current > 200)) {
                const pct = Math.min(100, Math.floor((currentFileBuffer.current.length / fileSizeRef.current) * 100));
                setFileProgress(pct);
                lastProgressUpdate.current = now;
            }
        }
      }
    );
  };

  // ---------------------------------------------------------
  // 3. DESCARGA DE UN SOLO ARCHIVO (Promesa)
  // ---------------------------------------------------------
  const downloadSingleFile = async (device: Device, filename: string): Promise<string | null> => {
    return new Promise(async (resolve) => {
        activeResolver.current = resolve;
        currentFileBuffer.current = "";
        fileSizeRef.current = 0;
        lastProgressUpdate.current = 0;

        const base64Cmd = Buffer.from(`GET ${filename}`).toString('base64');
        
        try {
            await device.writeCharacteristicWithResponseForService(
                BLE_UUIDS.SVC_STORAGE, 
                BLE_UUIDS.STORAGE.FILE_CONTENT, 
                base64Cmd
            );
        } catch (e) {
            console.error(`[SD-HOOK] Error enviando comando GET:`, e);
            resolve(null);
            return;
        }

        // Timeout de seguridad: 15s por archivo
        // Si el archivo es muy grande y la conexión lenta, aumentar esto.
        setTimeout(() => {
            if (activeResolver.current) {
                console.log(`[SD-HOOK] Timeout en archivo ${filename}.`);
                // Si logramos bajar algo (>50 bytes), lo entregamos aunque esté incompleto
                if (currentFileBuffer.current.length > 50) {
                    activeResolver.current(currentFileBuffer.current);
                } else {
                    activeResolver.current(null);
                }
                activeResolver.current = null;
            }
        }, 15000);
    });
  };

  // ---------------------------------------------------------
  // 4. PARSEADOR INTELIGENTE (Post-Procesamiento)
  // ---------------------------------------------------------
  const parseFullFileContent = (fullText: string, sensorType: string) => {
    // 1. Limpieza de protocolo y basura
    let cleanText = fullText
        .replace(/META:.*?;NAME=.*?\n?/g, '')
        .replace(/DATA_START\n?/g, '')
        .replace(/DATA_END\n?/g, '')
        .replace(/DONE\n?/g, '')
        .replace(/\0/g, '') // Quitar null bytes
        .replace(/\r\n/g, '\n'); // Normalizar saltos de línea
    
    const rawLines = cleanText.split('\n');
    
    // 2. ELIMINAR DUPLICADOS (Deduplicación)
    // Usamos un Set para eliminar líneas idénticas causadas por retransmisiones BLE
    const uniqueLines = new Set<string>();
    
    rawLines.forEach(line => {
        const trimmed = line.trim();
        // Filtramos líneas que son demasiado cortas para ser datos válidos
        if (trimmed.length > 15 && !trimmed.startsWith('#')) {
            uniqueLines.add(trimmed);
        }
    });

    console.log(`[SD-HOOK] Procesando buffer. Líneas crudas: ${rawLines.length} -> Únicas: ${uniqueLines.size}`);

    const isB01 = sensorType === 'B01';
    let addedCount = 0;

    // 3. Convertir texto a objetos
    uniqueLines.forEach((line) => {
        // Ignorar headers que hayan quedado
        if (line.includes('datetime') || line.includes('temp_soil')) return;

        const parts = line.split(',');
        // B01 requiere min 5 cols, C01 min 4
        if (parts.length < 4) return;

        // Limpieza de fecha (quitar comillas del firmware)
        const dateStr = parts[0].replace(/"/g, '').trim(); 
        
        // Parseo de fecha tolerante
        // Intentamos formato ISO primero
        let timestamp = Date.parse(dateStr.replace(' ', 'T'));
        
        // Si falla, parseo manual componente a componente
        if (isNaN(timestamp)) {
             const dtParts = dateStr.split(/[- :]/);
             if (dtParts.length >= 6) {
                 timestamp = new Date(
                     parseInt(dtParts[0]), // YYYY
                     parseInt(dtParts[1]) - 1, // MM (0-11)
                     parseInt(dtParts[2]), // DD
                     parseInt(dtParts[3]), // HH
                     parseInt(dtParts[4]), // mm
                     parseInt(dtParts[5])  // ss
                 ).getTime();
             }
        }

        if (isNaN(timestamp)) return; // Fecha inválida, saltar línea

        const item: any = { timestamp };

        if (isB01) {
            // Indices B01: 0=Date, 1=Temp, 2=M1, 3=M2, 4=M3, 5=Vbat
            item.soil_temp = parseFloat(parts[1]) || 0;
            item.e1_mv = parseFloat(parts[2]) || 0;
            item.e2_mv = parseFloat(parts[3]) || 0;
            item.e3_mv = parseFloat(parts[4]) || 0;
            item.battery_mv = (parseFloat(parts[5]) || 0) * 1000; // V -> mV
        } else {
            // C01 supuesto: 0=Date, 1=AirTemp, 2=Hum, 3=Vbat
            item.air_temp = parseFloat(parts[1]) || 0;
            item.humidity = parseFloat(parts[2]) || 0;
            item.battery_mv = (parseFloat(parts[3]) || 0) * 1000;
        }
        
        accummulatedData.current.push(item);
        addedCount++;
    });
  };

  // ---------------------------------------------------------
  // 5. FUNCIÓN PRINCIPAL (Pública)
  // ---------------------------------------------------------
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
    
    setStatus('downloading');
    setFilesProcessed(0);
    accummulatedData.current = []; // Resetear datos anteriores
    abortRef.current = false;
    let consecutiveErrors = 0; 

    try {
        // A) NEGOCIACIÓN MTU (Solo Android)
        // Pedimos 512 bytes para que los paquetes de 240 del sensor pasen enteros
        if (Platform.OS === 'android') {
            console.log("[SD-HOOK] Solicitando MTU 512...");
            try {
                await device.requestMTU(512);
            } catch (e) {
                console.warn("[SD-HOOK] Falló negociación MTU:", e);
            }
        }

        // B) GENERAR COLA
        const queue = generateFileQueue(range, customStart, customEnd);
        setTotalFiles(queue.length);
        
        // C) INICIAR LISTENER
        await setupNotificationChannel(device);
        // Espera de seguridad
        await new Promise(r => setTimeout(r, 400));

        // D) PROCESAR COLA
        for (const filename of queue) {
            // Verificar cancelación
            if (abortRef.current) break;

            // Parada Inteligente: Si fallamos 10 veces seguidas en rangos automáticos, paramos.
            // (En 'Custom' intentamos todo porque el usuario fue específico)
            if (range !== 'Custom' && consecutiveErrors >= 10) {
                console.log("[SD-HOOK] Parada inteligente activada.");
                break;
            }

            setProgressMsg(`Descargando ${filename}...`);
            setFileProgress(0); // Reset barra para este archivo
            
            try {
                // Descargar archivo completo
                const content = await downloadSingleFile(device, filename);
                
                // Si recibimos contenido válido (>20 bytes para cubrir headers mínimos)
                if (content && content.length > 20) { 
                    parseFullFileContent(content, sensorType);
                    consecutiveErrors = 0; // Reset contador de errores
                } else {
                    consecutiveErrors++; 
                }
            } catch (err) {
                console.error(`[SD-HOOK] Error en archivo ${filename}:`, err);
                consecutiveErrors++;
            }
            setFilesProcessed(prev => prev + 1);
        }

        console.log(`[SD-HOOK] Finalizado. Total registros acumulados: ${accummulatedData.current.length}`);
        
        setStatus('processing');
        
        // Ordenar cronológicamente ascendente (antiguo -> nuevo) para la DB y gráficas
        accummulatedData.current.sort((a, b) => a.timestamp - b.timestamp);
        
        setStatus('ready');
        return accummulatedData.current;

    } catch (e) {
        console.error("[SD-HOOK] Error Fatal:", e);
        Alert.alert("Error", "Fallo durante la descarga");
        setStatus('error');
        return [];
    }
  };

  const cancelDownload = () => {
      abortRef.current = true;
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