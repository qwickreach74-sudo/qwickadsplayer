import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/services/api";
import { saveScreenIdentity } from "@/src/services/secure-storage";

export default function RegisterScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{
    screen_id: string;
    cab_number?: string | null;
    area?: string | null;
  } | null>(null);

  const handleActivate = useCallback(async () => {
    setError(null);
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter a registration code");
      return;
    }
    setLoading(true);
    try {
      const res = await api.registerScreen(trimmed, {
        device_model: Platform.OS === "android" ? "Android" : Platform.OS,
        android_version: String(Platform.Version ?? ""),
        app_version: Constants.expoConfig?.version ?? "1.0.0",
      });
      await saveScreenIdentity({
        screen_id: res.screen_id,
        screen_token: res.screen_token,
        cab_number: res.cab_number ?? null,
        area: res.area ?? null,
      });
      setSuccess({
        screen_id: res.screen_id,
        cab_number: res.cab_number,
        area: res.area,
      });
    } catch (err: any) {
      const msg = String(err?.message || "Registration failed").replace(
        /^Error:\s*/,
        ""
      );
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [code]);

  const enterPlayer = useCallback(() => {
    router.replace("/player");
  }, [router]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      testID="register-screen"
    >
      <View style={styles.card} testID="register-card">
        <View style={styles.brandRow}>
          <View style={styles.brandDot}>
            <Ionicons name="play" size={22} color={colors.onSurfaceInverse} />
          </View>
          <View>
            <Text style={styles.brandTitle}>QwickAds Power</Text>
            <Text style={styles.brandSub}>Digital Signage Player</Text>
          </View>
        </View>

        {success ? (
          <View testID="registration-success">
            <View style={styles.successBadge}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.successTitle}>Screen activated</Text>
            </View>
            <Text style={styles.subheading}>
              Note your Screen ID. Publish a playlist to this exact screen from the
              QwickAds Super Admin panel.
            </Text>
            <View style={styles.idBox} testID="assigned-screen-id">
              <Text style={styles.idLabel}>SCREEN ID</Text>
              <Text style={styles.idValue}>{success.screen_id}</Text>
              {success.cab_number ? (
                <Text style={styles.idSub}>
                  {success.cab_number}
                  {success.area ? ` · ${success.area}` : ""}
                </Text>
              ) : null}
            </View>
            <Pressable
              testID="continue-to-player-button"
              onPress={enterPlayer}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryBtnText}>Continue to Player</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.heading}>Connect this screen</Text>
            <Text style={styles.subheading}>
              Enter the registration code from your QwickAds account to activate
              this display.
            </Text>

            <Text style={styles.label}>Registration Code</Text>
            <TextInput
              testID="registration-code-input"
              style={[styles.input, error ? styles.inputError : null]}
              value={code}
              onChangeText={(t) => {
                setCode(t);
                if (error) setError(null);
              }}
              placeholder="REG-XXXXXX"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!loading}
            />
            {error ? (
              <Text style={styles.errorText} testID="register-error">
                {error}
              </Text>
            ) : null}

            <Pressable
              testID="activate-screen-button"
              onPress={handleActivate}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || loading) && styles.primaryBtnPressed,
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.onSurfaceInverse} />
              ) : (
                <Text style={styles.primaryBtnText}>Activate Screen</Text>
              )}
            </Pressable>

            <Text style={styles.footerHint}>
              Codes are generated by your QwickAds Super Admin panel.
            </Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  brandDot: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.onSurface,
  },
  brandSub: {
    fontSize: 12,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontSize: 14,
    color: colors.onSurfaceTertiary,
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  primaryBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnPressed: {
    opacity: 0.85,
  },
  primaryBtnText: {
    color: colors.onSurfaceInverse,
    fontSize: 16,
    fontWeight: "700",
  },
  footerHint: {
    marginTop: spacing.lg,
    fontSize: 12,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
  },
  successBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onSurface,
  },
  idBox: {
    marginVertical: spacing.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
  },
  idLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brand,
    letterSpacing: 1,
  },
  idValue: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.brand,
    letterSpacing: 3,
    marginTop: 6,
  },
  idSub: {
    fontSize: 12,
    color: colors.onSurfaceTertiary,
    marginTop: 6,
  },
});
