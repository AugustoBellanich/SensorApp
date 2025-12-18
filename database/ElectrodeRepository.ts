import { db } from './DatabaseInit';
import { ElectrodeEntity } from './types';

export const ElectrodeRepository = {
  // Guardar o actualizar un electrodo (Usado en Pull y en Calibración)
  async saveElectrode(elec: ElectrodeEntity) {
    const query = `
      INSERT OR REPLACE INTO device_electrodes 
      (id, sensor_id, electrode_index, depth, texture, density, points_json, equations_json, is_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    await db.runAsync(query, [
      elec.id, elec.sensor_id, elec.electrode_index, elec.depth, 
      elec.texture, elec.density, elec.points_json, elec.equations_json, 
      elec.is_synced, elec.updated_at
    ]);
  },

  // Obtener todos los electrodos de un sensor (Para el Dashboard y el Push)
  async getElectrodesBySensor(sensorId: string): Promise<ElectrodeEntity[]> {
    return await db.getAllAsync<ElectrodeEntity>(
      "SELECT * FROM device_electrodes WHERE sensor_id = ? ORDER BY electrode_index ASC",
      [sensorId]
    );
  },

  // Marcar como sincronizado tras subir a Supabase
  async markElectrodeSynced(id: string) {
    await db.runAsync(
      "UPDATE device_electrodes SET is_synced = 1 WHERE id = ?",
      [id]
    );
  }
};

// Exportamos las funciones sueltas para que coincidan con los imports del syncService
export const saveElectrode = ElectrodeRepository.saveElectrode;
export const getElectrodesBySensor = ElectrodeRepository.getElectrodesBySensor;
export const markElectrodeSynced = ElectrodeRepository.markElectrodeSynced;