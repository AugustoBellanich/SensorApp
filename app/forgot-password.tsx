import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "../constants/Colors";
import { GlobalStyles } from "../constants/GlobalStyles";
import { requestPasswordReset } from "../services/authService";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!email)
      return Alert.alert("Error", "Por favor ingresa tu correo electrónico.");

    setLoading(true);
    try {
      await requestPasswordReset(email);
      Alert.alert(
        "Éxito",
        "Si el correo está registrado, recibirás instrucciones para recuperar tu contraseña.",
      );
      router.back(); // Volver al login
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.message || "No se pudo procesar la solicitud.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.content}
      >
        <Text style={GlobalStyles.title}>Recuperar Contraseña</Text>
        <Text style={styles.description}>
          Ingresa tu correo electrónico para recibir un enlace de recuperación.
        </Text>

        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="usuario@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <TouchableOpacity
          style={[GlobalStyles.primaryButton, loading && { opacity: 0.7 }]}
          onPress={handleReset}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={GlobalStyles.buttonText}>ENVIAR CORREO</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={{ marginTop: 20 }}
          onPress={() => router.back()}
        >
          <Text style={styles.cancelText}>Cancelar</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background || "#f2f2f2" },
  content: { flex: 1, padding: 40, justifyContent: "center" },
  description: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
    textAlign: "center",
  },
  inputWrapper: { marginBottom: 20 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  cancelText: {
    color: Colors.textSecondary,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "bold",
  },
});
