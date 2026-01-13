export default ({ config }) => {
  const isTest = process.env.APP_VARIANT === 'test';

  return {
    ...config,
    name: isTest ? "SENSOR APP (TEST)" : "SENSOR APP",
    slug: "SensorApp",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "sensorapp",
    userInterfaceStyle: "light",
    newArchEnabled: true,

    // Configuración Global (iOS y Default)
    splash: {
      image: "./assets/images/isologotipo_light.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },

    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#ffffff"
      },
      package: isTest ? "com.bellanich.sensor.test" : "com.inta.sensorapp",
      versionCode: 1,
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      
      // --- CORRECCIÓN AQUÍ: Forzar Splash en Android ---
      splash: {
        image: "./assets/images/isologotipo_light.png",
        resizeMode: "contain", // Asegura que entre toda la imagen
        backgroundColor: "#ffffff",
        // dark: { ... } // Opcional si tienes modo oscuro
      },
      // -----------------------------------------------

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
      // Plugin Splash Screen: Quitamos 'imageWidth' fijo para dejar que 'contain' haga su trabajo
      [
        "expo-splash-screen",
        {
          "backgroundColor": "#ffffff",
          "image": "./assets/images/isologotipo_light.png",
          "resizeMode": "contain",
          "imageWidth": 180 // Un valor seguro si el automático falla
        }
      ],
      [
        "expo-build-properties",
        {
          "android": {
            "enableProguardInReleaseBuilds": false,
            "extraProguardRules": "-keep class com.polidea.reactnativeble.** { *; } -keep class com.rxandroidble2.** { *; }"
          }
        }
      ],
      [
        "@config-plugins/react-native-ble-plx",
        {
          "isBackgroundEnabled": false,
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