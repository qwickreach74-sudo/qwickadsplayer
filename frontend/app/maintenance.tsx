import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/services/api";
import {
  loadScreenIdentity,
  clearScreenIdentity,
  type ScreenIdentity,
} from "@/src/services/secure-storage";
import { mediaCache, playlistStore } from "@/src/services/media-cache";
import { playbackQueue } from "@/src/services/playback-queue";

const MAINTENANCE_PIN = "1234";

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

export default function MaintenanceScreen() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const [identity, setIdentity] = useState<ScreenIdentity | null>(null);
  const [status, setStatus] = useState<"online" | "offline" | "unknown">("unknown");
  const [lastSync, setLastSync] = useState<string>("—");
  const [playlistVersion, setPlaylistVersion] = useState<number>(0);
  const [playlistCount, setPlaylistCount] = useState<number>(0);
  const [storageBytes, setStorageBytes] = useState<number>(0);
  const [queueSize, setQueueSize] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const id = await loadScreenIdentity();
    setIdentity(id);
    const pl = await playlistStore.load();
    if (pl) {
      setPlaylistVersion(pl.playlist_version);
      setPlaylistCount(pl.advertisements.length);
      setLastSync(new Date(pl.saved_at).toLocaleString());
    }
    setStorageBytes(await mediaCache.totalBytes());
    setQueueSize(await playbackQueue.size());
    try {
      await api.health();
      setStatus("online");
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    if (unlocked) loadAll();
  }, [unlocked, loadAll]);

  const submitPin = () => {
    if (pin === MAINTENANCE_PIN) {
      setUnlocked(true);
      setPinError(null);
    } else {
      setPinError("Incorrect PIN");
    }
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (err: any) {
      setNotice(`Failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const doSync = () =>
    withBusy("Sync Now", async () => {
      if (!identity) throw new Error("Not registered");
      const pl = await api.getPlaylist(identity.screen_id, identity.screen_token);
      await mediaCache.prefetchAll(pl.advertisements);
      await playlistStore.save({
        playlist_version: pl.playlist_version,
        advertisements: pl.advertisements,
        saved_at: new Date().toISOString(),
      });
      await playbackQueue.flush(identity.screen_id, identity.screen_token);
      await loadAll();
      setNotice("Playlist synced successfully");
    });

  const doClearCache = () =>
    withBusy("Clear Cache", async () => {
      await mediaCache.clearAll();
      await loadAll();
      setNotice("Local media cache cleared");
    });

  const doReconnect = () =>
    withBusy("Reconnect", async () => {
      await api.health();
      setStatus("online");
      setNotice("Backend reachable");
    });

  const doExit = () =>
    withBusy("Exit Player", async () => {
      // Return the operator to the player. Full app-exit requires kiosk
      // device-owner privileges which we don't have from a normal app.
      router.replace("/player");
    });

  const doUnregister = () =>
    withBusy("Unregister", async () => {
      await clearScreenIdentity();
      await mediaCache.clearAll();
      await playbackQueue.clear();
      router.replace("/register");
    });

  // -------------------------------------------------------------------
  // PIN gate
  // -------------------------------------------------------------------
  if (!unlocked) {
    return (
      <View style={styles.container} testID="pin-gate">
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.brandDot}>
              <Ionicons name="lock-closed" size={22} color={colors.onSurfaceInverse} />
            </View>
            <View>
              <Text style={styles.title}>Maintenance</Text>
              <Text style={styles.subtitle}>Enter PIN to continue</Text>
            </View>
          </View>
          <TextInput
            testID="maintenance-pin-input"
            style={[styles.input, pinError ? styles.inputError : null]}
            value={pin}
            onChangeText={(t) => {
              setPin(t);
              if (pinError) setPinError(null);
            }}
            placeholder="PIN"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />
          {pinError ? (
            <Text style={styles.errorText} testID="pin-error">
              {pinError}
            </Text>
          ) : null}
          <View style={styles.pinButtons}>
            <Pressable
              testID="pin-cancel-button"
              style={styles.secondaryBtn}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="pin-submit-button"
              style={styles.primaryBtn}
              onPress={submitPin}
            >
              <Text style={styles.primaryBtnText}>Unlock</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------
  return (
    <View style={styles.container} testID="maintenance-dashboard">
      <View style={styles.dashHeader}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot}>
            <Ionicons name="construct" size={20} color={colors.onSurfaceInverse} />
          </View>
          <View>
            <Text style={styles.title}>Maintenance Mode</Text>
            <Text style={styles.subtitle}>
              {identity?.screen_id ?? "Unregistered"}
            </Text>
          </View>
        </View>
        <Pressable
          testID="close-maintenance-button"
          style={styles.closeBtn}
          onPress={() => router.replace("/player")}
        >
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Device</Text>
            <InfoRow label="Screen ID" value={identity?.screen_id ?? "—"} testID="info-screen-id" />
            <InfoRow label="Cab Number" value={identity?.cab_number ?? "—"} />
            <InfoRow label="Area" value={identity?.area ?? "—"} />
            <InfoRow label="App Version" value={Constants.expoConfig?.version ?? "1.0.0"} />
            <InfoRow label="Platform" value={`${Platform.OS} ${Platform.Version ?? ""}`} />

            <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Sync</Text>
            <InfoRow
              label="Status"
              value={status.toUpperCase()}
              valueColor={
                status === "online"
                  ? colors.success
                  : status === "offline"
                  ? colors.error
                  : colors.onSurfaceTertiary
              }
              testID="info-status"
            />
            <InfoRow label="Last Sync" value={lastSync} />
            <InfoRow label="Playlist Version" value={String(playlistVersion)} />
            <InfoRow label="Items in Playlist" value={String(playlistCount)} />
            <InfoRow label="Storage Used" value={formatBytes(storageBytes)} />
            <InfoRow label="Pending Reports" value={String(queueSize)} />
          </View>

          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Actions</Text>
            <ActionBtn
              testID="action-sync"
              label="Sync Now"
              icon="refresh"
              onPress={doSync}
              loading={busy === "Sync Now"}
            />
            <ActionBtn
              testID="action-reconnect"
              label="Reconnect"
              icon="wifi"
              onPress={doReconnect}
              loading={busy === "Reconnect"}
            />
            <ActionBtn
              testID="action-clear-cache"
              label="Clear Cache"
              icon="trash"
              onPress={doClearCache}
              loading={busy === "Clear Cache"}
              destructive
            />
            <ActionBtn
              testID="action-unregister"
              label="Unregister Screen"
              icon="log-out"
              onPress={doUnregister}
              loading={busy === "Unregister"}
              destructive
            />
            <ActionBtn
              testID="action-exit"
              label="Return to Player"
              icon="play"
              onPress={doExit}
              loading={busy === "Exit Player"}
            />
            {notice ? (
              <Text style={styles.notice} testID="maintenance-notice">
                {notice}
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({
  label,
  value,
  valueColor,
  testID,
}: {
  label: string;
  value: string;
  valueColor?: string;
  testID?: string;
}) {
  return (
    <View style={styles.infoRow} testID={testID}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

function ActionBtn({
  label,
  icon,
  onPress,
  destructive,
  loading,
  testID,
}: {
  label: string;
  icon: any;
  onPress: () => void;
  destructive?: boolean;
  loading?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.actionBtn,
        destructive ? styles.actionBtnDestructive : null,
        (pressed || loading) && { opacity: 0.7 },
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={destructive ? colors.error : colors.brand}
      />
      <Text
        style={[
          styles.actionBtnText,
          destructive ? { color: colors.error } : null,
        ]}
      >
        {label}
      </Text>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={destructive ? colors.error : colors.brand}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  card: {
    alignSelf: "center",
    marginTop: spacing.xxxl,
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  brandDot: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  subtitle: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: "center",
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
  },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  pinButtons: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600" },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.brand,
  },
  primaryBtnText: { color: colors.onSurfaceInverse, fontWeight: "700" },
  dashHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: { paddingBottom: spacing.xxxl },
  row: { flexDirection: "row", gap: spacing.xl },
  col: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.onSurfaceTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { color: colors.onSurfaceTertiary, fontSize: 13 },
  infoValue: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    backgroundColor: colors.brandSecondary,
    marginBottom: spacing.md,
  },
  actionBtnDestructive: {
    borderColor: colors.error,
    backgroundColor: colors.surfaceSecondary,
  },
  actionBtnText: {
    color: colors.brand,
    fontWeight: "700",
    fontSize: 14,
    flex: 1,
  },
  notice: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.info,
  },
});
