import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Buffer } from "buffer";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import GatewayMultiLineChart from "../../../components/sensor/GatewayMultiLineChart";
import SensorInfoBar from "../../../components/sensor/SensorInfoBar";
import { BLE_UUIDS } from "../../../constants/BleUUIDs";
import { Colors } from "../../../constants/Colors";
import { useBle } from "../../../context/BleContext";
import {
  getSensorById,
  unlinkSensor,
} from "../../../database/SensorRepository";
import { SensorEntity } from "../../../database/types";
import { ingestService } from "../../../services/ingestService";
import {
  getBatteryColor,
  getBatteryIcon,
  getBatteryPercentage,
} from "../../../utils/batteryUtils";
import type { IngestLog } from "../../../utils/types";

// --- SUPABASE ---
import { supabase } from "../../../lib/supabase";

interface GatewayStatus {
  device_id: string;
  last_heartbeat: string;
  fw_version: string | null;
  wifi_status: "ONLINE" | "LOCAL" | "OFFLINE" | null;
  battery_pct: number | null;
  battery_mv: number | null;
  uptime_s: number | null;
  free_heap: number | null;
  lora_ready: boolean | null;
  pending_batches: number | null;
  last_lora_rx: string | null;
  rssi: number | null;
  updated_at: string | null;
}

const CLOUD_STALE_MS = 10 * 60 * 1000; // 10 minutos sin heartbeat = "sin contacto"

// --- HELPER: FORMATO FECHA ARGENTINA ---
const formatDateAR = (isoStringOrTimestamp: string | number) => {
  if (!isoStringOrTimestamp) return "--/-- --:--";
  let date: Date;
  if (typeof isoStringOrTimestamp === "number") {
    date = new Date(isoStringOrTimestamp * 1000);
  } else {
    date = new Date(isoStringOrTimestamp);
  }
  if (isNaN(date.getTime())) return "--/-- --:--";
  return date
    .toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
};

// Ventana fija de 24hs para el historial de ingesta (rolling: siempre
// "las últimas 24 horas desde ahora", se recalcula en cada refresco).
const INGEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const INGEST_REFRESH_MS = 30000;

// Agrupamiento de los gráficos: baldes de 3hs (8 puntos en 24hs) en vez de
// 1hs (24 puntos). Con 24 puntos en un ancho fijo sin scroll, cada etiqueta
// queda con ~11px de espacio real y se corta ("0..."); con 8 puntos cada
// etiqueta tiene ~35-40px, suficiente para mostrarse completa en cualquier
// resolución.
const BUCKET_HOURS = 3;
const BUCKET_COUNT = 24 / BUCKET_HOURS; // 8 baldes

