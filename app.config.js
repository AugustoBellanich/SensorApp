export default ({ config }) => {
  // Detecta si estás usando el perfil de preview (APK)
  const isTest = process.env.APP_VARIANT === 'test';

  return {
    ...config,
    // Nombre que verás en el icono del celular
    name: isTest ? "SENSOR APP (TEST)" : "SENSOR APP",
    slug: "SensorApp", // Coincide con tu ID de proyecto en EAS
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "sensorapp",
    userInterfaceStyle: "light",
    newArchEnabled: true,

    splash: {
      image: "./assets/images/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },

    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#ffffff"
      },
      // ID del paquete dinámico para permitir instalar ambas apps
      package: isTest ? "com.bellanich.agrosense.test" : "com.inta.sensorapp",
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      // Permisos explícitos (opcional, pero buena práctica con BLE)
      permissions: [
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_ADMIN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.ACCESS_FINE_LOCATION"
      ]
    },

    plugins: [
      "expo-router",
      "expo-sqlite",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash.png",
          //"imageWidth": 200,
          "resizeMode": "native",
          "backgroundColor": "#ffffff",
          "dark": {
             "backgroundColor": "#ffffff"
          }
        }
      ],
      // --- SOLUCIÓN AL CRASH (Desactiva Minificación/ProGuard) ---
      [
        "expo-build-properties",
        {
          "android": {
            "enableProguardInReleaseBuilds": false,
            // Reglas extra por si acaso, aunque con false arriba ya debería bastar
            "extraProguardRules": "-keep class com.polidea.reactnativeble.** { *; } -keep class com.rxandroidble2.** { *; }"
          }
        }
      ],
      // --- CONFIGURACIÓN BLE NATIVA (Vital para APK) ---
      [
        "@config-plugins/react-native-ble-plx",
        {
          "isBackgroundEnabled": true,
          "modes": ["central"],
          "bluetoothAlwaysPermission": "Permitir a Sensor App conectarse a los sensores",
        }
      ]
    ],

    experiments: {
      typedRoutes: true,
      reactCompiler: true
    },

    extra: {
      eas: {
        projectId: "774c2479-0afa-410e-945b-9dba254d7924"
      }
    }
  };
};