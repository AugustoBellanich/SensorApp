// src/utils/batteryUtils.ts

/**
 * Calcula el porcentaje aproximado de una batería 18650 Li-Ion
 * basado en su voltaje en milivoltios.
 * * La curva no es lineal:
 * 4200mV+ -> 100%
 * ~3700mV -> ~50% (Voltaje nominal)
 * ~3300mV -> 0% (Corte seguro)
 */
export const getBatteryPercentage = (voltageMv: number): number => {
    if (!voltageMv) return 0;

    // Tabla de mapeo aproximada para Li-Ion bajo carga leve
    if (voltageMv >= 4200) return 100;
    if (voltageMv >= 4100) return 90 + ((voltageMv - 4100) / 100) * 10;
    if (voltageMv >= 4000) return 80 + ((voltageMv - 4000) / 100) * 10;
    if (voltageMv >= 3900) return 70 + ((voltageMv - 3900) / 100) * 10;
    if (voltageMv >= 3800) return 60 + ((voltageMv - 3800) / 100) * 10;
    
    // La zona "meseta" (Nominal 3.7V)
    if (voltageMv >= 3700) return 40 + ((voltageMv - 3700) / 100) * 20;
    if (voltageMv >= 3600) return 20 + ((voltageMv - 3600) / 100) * 20;
    
    // La zona de caída rápida (Batería baja)
    if (voltageMv >= 3500) return 10 + ((voltageMv - 3500) / 100) * 10;
    if (voltageMv >= 3300) return 0 + ((voltageMv - 3300) / 200) * 10;
    
    return 0; // Menos de 3.3V se considera muerta para proteger la celda
};

/**
 * Devuelve un color para la UI basado en el porcentaje
 */
export const getBatteryColor = (percentage: number) => {
    if (percentage > 50) return "#2e7d32"; // Verde (Colors.success)
    if (percentage > 20) return "#f57c00"; // Naranja
    return "#d32f2f"; // Rojo (Colors.error)
};

/**
 * Devuelve el nombre del icono de MaterialCommunityIcons
 */
export const getBatteryIcon = (percentage: number) => {
    if (percentage >= 90) return "battery";
    if (percentage >= 70) return "battery-70";
    if (percentage >= 50) return "battery-50";
    if (percentage >= 30) return "battery-30";
    if (percentage >= 10) return "battery-10";
    return "battery-alert"; // Crítico
};