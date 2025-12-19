export const BLE_UUIDS = {
  // === SERVICIOS ESTÁNDAR ===
  SVC_DEVICE_INFO: '180A',
  SVC_BATTERY:     '180F',

  // === SERVICIOS CUSTOM (Base: 6deedd77-f7e4-412e-9514-baee44a2d) ===
  SVC_SENSORS:  '6deedd77-f7e4-412e-9514-baee44a2d100',
  SVC_STORAGE:  '6deedd77-f7e4-412e-9514-baee44a2d200',
  SVC_CONFIG:   '6deedd77-f7e4-412e-9514-baee44a2d300',
  SVC_STATUS:   '6deedd77-f7e4-412e-9514-baee44a2d400',

  // === CARACTERÍSTICAS DE INFORMACIÓN Y BATERÍA ===
  CHAR_MODEL_NUM:   '2A24', 
  CHAR_SERIAL_NUM:  '2A25',
  CHAR_FIRMWARE:    '2A26',
  CHAR_BATTERY_LVL: '2A19',
  
  // === CARACTERÍSTICAS DE ESTADO COMPARTIDO (Servicio 400) ===
  CHAR_SD_STATUS:   '6deedd77-f7e4-412e-9514-baee44a2d402', // SD/SPIFFS OK
  CHAR_LORA_STATUS: '6deedd77-f7e4-412e-9514-baee44a2d403', // LoRa Module OK
  CHAR_RTC_STATUS:  '6deedd77-f7e4-412e-9514-baee44a2d404', // NTP/RTC Sync OK

  // === CARACTERÍSTICAS DE ESTADO GATEWAY (N01) ===
  STATUS: {
    WIFI_STATUS:    '6deedd77-f7e4-412e-9514-baee44a2d401', // ONLINE, LOCAL, DISCONNECTED
    SYNC_STATUS:    '6deedd77-f7e4-412e-9514-baee44a2d405', // IDLE, SENDING, ERROR
    LAST_SYNC:      '6deedd77-f7e4-412e-9514-baee44a2d406', // Fecha ISO
    SENSORS_LIST:   '6deedd77-f7e4-412e-9514-baee44a2d407', // JSON Sensores vistos
  },

  // A - AGUA (Niveles, Caudales) - ¡NUEVO!
  A01: {
    WATER_LEVEL: '6deedd77-f7e4-412e-9514-baee44a2d121', // cm/m
    FLOW_RATE:   '6deedd77-f7e4-412e-9514-baee44a2d122', // L/min
    // Puedes agregar más aquí (ej. Turbidez)
  },

  // === CARACTERÍSTICAS DE SENSORES (B01 - SUELO) ===
  B01: {
    TEMP_SOIL: '6deedd77-f7e4-412e-9514-baee44a2d101',
    MOIST_1:   '6deedd77-f7e4-412e-9514-baee44a2d102', 
    MOIST_2:   '6deedd77-f7e4-412e-9514-baee44a2d103', 
    MOIST_3:   '6deedd77-f7e4-412e-9514-baee44a2d104', 
  },

  // === CARACTERÍSTICAS DE SENSORES (C01 - AMBIENTE) ===
  C01: {
    TEMP_AMB:  '6deedd77-f7e4-412e-9514-baee44a2d111',
    HUM_AMB:   '6deedd77-f7e4-412e-9514-baee44a2d112',
  },

  // === ALMACENAMIENTO (SD/SPIFFS) ===
  STORAGE: {
    FILE_LIST:    '6deedd77-f7e4-412e-9514-baee44a2d202',
    FILE_DELETE:  '6deedd77-f7e4-412e-9514-baee44a2d203', 
    FILE_CONTENT: '6deedd77-f7e4-412e-9514-baee44a2d204',
  },

  // === CONFIGURACIÓN (Servicio 300) ===
  CONFIG: {
    // -- B01/C01 (y Dummies en N01) --
    SD_ENABLE:     '6deedd77-f7e4-412e-9514-baee44a2d301',
    SAVE_INTERVAL: '6deedd77-f7e4-412e-9514-baee44a2d302', // En N01: Intervalo lectura local
    LORA_ENABLE:   '6deedd77-f7e4-412e-9514-baee44a2d303',
    LORA_INTERVAL: '6deedd77-f7e4-412e-9514-baee44a2d304',
    LORA_OFFSET:   '6deedd77-f7e4-412e-9514-baee44a2d305',
    RTC_SYNC:      '6deedd77-f7e4-412e-9514-baee44a2d306',
    LOW_POWER:     '6deedd77-f7e4-412e-9514-baee44a2d307',
    WAKE_INTERVAL: '6deedd77-f7e4-412e-9514-baee44a2d308',
    BLE_WINDOW:    '6deedd77-f7e4-412e-9514-baee44a2d309',

    // -- GATEWAY N01 (Nuevos) --
    WIFI_SSID:       '6deedd77-f7e4-412e-9514-baee44a2d310',
    WIFI_PASS:       '6deedd77-f7e4-412e-9514-baee44a2d311',
    SUPABASE_URL:    '6deedd77-f7e4-412e-9514-baee44a2d312',
    ANON_KEY:        '6deedd77-f7e4-412e-9514-baee44a2d313',
    INGEST_TOKEN:    '6deedd77-f7e4-412e-9514-baee44a2d314',
    UPLOADER_ID:     '6deedd77-f7e4-412e-9514-baee44a2d315',
    SEND_NOW:        '6deedd77-f7e4-412e-9514-baee44a2d316', // Trigger manual
    UPLOAD_INTERVAL: '6deedd77-f7e4-412e-9514-baee44a2d317', // Intervalo subida WiFi
  }
};