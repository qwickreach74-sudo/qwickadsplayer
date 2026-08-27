import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAdminSession } from "@/src/admin/session";
import { Button, Field } from "@/src/admin/ui";
import { colors, radius, spacing } from "@/src/theme";

export default function AdminLogin() {
  const { login } = useAdminSession();
  const [email, setEmail] = useState("admin@qwickads.com");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="admin-login">
      <View style={styles.card}>
        <View style={styles.brand}>
          <View style={styles.dot}>
            <Ionicons name="play" size={22} color={colors.onSurfaceInverse} />
          </View>
          <Text style={styles.title}>QwickAds Super Admin</Text>
          <Text style={styles.sub}>Sign in to manage screens, campaigns and playlists</Text>
        </View>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="admin@qwickads.com"
          keyboardType="email-address"
          autoCapitalize="none"
          testID="login-email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secure
          error={err}
          testID="login-password"
        />
        <Button
          label="Sign in"
          onPress={submit}
          loading={busy}
          testID="login-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  brand: { alignItems: "center", marginBottom: spacing.xl },
  dot: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sub: {
    fontSize: 13,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    marginTop: 6,
  },
});
