import { db } from '../database/DatabaseInit';

export const debugDatabase = async () => {
  try {
    console.log("==========================================");
    console.log("🕵️‍♂️ DIAGNÓSTICO DE BASE DE DATOS (V5)");
    console.log("==========================================");

    // 1. TAMAÑO FÍSICO
    // page_count * page_size = bytes totales
    const pageCount: any = await db.getFirstAsync('PRAGMA page_count'); 
    const pageSize: any = await db.getFirstAsync('PRAGMA page_size');
    const totalBytes = (pageCount['page_count'] || 0) * (pageSize['page_size'] || 0);
    const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);
    console.log(`📦 Tamaño DB: ${sizeMB} MB`);

    // 2. CONTEO DE SENSORES
    const sensors: any[] = await db.getAllAsync('SELECT id, alias, is_synced FROM sensors');
    console.log(`📡 Sensores guardados (${sensors.length}):`);
    sensors.forEach(s => console.log(`   - ID: ${s.id} | Alias: ${s.alias} | Synced: ${s.is_synced}`));

    // 3. DATOS B01 (SUELO)
    const countB01: any = await db.getFirstAsync('SELECT COUNT(*) as c FROM readings_b01');
    console.log(`🌱 Lecturas B01 (Suelo): ${countB01.c}`);
    
    if (countB01.c > 0) {
        // Ver rangos de fechas e IDs
        const ranges: any = await db.getFirstAsync(`
            SELECT 
                MIN(timestamp) as min_ts, 
                MAX(timestamp) as max_ts, 
                COUNT(DISTINCT sensor_id) as sensor_count 
            FROM readings_b01
        `);
        console.log(`   📅 Rango: ${ranges.min_ts}  -->  ${ranges.max_ts}`);
        
        // Ver los primeros 3 IDs reales para comparar
        const sampleIds: any[] = await db.getAllAsync('SELECT DISTINCT sensor_id FROM readings_b01 LIMIT 3');
        console.log(`   🆔 IDs en lecturas: ${sampleIds.map(s => s.sensor_id).join(', ')}`);
    }

    // 4. DATOS C01 (CLIMA)
    const countC01: any = await db.getFirstAsync('SELECT COUNT(*) as c FROM readings_c01');
    console.log(`☁️ Lecturas C01 (Clima): ${countC01.c}`);

    if (countC01.c > 0) {
        const ranges: any = await db.getFirstAsync(`
            SELECT 
                MIN(timestamp) as min_ts, 
                MAX(timestamp) as max_ts 
            FROM readings_c01
        `);
        console.log(`   📅 Rango: ${ranges.min_ts}  -->  ${ranges.max_ts}`);
        
        const sampleIds: any[] = await db.getAllAsync('SELECT DISTINCT sensor_id FROM readings_c01 LIMIT 3');
        console.log(`   🆔 IDs en lecturas: ${sampleIds.map(s => s.sensor_id).join(', ')}`);
    }

    console.log("==========================================");
  } catch (e) {
    console.error("❌ Error ejecutando diagnóstico:", e);
  }
};