/**
 * Sidebar + Layout for the admin dashboard.
 * Only renders meaningfully on web; on native we redirect to the player.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { colors, radius, spacing } from "@/src/theme";
import { useAdminSession } from "./session";

const NAV: { label: string; icon: any; route: string; testID: string }[] = [
  { label: "Dashboard", icon: "grid-outline", route: "/admin", testID: "nav-dashboard" },
  { label: "Screens", icon: "tv-outline", route: "/admin/screens", testID: "nav-screens" },
  { label: "Cabs", icon: "car-outline", route: "/admin/cabs", testID: "nav-cabs" },
  { label: "Areas", icon: "map-outline", route: "/admin/areas", testID: "nav-areas" },
  { label: "Media", icon: "images-outline", route: "/admin/media", testID: "nav-media" },
  { label: "Campaigns", icon: "megaphone-outline", route: "/admin/campaigns", testID: "nav-campaigns" },
  { label: "Playlists", icon: "list-outline", route: "/admin/playlists", testID: "nav-playlists" },
  { label: "Analytics", icon: "bar-chart-outline", route: "/admin/analytics", testID: "nav-analytics" },
  { label: "Audit Log", icon: "document-text-outline", route: "/admin/audit", testID: "nav-audit" },
  { label: "Settings", icon: "settings-outline", route: "/admin/settings", testID: "nav-settings" },
];

export function AdminLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, logout } = useAdminSession();

  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot}>
            <Ionicons name="play" size={18} color={colors.onSurfaceInverse} />
          </View>
          <View>
            <Text style={styles.brandName}>QwickAds</Text>
            <Text style={styles.brandSub}>Super Admin</Text>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }}>
          {NAV.map((item) => {
            const active = pathname === item.route || (item.route !== "/admin" && pathname?.startsWith(item.route));
            return (
              <Pressable
                key={item.route}
                testID={item.testID}
                onPress={() => router.replace(item.route as any)}
                style={[styles.navItem, active && styles.navItemActive]}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={active ? colors.brand : colors.onSurfaceTertiary}
                />
                <Text style={[styles.navText, active && styles.navTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.userBox}>
          <View>
            <Text style={styles.userEmail} numberOfLines={1}>
              {session?.user.email || ""}
            </Text>
            <Text style={styles.userRole}>{session?.user.role || ""}</Text>
          </View>
          <Pressable testID="admin-logout" onPress={logout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      </View>

      <View style={styles.main}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} testID="admin-page-title">
            {title}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surface,
  },
  sidebar: {
    width: 240,
    backgroundColor: colors.surfaceSecondary,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.lg,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  brandDot: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontWeight: "800", color: colors.onSurface, fontSize: 16 },
  brandSub: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  navItemActive: { backgroundColor: colors.brandSecondary },
  navText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: "500" },
  navTextActive: { color: colors.brand, fontWeight: "700" },
  userBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  userEmail: { fontSize: 12, fontWeight: "700", color: colors.onSurface, maxWidth: 140 },
  userRole: { fontSize: 10, color: colors.onSurfaceTertiary, textTransform: "uppercase", marginTop: 2 },
  logoutBtn: { padding: 6 },
  main: { flex: 1 },
  header: {
    height: 64,
    paddingHorizontal: spacing.xxl,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  content: {
    padding: spacing.xxl,
    gap: spacing.lg,
  },
});
