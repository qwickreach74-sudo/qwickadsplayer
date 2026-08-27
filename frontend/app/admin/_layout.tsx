import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { AdminSessionProvider, useAdminSession } from "@/src/admin/session";
import { colors } from "@/src/theme";

function Guard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAdminSession();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments.join("/") === "admin/login";
    if (!session && !onLogin) router.replace("/admin/login");
    if (session && onLogin) router.replace("/admin");
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function AdminRootLayout() {
  // Admin is web-only. On native devices (tablets running the player), we
  // never enter the admin tree because the root index router picks /register
  // or /player. If someone deep-links here on native, show a hint.
  if (Platform.OS !== "web") {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>QwickAds Super Admin is a web application.</Text>
      </View>
    );
  }
  return (
    <AdminSessionProvider>
      <Guard>
        <Stack screenOptions={{ headerShown: false }} />
      </Guard>
    </AdminSessionProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    padding: 32,
  },
  msg: { color: colors.onSurfaceTertiary, textAlign: "center" },
});
