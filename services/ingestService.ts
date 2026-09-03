import { supabase } from "../lib/supabase";
import type { IngestLog } from "../utils/types";

// Calcado de sensor-web/src/services/ingestService.ts — misma tabla
// (public.ingest_logs), mismos filtros, para que ambos proyectos lean
// exactamente los mismos datos de la misma forma.
export const ingestService = {
  async getLogs(
    deviceId: string,
    from: string,
    to: string,
  ): Promise<IngestLog[]> {
    const { data, error } = await supabase
      .from("ingest_logs")
      .select("*")
      .eq("device_id", deviceId)
      .gte("received_at", from)
      .lte("received_at", to)
      .order("received_at", { ascending: true });

    if (error) {
      console.error("[ingestService] Error al obtener logs:", error.message);
      throw new Error(error.message);
    }

    return (data || []) as IngestLog[];
  },

  async getRecentLogs(
    deviceId: string,
    limit: number = 30,
  ): Promise<IngestLog[]> {
    const { data, error } = await supabase
      .from("ingest_logs")
      .select("*")
      .eq("device_id", deviceId)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(
        "[ingestService] Error al obtener logs recientes:",
        error.message,
      );
      throw new Error(error.message);
    }

    return (data || []) as IngestLog[];
  },

  async getLatestLog(deviceId: string): Promise<IngestLog | null> {
    const { data, error } = await supabase
      .from("ingest_logs")
      .select("*")
      .eq("device_id", deviceId)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        "[ingestService] Error al obtener último log:",
        error.message,
      );
      throw new Error(error.message);
    }

    return data as IngestLog | null;
  },
};
