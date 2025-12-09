export const BLE_UUIDS = {
  // === SERVICIOS ESTÁNDAR ===
  SVC_DEVICE_INFO: '180A',
  SVC_BATTERY:     '180F',

  // === SERVICIOS CUSTOM (Base: 6deedd77-f7e4-412e-9514-baee44a2d) ===
  SVC_SENSORS:  '6deedd77-f7e4-412e-9514-baee44a2d100',
  SVC_STORAGE:  '6deedd77-f7e4-412e-9514-baee44a2d200',
  SVC_CONFIG:   '6deedd77-f7e4-412e-9514-baee44a2d300',
  SVC_STATUS:   '6deedd77-f7e4-412e-9514-baee44a2d400',

  // === CARACTERÍSTICAS DE INFORMACIÓN ===
  CHAR_MODEL_NUM: '2A24', // ¡CRÍTICO! Determina si es B01 o C01
  CHAR_SERIAL_NUM:'2A25',
  CHAR_FIRMWARE:  '2A26',
  CHAR_BATTERY_LVL:'2A19',

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
    RTC_SYNC:     '6deedd77-f7e4-412e-9514-baee44a2d306',
  }
};