import { MaterialCommunityIcons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { Buffer } from "buffer";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// --- IMPORTS PROPIOS ---
import SegmentedControl from "../../../components/global/SegmentedControl";
import TimeIntervalInput from "../../../components/inputs/TimeIntervalInput";
import { BLE_UUIDS } from "../../../constants/BleUUIDs";
import { Colors } from "../../../constants/Colors";
import { GlobalStyles } from "../../../constants/GlobalStyles";
import { useBle } from "../../../context/BleContext";
import {
  getSensorById,
  updateSensorLocal,
} from "../../../database/SensorRepository";
import {
  INGEST_TOKEN,
  SUPABASE_ANON_KEY,
  SUPABASE_FUNCTION_URL, // <--- USAMOS ESTA URL PARA EL GATEWAY
} from "../../../lib/supabase";

// Utilidad Sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type WifiNetwork = { ssid: string; rssi: number; secure: boolean };

// Mapeo de códigos de error del firmware a mensajes legibles
const WIFI_ERROR_LABELS: Record<string, string> = {
  NONE: "",
  NO_SSID: "No hay una red configurada.",
  NO_AP_FOUND: "No se encontró la red. Verificá el nombre (SSID).",
  AUTH_FAILED: "Contraseña incorrecta o falló la autenticación.",
  TIMEOUT: "Se agotó el tiempo de espera al conectar.",
  CONNECTION_LOST: "Se conectó pero luego se perdió la conexión.",
  NO_INTERNET: "Conectado a la red, pero sin salida a Internet.",
  UNKNOWN: "Error desconocido al conectar.",
};

const NETWORK_MODE_OPTIONS = ["Con Contraseña", "Red Abierta"];

export default function GatewayConfigScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();

  const { connectedDevice, isBusy } = useBle();
  const isConnected = !!connectedDevice;

  const [isReading, setIsReading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);

  // ESTADO VISIBLE PARA EL USUARIO
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [isOpenNetwork, setIsOpenNetwork] = useState(false);
  const [uploadInterval, setUploadInterval] = useState(1800); // Default 30 min, en segundos

  // ESCANEO DE REDES
  const [isScanningWifi, setIsScanningWifi] = useState(false);
  const [availableNetworks, setAvailableNetworks] = useState<WifiNetwork[]>([]);

  // PRUEBA DE CONEXION
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [connectionErrorMsg, setConnectionErrorMsg] = useState<string | null>(
    null,
  );

  // --- HELPERS DE LECTURA BLE ---
  const readConfigStr = useCallback(
    async (uuid: string) => {
      if (!connectedDevice) return "";
      try {
        const c = await connectedDevice.readCharacteristicForService(
          BLE_UUIDS.SVC_CONFIG,
          uuid,
        );
        return c.value ? Buffer.from(c.value, "base64").toString("utf8") : "";
      } catch {
        return "";
      }
    },
    [connectedDevice],
  );

  const readStatusStr = useCallback(
    async (uuid: string) => {
      if (!connectedDevice) return "";
      try {
        const c = await connectedDevice.readCharacteristicForService(
          BLE_UUIDS.SVC_STATUS,
          uuid,
        );
        return c.value ? Buffer.from(c.value, "base64").toString("utf8") : "";
      } catch {
        return "";
      }
    },
    [connectedDevice],
  );

  // 1. CARGA INICIAL: LEER CONFIGURACIÓN REAL DEL N01
  useEffect(() => {
    const readDeviceConfig = async () => {
      if (!isConnected || !connectedDevice) return;
      setIsReading(true);
      try {
        console.log("Leyendo configuración del Gateway...");

        const rSsid = await readConfigStr(BLE_UUIDS.CONFIG.WIFI_SSID);
        const rUpInt = await readConfigStr(BLE_UUIDS.CONFIG.UPLOAD_INTERVAL);
        const rOpen = await readConfigStr(BLE_UUIDS.CONFIG.WIFI_OPEN);

        if (rSsid) setWifiSsid(rSsid);
        if (rUpInt) setUploadInterval(parseInt(rUpInt, 10) || 1800);
        setIsOpenNetwork(rOpen === "1");
      } catch (error) {
        console.log("Error leyendo configuración inicial:", error);
      } finally {
        setIsReading(false);
      }
    };

    readDeviceConfig();
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // NetInfo necesita este flag explícito para poder devolver el SSID
  // de la red WiFi del celular en Android (por defecto no lo reporta).
  useEffect(() => {
    NetInfo.configure({ shouldFetchWiFiSSID: true });
  }, []);

  // --- HELPER: escribe SSID / password / modo red abierta al Gateway ---
  // Usado tanto por "Guardar WiFi" como por "Probar Conexión", para que
  // probar conexión SIEMPRE pruebe lo que está cargado en el formulario
  // en ese momento, sin depender de que el usuario haya guardado antes.
  const pushWifiConfigToDevice = useCallback(async (): Promise<
    string | null
  > => {
    const cleanSsid = wifiSsid.trim();

    if (!cleanSsid || cleanSsid.length < 2) {
      Alert.alert("Error", "El nombre de la red (SSID) es inválido.");
      return null;
    }

    // Si la red es abierta, forzamos password vacío sin importar lo que
    // haya en el campo. Si no es abierta, se envía EXACTAMENTE lo que
    // escribió el usuario (incluso vacío, para poder borrar la clave).
    const passToSend = isOpenNetwork ? "" : wifiPass;

    console.log("Enviando Password (puede ir vacía)...");
    await connectedDevice?.writeCharacteristicWithResponseForService(
      BLE_UUIDS.SVC_CONFIG,
      BLE_UUIDS.CONFIG.WIFI_PASS,
      Buffer.from(passToSend).toString("base64"),
    );
    await sleep(400);

    console.log("Enviando modo Red Abierta:", isOpenNetwork);
    await connectedDevice?.writeCharacteristicWithResponseForService(
      BLE_UUIDS.SVC_CONFIG,
      BLE_UUIDS.CONFIG.WIFI_OPEN,
      Buffer.from(isOpenNetwork ? "1" : "0").toString("base64"),
    );
    await sleep(400);

    console.log("Enviando SSID:", cleanSsid);
    await connectedDevice?.writeCharacteristicWithResponseForService(
      BLE_UUIDS.SVC_CONFIG,
      BLE_UUIDS.CONFIG.WIFI_SSID,
      Buffer.from(cleanSsid).toString("base64"),
    );

    return cleanSsid;
  }, [connectedDevice, wifiSsid, wifiPass, isOpenNetwork]);

  // --- ACCIÓN 2: ESCANEAR REDES WIFI CERCANAS ---
  const handleScanNetworks = async () => {
    if (!connectedDevice) return;
    setIsScanningWifi(true);
    setAvailableNetworks([]);
    try {
      await connectedDevice.writeCharacteristicWithResponseForService(
        BLE_UUIDS.SVC_CONFIG,
        BLE_UUIDS.CONFIG.WIFI_SCAN_CMD,
        Buffer.from("1").toString("base64"),
      );

      let networks: WifiNetwork[] = [];
      // El escaneo en el ESP32 tarda unos segundos; hacemos polling
      for (let i = 0; i < 7; i++) {
        await sleep(1500);
        const raw = await readStatusStr(BLE_UUIDS.STATUS.WIFI_SCAN_RESULTS);
        if (raw && raw !== "SCANNING") {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              networks = parsed;
              break;
            }
          } catch {
            // seguimos esperando si todavía no es JSON válido
          }
        }
      }

      setAvailableNetworks(networks);
      if (networks.length === 0) {
        Alert.alert(
          "Sin resultados",
          "No se encontraron redes cercanas, o el escaneo tardó demasiado.",
        );
      }
    } catch (e) {
      console.error("Error escaneando redes:", e);
      Alert.alert("Error", "No se pudo escanear redes WiFi.");
    } finally {
      setIsScanningWifi(false);
    }
  };

  // --- ACCIÓN 2b: USAR LA RED WIFI ACTUAL DEL CELULAR ---
  // Solo autocompleta el SSID. Android NO permite leer la contraseña
  // guardada de una red WiFi por ninguna vía (ni con permisos), así que
  // la contraseña siempre hay que escribirla a mano, salvo red abierta.
  const [isReadingPhoneWifi, setIsReadingPhoneWifi] = useState(false);
  const handleUseCurrentPhoneWifi = async () => {
    setIsReadingPhoneWifi(true);
    try {
      const state = await NetInfo.fetch();

      if (state.type !== "wifi") {
        return Alert.alert(
          "Sin WiFi en el celular",
          "Tu celular no está conectado a una red WiFi ahora mismo (¿estás con datos móviles?).",
        );
      }

      const ssid = (state.details as any)?.ssid as string | null | undefined;

      if (
        !ssid ||
        ssid === "<unknown ssid>" ||
        ssid.toLowerCase() === "unknown ssid"
      ) {
        return Alert.alert(
          "No se pudo leer el nombre de la red",
          "Android bloqueó el acceso al SSID. Revisá que la Ubicación (GPS) esté activada en el celular, además del permiso de Ubicación ya concedido a la app.",
        );
      }

      setWifiSsid(ssid);
      setIsOpenNetwork(false);
      setWifiPass("");
      Alert.alert(
        "SSID completado",
        `Se cargó el nombre "${ssid}" desde tu celular.\n\nPor seguridad, Android no permite leer la contraseña guardada — completala manualmente abajo.`,
      );
    } catch (e) {
      console.error("Error leyendo WiFi del celular:", e);
      Alert.alert("Error", "No se pudo leer la red WiFi actual del celular.");
    } finally {
      setIsReadingPhoneWifi(false);
    }
  };

  const handleSelectNetwork = (network: WifiNetwork) => {
    setWifiSsid(network.ssid);
    setIsOpenNetwork(!network.secure);
    if (!network.secure) {
      setWifiPass("");
    }
  };

  // --- ACCIÓN 2b: GUARDAR Y PROBAR CONEXIÓN (un solo botón) ---
  // Guarda el formulario actual (SSID/pass/modo) y RECIÉN DESPUÉS dispara
  // el intento de conexión, para que siempre pruebe la red seleccionada
  // en pantalla.
  const handleTestConnection = async () => {
    if (!connectedDevice) return;
    setIsTestingConnection(true);
    setConnectionStatus(null);
    setConnectionErrorMsg(null);
    try {
      const savedSsid = await pushWifiConfigToDevice();
      if (!savedSsid) return; // SSID inválido, ya se mostró el Alert

      await connectedDevice.writeCharacteristicWithResponseForService(
        BLE_UUIDS.SVC_CONFIG,
        BLE_UUIDS.CONFIG.WIFI_CONNECT,
        Buffer.from("1").toString("base64"),
      );

      let finalStatus = "DISCONNECTED";
      let finalError = "NONE";

      for (let i = 0; i < 10; i++) {
        await sleep(1500);
        const status = await readStatusStr(BLE_UUIDS.STATUS.WIFI_STATUS);
        const error = await readStatusStr(BLE_UUIDS.STATUS.WIFI_ERROR);
        if (status) finalStatus = status;
        if (error) finalError = error;

        setConnectionStatus(finalStatus);
        setConnectionErrorMsg(WIFI_ERROR_LABELS[finalError] || null);

        if (finalStatus === "ONLINE" || finalStatus === "LOCAL") break;
        // Si ya tenemos un error concreto (no NONE) y pasaron unos intentos, cortamos antes
        if (finalError && finalError !== "NONE" && i >= 3) break;
      }
    } catch (e) {
      console.error("Error probando conexión:", e);
      Alert.alert("Error", "No se pudo probar la conexión.");
    } finally {
      setIsTestingConnection(false);
    }
  };

  // --- ACCIÓN 4: SINCRONIZAR SERVIDOR ---
  const handleSyncServer = async () => {
    setIsWriting(true);
    try {
      const cleanId = sensorId.replace("SEN-", "");

      const cmds = [
        {
          uuid: BLE_UUIDS.CONFIG.SUPABASE_URL,
          val: SUPABASE_FUNCTION_URL,
          name: "URL Función",
        },
        {
          uuid: BLE_UUIDS.CONFIG.ANON_KEY,
          val: SUPABASE_ANON_KEY,
          name: "API Key",
        },
        {
          uuid: BLE_UUIDS.CONFIG.INGEST_TOKEN,
          val: INGEST_TOKEN,
          name: "Token",
        },
        { uuid: BLE_UUIDS.CONFIG.UPLOADER_ID, val: cleanId, name: "ID" },
      ];

      for (const cmd of cmds) {
        if (!cmd.val) {
          console.warn(`[Config] Falta valor para ${cmd.name}`);
          continue;
        }
        console.log(`Enviando ${cmd.name}...`);
        await connectedDevice?.writeCharacteristicWithResponseForService(
          BLE_UUIDS.SVC_CONFIG,
          cmd.uuid,
          Buffer.from(cmd.val).toString("base64"),
        );
        await sleep(400);
      }
      Alert.alert(
        "Sincronización Exitosa",
        "Credenciales del servidor actualizadas en el Gateway.",
      );
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Fallo al enviar credenciales.");
    } finally {
      setIsWriting(false);
    }
  };

  // --- ACCIÓN 5: ACTUALIZAR INTERVALO DE SUBIDA ---
  // El N01 no tiene noción de "guardado local por intervalo" — los paquetes
  // LoRa que recibe se escriben a LittleFS al instante en que llegan, no en
  // un timer. Por eso solo se actualiza UPLOAD_INTERVAL acá.
  const handleUpdateTimings = async () => {
    setIsWriting(true);
    try {
      await connectedDevice?.writeCharacteristicWithResponseForService(
        BLE_UUIDS.SVC_CONFIG,
        BLE_UUIDS.CONFIG.UPLOAD_INTERVAL,
        Buffer.from(String(uploadInterval)).toString("base64"),
      );

      const currentSensor = await getSensorById(sensorId.replace("SEN-", ""));
      if (currentSensor) {
        const conf = currentSensor.config_json
          ? JSON.parse(currentSensor.config_json)
          : {};
        conf.uploadInterval = uploadInterval;
        await updateSensorLocal({
          ...currentSensor,
          config_json: JSON.stringify(conf),
        });
      }

      Alert.alert(
        "Tiempo Actualizado",
        "Nuevo intervalo de subida configurado.",
      );
    } catch {
      Alert.alert("Error", "Fallo al actualizar el intervalo.");
    } finally {
      setIsWriting(false);
    }
  };

  // --- UTILIDADES ---
  const handleSyncRTC = async () => {
    try {
      const now = new Date();
      const timezoneOffsetMs = now.getTimezoneOffset() * 60000;
      const localDate = new Date(now.getTime() - timezoneOffsetMs);
      const timeString = localDate.toISOString().replace("T", " ").slice(0, 19);

      console.log(`[RTC] Enviando al Gateway: ${timeString}`);

      await connectedDevice?.writeCharacteristicWithResponseForService(
        BLE_UUIDS.SVC_CONFIG,
        BLE_UUIDS.CONFIG.RTC_SYNC,
        Buffer.from(timeString).toString("base64"),
      );
      Alert.alert("Reloj", `Hora sincronizada: ${timeString}`);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Fallo RTC");
    }
  };

  const handleDeleteData = async () => {
    Alert.alert(
      "Borrar Datos",
      "¿Estás seguro de vaciar la memoria del Gateway?",
      [
        { text: "Cancelar" },
        {
          text: "BORRAR",
          style: "destructive",
          onPress: async () => {
            if (!connectedDevice) return;
            setIsWriting(true);
            try {
              console.log("Enviando comando de borrado (1)...");
              await connectedDevice.writeCharacteristicWithoutResponseForService(
                BLE_UUIDS.SVC_STORAGE,
                BLE_UUIDS.STORAGE.FILE_DELETE,
                Buffer.from("1").toString("base64"),
              );
              Alert.alert(
                "Comando Enviado",
                "El Gateway está borrando la memoria. Esto puede tomar unos segundos.",
              );
            } catch (e) {
              console.error("Error borrando:", e);
              Alert.alert("Error", "No se pudo enviar el comando.");
            } finally {
              setIsWriting(false);
            }
          },
        },
      ],
    );
  };

  const globalDisabled = isBusy || isWriting || !isConnected;

  // --- ESTADO VISUAL DE CONEXIÓN (icono + color, estilo consistente con SensorStatusPanel) ---
  let connectionIcon: any = "wifi-off";
  let connectionColor = Colors.offline;
  let connectionLabel: string | null = null;

  if (connectionStatus === "ONLINE") {
    connectionIcon = "wifi-check";
    connectionColor = Colors.success;
    connectionLabel = "Conectado (con Internet)";
  } else if (connectionStatus === "LOCAL") {
    connectionIcon = "wifi-alert";
    connectionColor = Colors.warning;
    connectionLabel = "Conectado (sin Internet)";
  } else if (connectionStatus === "DISCONNECTED") {
    connectionIcon = "wifi-off";
    connectionColor = Colors.error;
    connectionLabel = "No se pudo conectar";
  }

  if (isReading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 10, color: Colors.textSecondary }}>
          Leyendo configuración del N01...
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={router.back}
          style={styles.backBtn}
          disabled={globalDisabled}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={Colors.textPrimary}
          />
        </TouchableOpacity>
        <Text style={styles.title}>Configurar Gateway</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 1. SECCIÓN WIFI */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conexión WiFi</Text>
          <View style={[GlobalStyles.card, styles.cardOverrides]}>
            <View style={styles.quickFillRow}>
              <TouchableOpacity
                style={[
                  styles.btnSecondary,
                  { flex: 1 },
                  (globalDisabled || isScanningWifi) && styles.btnDisabled,
                ]}
                onPress={handleScanNetworks}
                disabled={globalDisabled || isScanningWifi}
              >
                {isScanningWifi ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <MaterialCommunityIcons
                    name="wifi-refresh"
                    size={20}
                    color={Colors.primary}
                  />
                )}
                <Text style={styles.btnSecondaryText}>
                  {isScanningWifi ? "Escaneando..." : "Escanear Redes"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.btnSecondary,
                  { flex: 1 },
                  (globalDisabled || isReadingPhoneWifi) && styles.btnDisabled,
                ]}
                onPress={handleUseCurrentPhoneWifi}
                disabled={globalDisabled || isReadingPhoneWifi}
              >
                {isReadingPhoneWifi ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <MaterialCommunityIcons
                    name="cellphone-wireless"
                    size={20}
                    color={Colors.primary}
                  />
                )}
                <Text style={styles.btnSecondaryText} numberOfLines={1}>
                  {isReadingPhoneWifi ? "Leyendo..." : "Usar mi WiFi"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.quickFillHint}></Text>

            {availableNetworks.length > 0 && (
              <View style={styles.networkList}>
                <FlatList
                  data={availableNetworks}
                  keyExtractor={(item, idx) => `${item.ssid}-${idx}`}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.networkRow}
                      onPress={() => handleSelectNetwork(item)}
                      disabled={globalDisabled}
                    >
                      <MaterialCommunityIcons
                        name={item.secure ? "wifi-lock" : "wifi"}
                        size={18}
                        color={Colors.textSecondary}
                      />
                      <Text style={styles.networkName} numberOfLines={1}>
                        {item.ssid}
                      </Text>
                      <Text style={styles.networkRssi}>{item.rssi} dBm</Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            <InputGroup
              label="Nombre de Red (SSID)"
              icon="wifi"
              value={wifiSsid}
              onChange={setWifiSsid}
              placeholder="Ej: MiCasa_WiFi"
              disabled={globalDisabled}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Tipo de Red</Text>
            <SegmentedControl
              options={NETWORK_MODE_OPTIONS}
              selectedIndex={isOpenNetwork ? 1 : 0}
              onChange={(index) => {
                const open = index === 1;
                setIsOpenNetwork(open);
                if (open) setWifiPass("");
              }}
              disabled={globalDisabled}
            />

            {!isOpenNetwork && (
              <InputGroup
                label="Contraseña"
                icon="lock-outline"
                value={wifiPass}
                onChange={setWifiPass}
                placeholder="Dejar vacío para borrar la clave actual"
                secure
                disabled={globalDisabled}
                autoCapitalize="none"
              />
            )}

            <TouchableOpacity
              style={[
                styles.btnAction,
                (globalDisabled || isTestingConnection) && styles.btnDisabled,
              ]}
              onPress={handleTestConnection}
              disabled={globalDisabled || isTestingConnection}
            >
              <Text style={styles.btnActionText}>
                {isTestingConnection
                  ? "Guardando y conectando..."
                  : "Guardar y Conectar"}
              </Text>
            </TouchableOpacity>

            {connectionLabel && (
              <View style={styles.statusBlock}>
                <View style={styles.statusRow}>
                  <MaterialCommunityIcons
                    name={connectionIcon}
                    size={20}
                    color={connectionColor}
                  />
                  <Text style={[styles.statusText, { color: connectionColor }]}>
                    {connectionLabel}
                  </Text>
                </View>
                {connectionErrorMsg ? (
                  <Text style={styles.statusSubtext}>{connectionErrorMsg}</Text>
                ) : null}
              </View>
            )}
          </View>
        </View>

        {/* 2. SECCIÓN SERVIDOR */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conexión Servidor</Text>
          <View style={[GlobalStyles.card, styles.cardOverrides]}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <MaterialCommunityIcons
                name="shield-check"
                size={24}
                color={Colors.success}
              />
              <Text
                style={{
                  marginLeft: 10,
                  color: Colors.textSecondary,
                  flex: 1,
                  fontSize: 13,
                }}
              >
                Las credenciales (URL Función, API Key, Token) se cargan desde
                la App.
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.btnSecondary,
                globalDisabled && styles.btnDisabled,
              ]}
              onPress={handleSyncServer}
              disabled={globalDisabled}
            >
              <MaterialCommunityIcons
                name="cloud-sync"
                size={20}
                color={Colors.primary}
              />
              <Text style={styles.btnSecondaryText}>
                Sincronizar Credenciales
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 3. SECCIÓN INTERVALO DE SUBIDA */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Intervalo de Subida</Text>
          <View style={[GlobalStyles.card, styles.cardOverrides]}>
            <TimeIntervalInput
              label="Subida a Nube"
              valueSeconds={uploadInterval}
              onChangeSeconds={setUploadInterval}
            />
            <TouchableOpacity
              style={[styles.btnAction, globalDisabled && styles.btnDisabled]}
              onPress={handleUpdateTimings}
              disabled={globalDisabled}
            >
              <Text style={styles.btnActionText}>Actualizar Intervalo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 4. HERRAMIENTAS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mantenimiento</Text>
          <View style={[GlobalStyles.card, styles.cardOverrides]}>
            <TouchableOpacity
              style={styles.rowBtn}
              onPress={handleSyncRTC}
              disabled={globalDisabled}
            >
              <MaterialCommunityIcons
                name="clock-check-outline"
                size={20}
                color={Colors.textPrimary}
              />
              <Text style={styles.rowBtnText}>Sincronizar Hora</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.rowBtn}
              onPress={handleDeleteData}
              disabled={globalDisabled}
            >
              <MaterialCommunityIcons
                name="delete-forever"
                size={20}
                color={Colors.error}
              />
              <Text style={[styles.rowBtnText, { color: Colors.error }]}>
                Borrar Memoria
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// --- Componentes UI locales ---
const InputGroup = ({
  label,
  value,
  onChange,
  icon,
  secure,
  keyboardType,
  disabled,
  placeholder,
  autoCapitalize,
}: any) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={styles.label}>{label}</Text>
    <View style={[styles.inputContainer, disabled && styles.inputDisabled]}>
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={Colors.textSecondary}
        style={{ marginRight: 8 }}
      />
      <TextInput
        style={[styles.input, disabled && { color: Colors.offline }]}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={keyboardType || "default"}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={Colors.offline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cardBackground },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  backBtn: { padding: 4 },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 16,
    color: Colors.textPrimary,
  },
  scroll: { padding: 16 },

  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  // GlobalStyles.card ya define fondo/borde/radius/elevation; acá solo ajustamos lo que difiere (radius, margen)
  cardOverrides: { borderRadius: 12, marginVertical: 0 },

  label: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
    fontWeight: "600",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 45,
  },
  inputDisabled: { backgroundColor: "#f0f0f0", borderColor: "#ddd" },
  input: { flex: 1, fontSize: 16, color: Colors.textPrimary },

  btnAction: {
    backgroundColor: Colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  btnActionText: { color: Colors.textInverse, fontWeight: "bold" },

  btnSecondary: {
    flexDirection: "row",
    backgroundColor: "#e3f2fd",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnSecondaryText: { color: Colors.primary, fontWeight: "bold" },

  quickFillRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  quickFillHint: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 12,
  },

  btnOutline: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: Colors.primary,
    padding: 11,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnOutlineText: { color: Colors.primary, fontWeight: "bold" },

  btnDisabled: { opacity: 0.5 },

  rowBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  rowBtnText: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: "500",
    color: Colors.textPrimary,
  },
  divider: { height: 1, backgroundColor: Colors.border },

  networkList: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    overflow: "hidden",
  },
  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  networkName: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  networkRssi: { fontSize: 12, color: Colors.textSecondary },

  // Estilo de estado consistente con el patrón "metricItem" de SensorStatusPanel
  statusBlock: { marginTop: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { fontWeight: "bold", fontSize: 14 },
  statusSubtext: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    marginLeft: 28,
  },
});
