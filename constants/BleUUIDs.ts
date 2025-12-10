export const BLE_UUIDS = {
  // === SERVICIOS ESTÁNDAR ===
  SVC_DEVICE_INFO: '180A',
  SVC_BATTERY:     '180F',

  // === SERVICIOS CUSTOM (Base: 6deedd77-f7e4-412e-9514-baee44a2d) ===
  SVC_SENSORS:  '6deedd77-f7e4-412e-9514-baee44a2d100',
  SVC_STORAGE:  '6deedd77-f7e4-412e-9514-baee44a2d200',
  SVC_CONFIG:   '6deedd77-f7e4-412e-9514-baee44a2d300',
  SVC_STATUS:   '6deedd77-f7e4-412e-9514-baee44a2d400',

  // === CARACTERÍSTICAS DE INFORMACIÓN Y BATERÍA (Estándar 180A, 180F) ===
  CHAR_MODEL_NUM: '2A24', 
  CHAR_SERIAL_NUM:'2A25',
  CHAR_FIRMWARE:  '2A26',
  CHAR_BATTERY_LVL:'2A19',
  
  // === CARACTERÍSTICAS DE ESTADO (Servicio 400) === <--- ¡LAS AGREGADAS!
  CHAR_SD_STATUS:   '6deedd77-f7e4-412e-9514-baee44a2d402', // SD Detectada/OK
  CHAR_LORA_STATUS: '6deedd77-f7e4-412e-9514-baee44a2d403', // Chip LoRa OK
  CHAR_RTC_STATUS:  '6deedd77-f7e4-412e-9514-baee44a2d404', // Reloj RTC OK

  // === CARACTERÍSTICAS DE SENSORES (B01 - SUELO) ===
  B01: {
    TEMP_SOIL: '6deedd77-f7e4-412e-9514-baee44a2d101',
    MOIST_1:   '6deedd77-f7e4-412e-9514-baee44a2d102', // mV
    MOIST_2:   '6deedd77-f7e4-412e-9514-baee44a2d103', // mV
    MOIST_3:   '6deedd77-f7e4-412e-9514-baee44a2d104', // mV
  },

  // === CARACTERÍSTICAS DE SENSORES (C01 - AMBIENTE) ===
  C01: {
    TEMP_AMB:  '6deedd77-f7e4-412e-9514-baee44a2d111',
    HUM_AMB:   '6deedd77-f7e4-412e-9514-baee44a2d112',
  },

  // === ALMACENAMIENTO (SD) ===
  STORAGE: {
    FILE_LIST:    '6deedd77-f7e4-412e-9514-baee44a2d202',
    FILE_DELETE:  '6deedd77-f7e4-412e-9514-baee44a2d203',
    FILE_CONTENT: '6deedd77-f7e4-412e-9514-baee44a2d204',
  },

  // === CONFIGURACIÓN ===
  CONFIG: {
    SD_ENABLE:    '6deedd77-f7e4-412e-9514-baee44a2d301',
    SAVE_INTERVAL:'6deedd77-f7e4-412e-9514-baee44a2d302',
    LORA_ENABLE:  '6deedd77-f7e4-412e-9514-baee44a2d303',
    LORA_INTERVAL:'6deedd77-f7e4-412e-9514-baee44a2d304',
    LORA_OFFSET:  '6deedd77-f7e4-412e-9514-baee44a2d305',
    RTC_SYNC:     '6deedd77-f7e4-412e-9514-baee44a2d306',
    LOW_POWER:    '6deedd77-f7e4-412e-9514-baee44a2d307',
    WAKE_INTERVAL:'6deedd77-f7e4-412e-9514-baee44a2d308',
    BLE_WINDOW:   '6deedd77-f7e4-412e-9514-baee44a2d309',
  }
};