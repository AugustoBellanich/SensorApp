// app/_layout.tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* El nombre debe coincidir con el nombre del archivo/carpeta */}
        <Stack.Screen name="index" /> 
        <Stack.Screen name="home/index" /> 
        {/* La carpeta sensor/[id] todavía no la creamos, así que no la pongas aún o dará error */}
      </Stack>
    </>
  );
}