export default function GatewayDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const sensorIdStr = Array.isArray(id) ? id[0] : id;

  const {
    connectedDevice,
    sensorData,
    diagnosisStatus,
    isBusy,
    disconnectDevice,
  } = useBle();
  const isConnected = !!connectedDevice;
  const [dbSensor, setDbSensor] = useState<SensorEntity | null>(null);
  const [cloudStatus, setCloudStatus] = useState<GatewayStatus | null>(null);
  const [cloudStatusLoading, setCloudStatusLoading] = useState(true);

  // ROL DEL USUARIO
  const [userRole, setUserRole] = useState<string>("viewer");
  const canEdit = userRole === "owner" || userRole === "editor";

  const [isDeleting, setIsDeleting] = useState(false);

  // --- HISTORIAL DE INGESTA (Supabase, independiente del BLE) ---
  const [ingestLogs, setIngestLogs] = useState<IngestLog[]>([]);
  const [ingestLoading, setIngestLoading] = useState(true);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // 1. Cargar datos de DB Local
  useEffect(() => {
    const load = async () => {
      if (sensorIdStr) {
        const data = await getSensorById(sensorIdStr);
        setDbSensor(data);
      }
    };
    load();
  }, [sensorIdStr]);

  // 2. Verificar Rol (Local + Nube)
  useEffect(() => {
    const checkRole = async () => {
      if (!dbSensor) return;

      // A. Intentar leer del JSON local primero
      try {
        const config = JSON.parse(dbSensor.config_json || "{}");
        if (config.role) setUserRole(config.role);
      } catch {}

      // B. Verificar en Supabase si hay internet
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("sensor_permissions")
          .select("role")
          .eq("device_id", sensorIdStr)
          .eq("user_id", user.id)
          .single();

        if (data?.role) {
          setUserRole(data.role);
        }
      }
    };
    checkRole();
  }, [dbSensor, sensorIdStr]);

  // 3. Desconexión al salir
  useEffect(() => {
    return () => {
      console.log("[Dashboard] Componente destruido. Desconectando...");
      disconnectDevice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4. Historial de ingesta — últimas 24hs, con auto-refresco cada 30s.
  // No depende de "isConnected" (BLE): esto viaja por Supabase, así que
  // funciona aunque el celular no esté cerca del Gateway físicamente.
  useEffect(() => {
    if (!sensorIdStr) return;
    let cancelled = false;

    const loadIngestLogs = async () => {
      try {
        setIngestError(null);
        const to = new Date();
        const from = new Date(to.getTime() - INGEST_WINDOW_MS);
        const data = await ingestService.getLogs(
          sensorIdStr,
          from.toISOString(),
          to.toISOString(),
        );
        if (!cancelled) setIngestLogs(data);
      } catch (err: any) {
        console.error("Error cargando historial de ingesta:", err);
        if (!cancelled) {
          setIngestError(err?.message || "No se pudo cargar el historial.");
        }
      } finally {
        if (!cancelled) setIngestLoading(false);
      }
    };

    setIngestLoading(true);
    loadIngestLogs();
    const interval = setInterval(loadIngestLogs, INGEST_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sensorIdStr]);

  // Estados específicos del Gateway
  const wifiStatus = diagnosisStatus.wifiStatus || "UNKNOWN";
  const isWifiOnline = wifiStatus === "ONLINE";
  const batteryPercent = isConnected ? (sensorData.battery ?? 0) : 0;

  // --- PARSEO DE LISTA DE SENSORES (LORA) ---
  const loraSensors = useMemo(() => {
    if (!diagnosisStatus.sensorsList) return [];
    try {
      const raw = JSON.parse(diagnosisStatus.sensorsList);
      return Object.keys(raw)
        .map((key) => ({
          id: key,
          ...raw[key],
        }))
        .sort((a: any, b: any) => b.last - a.last);
    } catch {
      return [];
    }
  }, [diagnosisStatus.sensorsList]);

  // --- ESTADÍSTICAS DEL HISTORIAL DE INGESTA ---
  const ingestStats = useMemo(() => {
    const total = ingestLogs.length;
    const success = ingestLogs.filter(
      (l) => l.request_status === "success",
    ).length;
    const failed = ingestLogs.filter(
      (l) => l.request_status === "error",
    ).length;
    // ingestLogs viene ordenado ASCENDENTE (más viejo -> más nuevo),
    // así que el más reciente es el ÚLTIMO elemento, no el primero.
    const last =
      ingestLogs.length > 0 ? ingestLogs[ingestLogs.length - 1] : null;
    return { total, success, failed, last };
  }, [ingestLogs]);

  // --- DATOS PARA LOS GRÁFICOS: baldes de 3 horas ---
  const hourlyBuckets = useMemo(() => {
    const now = new Date();
    const bucketMs = BUCKET_HOURS * 60 * 60 * 1000;

    const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => {
      const bucketsAgo = BUCKET_COUNT - 1 - i;
      const bucketTime = new Date(now.getTime() - bucketsAgo * bucketMs);
      return {
        label: `${String(bucketTime.getHours()).padStart(2, "0")}h`,
        recibidas: 0,
        insertadas: 0,
        duplicadas: 0,
        demoraSum: 0,
        demoraCount: 0,
        procSum: 0,
        procCount: 0,
      };
    });

    ingestLogs.forEach((log) => {
      const logTime = new Date(log.received_at).getTime();
      const bucketsAgo = Math.floor((now.getTime() - logTime) / bucketMs);
      const idx = BUCKET_COUNT - 1 - bucketsAgo;
      if (idx < 0 || idx >= BUCKET_COUNT) return;

      buckets[idx].recibidas += log.readings_received ?? 0;
      buckets[idx].insertadas += log.readings_inserted ?? 0;
      buckets[idx].duplicadas += log.readings_duplicate ?? 0;

      if (typeof log.upload_delay_seconds === "number") {
        buckets[idx].demoraSum += log.upload_delay_seconds;
        buckets[idx].demoraCount += 1;
      }
      if (typeof log.processing_ms === "number") {
        buckets[idx].procSum += log.processing_ms;
        buckets[idx].procCount += 1;
      }
    });

    return buckets.map((b) => ({
      label: b.label,
      recibidas: b.recibidas,
      insertadas: b.insertadas,
      duplicadas: b.duplicadas,
      demora: b.demoraCount > 0 ? Math.round(b.demoraSum / b.demoraCount) : 0,
      procesamiento: b.procCount > 0 ? Math.round(b.procSum / b.procCount) : 0,
    }));
  }, [ingestLogs]);

  const bucketLabels = useMemo(
    () => hourlyBuckets.map((b) => b.label),
    [hourlyBuckets],
  );

  const hasIngestData = !ingestLoading && !ingestError && ingestLogs.length > 0;

  // Demora y Procesamiento no se grafican como línea de tiempo — son
  // valores que varían poco y un promedio simple dice más de un vistazo
  // que una curva. Se muestran como stats, no como gráfico.
  const perfStats = useMemo(() => {
    const withDemora = ingestLogs.filter(
      (l) => typeof l.upload_delay_seconds === "number",
    );
    const withProc = ingestLogs.filter(
      (l) => typeof l.processing_ms === "number",
    );

    const avgDemora =
      withDemora.length > 0
        ? Math.round(
            withDemora.reduce(
              (sum, l) => sum + (l.upload_delay_seconds as number),
              0,
            ) / withDemora.length,
          )
        : null;

    const avgProc =
      withProc.length > 0
        ? Math.round(
            withProc.reduce((sum, l) => sum + (l.processing_ms as number), 0) /
              withProc.length,
          )
        : null;

    return { avgDemora, avgProc };
  }, [ingestLogs]);

  // Acción rápida: Forzar Subida
  const handleForceSync = async () => {
    if (!connectedDevice) return;
    try {
      const base64Val = Buffer.from("1").toString("base64");
      await connectedDevice.writeCharacteristicWithResponseForService(
        BLE_UUIDS.SVC_CONFIG,
        BLE_UUIDS.CONFIG.SEND_NOW,
        base64Val,
      );
      Alert.alert(
        "Comando Enviado",
        "El Gateway intentará subir los datos pendientes ahora.",
      );
    } catch {
      Alert.alert("Error", "No se pudo enviar el comando.");
    }
  };

  // Estado en la nube (heartbeat), independiente de si hay BLE conectado
  useEffect(() => {
    if (!sensorIdStr) return;

    let active = true;

    const loadCloudStatus = async () => {
      const { data, error } = await supabase
        .from("gateway_status")
        .select("*")
        .eq("device_id", sensorIdStr)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error(
          "[GatewayDashboard] Error obteniendo gateway_status:",
          error.message,
        );
      } else {
        setCloudStatus(data as GatewayStatus | null);
      }

      setCloudStatusLoading(false);
    };

    loadCloudStatus();
    const interval = setInterval(loadCloudStatus, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sensorIdStr]);

  const lastHeartbeatMs = cloudStatus?.last_heartbeat
    ? new Date(cloudStatus.last_heartbeat).getTime()
    : null;

  const isCloudStale =
    !lastHeartbeatMs || Date.now() - lastHeartbeatMs > CLOUD_STALE_MS;

  const cloudLabel = cloudStatusLoading
    ? "Cargando..."
    : isCloudStale
      ? "SIN CONTACTO"
      : cloudStatus?.wifi_status === "ONLINE"
        ? "EN LÍNEA"
        : cloudStatus?.wifi_status === "LOCAL"
          ? "WIFI SIN INTERNET"
          : "DESCONOCIDO";

  const cloudColors =
    cloudStatusLoading || isCloudStale
      ? { bg: "#f5f5f5", text: "#999" }
      : cloudStatus?.wifi_status === "ONLINE"
        ? { bg: "#e8f5e9", text: "#2e7d32" }
        : { bg: "#fff3e0", text: "#ef6c00" };

  // Acción: Eliminar / Desvincular
  const handleUnlink = () => {
    const isOwner = userRole === "owner";
    const message = isOwner
      ? "Eres el PROPIETARIO. Si confirmas, perderás el control sobre este Gateway y quedará LIBRE para que otro usuario lo registre.\n\nSe borrarán todos los datos locales."
      : "Se eliminará el Gateway de tu lista local. El propietario seguirá teniendo acceso.";

    Alert.alert(isOwner ? "Liberar Gateway" : "Desvincular", message, [
      { text: "Cancelar", style: "cancel" },
      {
        text: isOwner ? "Liberar y Borrar" : "Borrar",
        style: "destructive",
        onPress: async () => {
          setIsDeleting(true);
          try {
            if (connectedDevice) await disconnectDevice();
            const result = await unlinkSensor(sensorIdStr);
            if (result.success) {
              router.replace("/");
            } else {
              Alert.alert("Error", "No se pudo eliminar: " + result.error);
            }
          } catch (error) {
            console.error(error);
            Alert.alert("Error", "Fallo al eliminar.");
          } finally {
            setIsDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER DE ESTADO */}
      <View style={[styles.headerPanel, { paddingTop: 50 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Gateway N01</Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: isConnected
                      ? Colors.success
                      : Colors.error,
                  },
                ]}
              />
              <Text style={styles.headerSub}>
                {isConnected ? "Conectado por BLE" : "Desconectado"}
              </Text>
            </View>
          </View>
          <View style={styles.batteryBadge}>
            <MaterialCommunityIcons
              name="battery"
              size={20}
              color={isConnected ? Colors.success : "#ccc"}
            />
            <Text style={{ fontWeight: "bold", color: "#555" }}>
              {isConnected ? `${batteryPercent}%` : "--"}
            </Text>
          </View>
        </View>
      </View>

      {/* BADGE DE ROL */}
      <View
        style={{
          backgroundColor:
            userRole === "owner"
              ? "#e8f5e9"
              : userRole === "editor"
                ? "#e3f2fd"
                : "#fff3e0",
          paddingVertical: 4,
          paddingHorizontal: 16,
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: 6,
        }}
      >
        <MaterialCommunityIcons
          name={
            userRole === "owner"
              ? "shield-check"
              : userRole === "editor"
                ? "file-edit-outline"
                : "eye-outline"
          }
          size={14}
          color={
            userRole === "owner"
              ? "#2e7d32"
              : userRole === "editor"
                ? "#1565c0"
                : "#ef6c00"
          }
        />
        <Text
          style={{
            fontSize: 12,
            fontWeight: "bold",
            color:
              userRole === "owner"
                ? "#2e7d32"
                : userRole === "editor"
                  ? "#1565c0"
                  : "#ef6c00",
            textTransform: "uppercase",
          }}
        >
          {userRole === "owner"
            ? "Administrador (Dueño)"
            : userRole === "editor"
              ? "Editor"
              : "Modo Visualizador"}
        </Text>
      </View>

      <SensorInfoBar
        id={sensorIdStr}
        alias={dbSensor?.alias || "Cargando..."}
        location={dbSensor?.location || "Sin ubicación"}
        onEditPress={() => {
          if (canEdit) {
            router.push(`/gateway/${sensorIdStr}/info`);
          } else {
            Alert.alert(
              "Modo Visualizador",
              "Solo el propietario puede editar la configuración del Gateway.",
            );
          }
        }}
        isOffline={!isConnected}
      />

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ padding: 16 }}
      >
        {/* 1. ESTADO DE RED (solo WiFi en vivo por BLE) */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Estado de Conectividad</Text>

          <View style={styles.statusRow}>
            <View style={styles.statusIcon}>
              <MaterialCommunityIcons
                name="wifi"
                size={24}
                color={
                  isWifiOnline
                    ? Colors.success
                    : wifiStatus === "LOCAL"
                      ? Colors.warning
                      : Colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>Conexión WiFi</Text>
              <Text style={styles.statusValue}>{wifiStatus}</Text>
            </View>
          </View>
        </View>

        {/* 2. ESTADO EN LA NUBE (heartbeat, no depende del BLE) */}
        <View style={styles.sectionCard}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 15,
            }}
          >
            <Text style={styles.sectionTitle}>Estado en la Nube</Text>
            <View
              style={[styles.cloudBadge, { backgroundColor: cloudColors.bg }]}
            >
              <Text
                style={[styles.cloudBadgeText, { color: cloudColors.text }]}
              >
                {cloudLabel}
              </Text>
            </View>
          </View>

          {cloudStatus ? (
            <>
              <View style={styles.statusRow}>
                <View style={styles.statusIcon}>
                  <MaterialCommunityIcons
                    name="cloud-clock-outline"
                    size={24}
                    color={Colors.textSecondary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusLabel}>Último aviso a la nube</Text>
                  <Text style={styles.statusValue}>
                    {formatDateAR(cloudStatus.last_heartbeat)}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <View style={styles.dataItem}>
                  <Text style={styles.dataLabel}>Batería</Text>
                  <Text style={styles.dataValue}>
                    {cloudStatus.battery_pct != null
                      ? `${cloudStatus.battery_pct}%`
                      : "--"}
                  </Text>
                </View>

                <View style={styles.dataItem}>
                  <Text style={styles.dataLabel}>RSSI</Text>
                  <Text style={styles.dataValue}>
                    {cloudStatus.rssi != null
                      ? `${cloudStatus.rssi} dBm`
                      : "--"}
                  </Text>
                </View>

                <View style={styles.dataItem}>
                  <Text style={styles.dataLabel}>LoRa</Text>
                  <Text style={styles.dataValue}>
                    {cloudStatus.lora_ready ? "OK" : "Error"}
                  </Text>
                </View>

                <View style={styles.dataItem}>
                  <Text style={styles.dataLabel}>Lotes pend.</Text>
                  <Text style={styles.dataValue}>
                    {cloudStatus.pending_batches ?? 0}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            !cloudStatusLoading && (
              <Text style={{ color: "#999", fontStyle: "italic" }}>
                Este gateway todavía no envió ningún heartbeat a la nube.
              </Text>
            )
          )}
        </View>

        {/* 3. HISTORIAL DE INGESTA (últimas 24hs, vía Supabase — no requiere BLE) */}
        <Text style={styles.sectionHeader}>Historial de Subidas (24 hs)</Text>
        <View style={styles.sectionCard}>
          {ingestLoading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={Colors.primary} />
              <Text
                style={{
                  marginTop: 8,
                  color: Colors.textSecondary,
                  fontSize: 13,
                }}
              >
                Cargando historial...
              </Text>
            </View>
          ) : ingestError ? (
            <View style={{ alignItems: "center", paddingVertical: 10 }}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={28}
                color={Colors.error}
              />
              <Text
                style={{
                  color: Colors.error,
                  fontWeight: "bold",
                  marginTop: 6,
                }}
              >
                No se pudo cargar el historial
              </Text>
              <Text
                style={{
                  color: Colors.textSecondary,
                  fontSize: 12,
                  marginTop: 2,
                  textAlign: "center",
                }}
              >
                {ingestError}
              </Text>
            </View>
          ) : ingestLogs.length === 0 ? (
            <Text
              style={{
                color: "#999",
                fontStyle: "italic",
                textAlign: "center",
                paddingVertical: 10,
              }}
            >
              Sin comunicaciones registradas en las últimas 24hs.
            </Text>
          ) : (
            <>
              <View style={styles.ingestStatsRow}>
                <View style={styles.ingestStatItem}>
                  <Text style={styles.ingestStatLabel}>REQUESTS</Text>
                  <Text style={styles.ingestStatValue}>
                    {ingestStats.total}
                  </Text>
                </View>
                <View style={[styles.ingestStatItem, styles.ingestStatBorder]}>
                  <Text style={styles.ingestStatLabel}>EXITOSOS</Text>
                  <Text
                    style={[styles.ingestStatValue, { color: Colors.success }]}
                  >
                    {ingestStats.success}
                  </Text>
                </View>
                <View style={styles.ingestStatItem}>
                  <Text style={styles.ingestStatLabel}>ERRORES</Text>
                  <Text
                    style={[
                      styles.ingestStatValue,
                      {
                        color:
                          ingestStats.failed > 0
                            ? Colors.error
                            : Colors.textPrimary,
                      },
                    ]}
                  >
                    {ingestStats.failed}
                  </Text>
                </View>
              </View>

              {ingestStats.last && (
                <Text style={styles.lastSync}>
                  Última comunicación:{" "}
                  {formatDateAR(ingestStats.last.received_at)}
                  {"  "}
                  <Text
                    style={{
                      fontWeight: "bold",
                      color:
                        ingestStats.last.request_status === "success"
                          ? Colors.success
                          : Colors.error,
                    }}
                  >
                    {ingestStats.last.request_status === "success"
                      ? "OK"
                      : "ERROR"}
                  </Text>
                </Text>
              )}

              {ingestStats.last?.error_message ? (
                <Text style={styles.ingestErrorDetail}>
                  {ingestStats.last.error_message}
                </Text>
              ) : null}
            </>
          )}
        </View>

        {hasIngestData && (
          <>
            <Text style={styles.sectionHeader}>
              Actividad de Ingesta (cada 3 hs)
            </Text>
            <GatewayMultiLineChart
              title="Lecturas por balde de 3hs"
              unit="cantidad"
              labels={bucketLabels}
              series={[
                {
                  label: "Recibidas",
                  color: Colors.primary,
                  values: hourlyBuckets.map((b) => b.recibidas),
                },
                {
                  label: "Insertadas",
                  color: Colors.success,
                  values: hourlyBuckets.map((b) => b.insertadas),
                },
                {
                  label: "Duplicadas",
                  color: Colors.warning,
                  values: hourlyBuckets.map((b) => b.duplicadas),
                },
              ]}
            />

            <Text style={styles.sectionHeader}>
              Rendimiento del Gateway (24 hs)
            </Text>
            <View style={styles.sectionCard}>
              <View style={styles.ingestStatsRow}>
                <View style={styles.ingestStatItem}>
                  <Text style={styles.ingestStatLabel}>DEMORA PROM.</Text>
                  <Text style={styles.ingestStatValue}>
                    {perfStats.avgDemora !== null
                      ? `${perfStats.avgDemora}s`
                      : "--"}
                  </Text>
                </View>
                <View style={[styles.ingestStatItem, styles.ingestStatBorder]}>
                  <Text style={styles.ingestStatLabel}>
                    PROCESAMIENTO PROM.
                  </Text>
                  <Text style={styles.ingestStatValue}>
                    {perfStats.avgProc !== null
                      ? `${perfStats.avgProc}ms`
                      : "--"}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* 4. ACCIONES DE CONTROL */}
        <Text style={styles.sectionHeader}>Controles</Text>
        <View style={styles.grid}>
          <TouchableOpacity
            style={[
              styles.actionCard,
              (!isConnected || !canEdit) && styles.disabledCard,
            ]}
            disabled={!isConnected || !canEdit}
            onPress={() => {
              if (canEdit) router.push(`/gateway/${sensorIdStr}/config`);
              else
                Alert.alert(
                  "Restringido",
                  "Necesitas permisos de Editor o Dueño para configurar el WiFi.",
                );
            }}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#e8f5e9" }]}>
              <MaterialCommunityIcons
                name="wifi-cog"
                size={28}
                color="#2e7d32"
              />
            </View>
            <Text style={styles.actionTitle}>Configurar WiFi</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, !isConnected && styles.disabledCard]}
            disabled={!isConnected || isBusy}
            onPress={handleForceSync}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#e3f2fd" }]}>
              {diagnosisStatus.syncStatus === "SENDING" ? (
                <ActivityIndicator color={Colors.primary} />
              ) : (
                <MaterialCommunityIcons
                  name="send"
                  size={28}
                  color={Colors.primary}
                />
              )}
            </View>
            <Text style={styles.actionTitle}>Forzar Subida</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleUnlink}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator color="#d32f2f" />
          ) : (
            <>
              <MaterialCommunityIcons
                name={
                  userRole === "owner" ? "link-variant-off" : "delete-outline"
                }
                size={22}
                color="#d32f2f"
              />
              <Text style={styles.deleteButtonText}>
                {userRole === "owner"
                  ? "Liberar Gateway"
                  : "Eliminar de mi lista"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* 5. SENSORES LORA DETECTADOS */}
        <Text style={styles.sectionHeader}>Sensores en Campo (LoRa)</Text>

        {loraSensors.length === 0 ? (
          <View
            style={[styles.sectionCard, { padding: 20, alignItems: "center" }]}
          >
            <Text style={{ color: "#999", fontStyle: "italic" }}>
              Esperando datos de sensores...
            </Text>
            <Text style={{ color: "#ccc", fontSize: 10, marginTop: 5 }}>
              El Gateway escucha en 915MHz
            </Text>
          </View>
        ) : (
          loraSensors.map((sensor: any) => {
            const batPct = getBatteryPercentage(sensor.bat);
            const batColor = getBatteryColor(batPct);
            const batIcon = getBatteryIcon(batPct);

            return (
              <View key={sensor.id} style={styles.sensorCard}>
                <View style={styles.sensorHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialCommunityIcons
                      name={
                        sensor.type === "C01"
                          ? "weather-partly-cloudy"
                          : "sprout"
                      }
                      size={20}
                      color={Colors.primary}
                    />
                    <Text style={styles.sensorId}>{sensor.id}</Text>
                    <View style={styles.sensorTypeBadge}>
                      <Text style={styles.sensorTypeText}>{sensor.type}</Text>
                    </View>
                  </View>
                  <Text style={styles.sensorTime}>
                    {formatDateAR(sensor.last)}
                  </Text>
                </View>

                <View style={styles.sensorDataRow}>
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>
                      {sensor.type === "C01" ? "T. Aire" : "T. Suelo"}
                    </Text>
                    <Text style={styles.dataValue}>
                      {sensor.v1 != null
                        ? `${Number(sensor.v1).toFixed(1)}°C`
                        : "--"}
                    </Text>
                  </View>

                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>
                      {sensor.type === "C01" ? "Humedad" : "Hum. (mV)"}
                    </Text>
                    <Text style={styles.dataValue}>
                      {sensor.v2 != null
                        ? sensor.type === "C01"
                          ? `${Number(sensor.v2).toFixed(1)}%`
                          : sensor.v2
                        : "--"}
                    </Text>
                  </View>

                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>Batería</Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 2,
                      }}
                    >
                      <MaterialCommunityIcons
                        name={sensor.bat ? (batIcon as any) : "battery-unknown"}
                        size={18}
                        color={sensor.bat ? batColor : "#ccc"}
                      />
                      <Text
                        style={[
                          styles.dataValue,
                          {
                            color: sensor.bat ? batColor : "#555",
                            marginTop: 0,
                          },
                        ]}
                      >
                        {sensor.bat ? `${Math.round(batPct)}%` : "--"}
                      </Text>
                    </View>
                    {sensor.bat ? (
                      <Text
                        style={{ fontSize: 9, color: "#999", marginTop: 1 }}
                      >
                        {(sensor.bat / 1000).toFixed(2)}V
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f2" },
  headerPanel: {
    backgroundColor: "#fff",
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { fontSize: 24, fontWeight: "bold", color: Colors.textPrimary },
  headerSub: { fontSize: 14, color: Colors.textSecondary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  batteryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 6,
    borderRadius: 12,
    gap: 4,
  },

  cloudBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cloudBadgeText: {
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
  },

  content: { flex: 1 },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.textPrimary,
    marginBottom: 15,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "bold",
    color: Colors.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
    textTransform: "uppercase",
  },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 15 },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f9f9f9",
    justifyContent: "center",
    alignItems: "center",
  },
  statusLabel: { fontSize: 14, color: Colors.textSecondary },
  statusValue: { fontSize: 16, fontWeight: "bold", color: Colors.textPrimary },
  lastSync: { fontSize: 13, color: "#666", marginTop: 2, fontWeight: "500" },
  divider: { height: 1, backgroundColor: "#eee", marginVertical: 15 },

  // --- Historial de ingesta ---
  ingestStatsRow: { flexDirection: "row", justifyContent: "space-between" },
  ingestStatItem: { alignItems: "center", flex: 1 },
  ingestStatBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#eee",
  },
  ingestStatLabel: {
    fontSize: 10,
    color: "#888",
    fontWeight: "bold",
    marginBottom: 4,
  },
  ingestStatValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.textPrimary,
  },
  ingestErrorDetail: { fontSize: 12, color: Colors.error, marginTop: 6 },

  grid: { flexDirection: "row", gap: 12, marginBottom: 20 },
  actionCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    elevation: 2,
  },
  disabledCard: { opacity: 0.6, backgroundColor: "#f0f0f0" },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  actionTitle: { fontWeight: "bold", color: Colors.textPrimary, fontSize: 14 },
  actionSub: { color: Colors.textSecondary, fontSize: 12, textAlign: "center" },

  sensorCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#eee",
  },
  sensorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    paddingBottom: 8,
  },
  sensorId: { fontWeight: "bold", fontSize: 16, color: "#333", marginLeft: 6 },
  sensorTypeBadge: {
    backgroundColor: "#e3f2fd",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffebee", // Rojo muy claro de fondo
    padding: 12,
    borderRadius: 12,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "#ffcdd2",
  },
  deleteButtonText: {
    color: "#d32f2f", // Rojo fuerte
    fontWeight: "bold",
    fontSize: 14,
  },
  sensorTypeText: { fontSize: 10, fontWeight: "bold", color: Colors.primary },
  sensorTime: { fontSize: 12, color: "#888" },

  sensorDataRow: { flexDirection: "row", justifyContent: "space-between" },
  dataItem: { alignItems: "center", flex: 1 },
  dataLabel: { fontSize: 11, color: "#999", textTransform: "uppercase" },
  dataValue: { fontSize: 15, fontWeight: "bold", color: "#444", marginTop: 2 },
});
