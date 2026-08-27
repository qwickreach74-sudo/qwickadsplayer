import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Sheet, Toast, ConfirmDialog } from "@/src/admin/ui";
import { DataTable, Pill } from "@/src/admin/table";
import { colors, spacing, radius } from "@/src/theme";

type Screen = {
  screen_id: string;
  cab_id?: string;
  cab_number?: string;
  driver_name?: string;
  area_id?: string;
  area_name?: string;
  status: "online" | "offline" | "never_connected";
  seconds_since_seen?: number;
  last_seen?: string;
  playlist_version: number;
  app_version?: string;
  device_model?: string;
  current_ad_id?: string;
  disabled?: boolean;
};

type Cab = { cab_id: string; cab_number: string; area_id?: string; screen_id?: string };
type Area = { area_id: string; name: string };

type RegCode = {
  registration_code: string;
  cab_id?: string;
  area_id?: string;
  expires_at?: string;
  status: "pending" | "used" | "expired";
  created_at: string;
  used_by?: string;
};

const COMMANDS: { label: string; command: string; destructive?: boolean }[] = [
  { label: "Sync Now", command: "SYNC_PLAYLIST" },
  { label: "Reconnect", command: "RECONNECT" },
  { label: "Clear Cache", command: "CLEAR_CACHE", destructive: true },
  { label: "Restart Player", command: "RESTART_PLAYER", destructive: true },
];

export default function ScreensPage() {
  const { session } = useAdminSession();
  const [rows, setRows] = useState<Screen[]>([]);
  const [codes, setCodes] = useState<RegCode[]>([]);
  const [cabs, setCabs] = useState<Cab[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const [showRegSheet, setShowRegSheet] = useState(false);
  const [regForm, setRegForm] = useState({ cab_id: "", area_id: "" });
  const [regBusy, setRegBusy] = useState(false);
  const [regResult, setRegResult] = useState<{ code: string; expires_at?: string } | null>(null);

  const [showCommandsFor, setShowCommandsFor] = useState<Screen | null>(null);
  const [unregistering, setUnregistering] = useState<Screen | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, c, a] = await Promise.all([
        adminRequest<{ screens: Screen[] }>(session, "/screens"),
        adminRequest<{ registration_codes: RegCode[] }>(session, "/screens/registration-codes/list"),
        adminRequest<{ cabs: Cab[] }>(session, "/cabs"),
        adminRequest<{ areas: Area[] }>(session, "/areas"),
      ]);
      setRows(s.screens);
      setCodes(r.registration_codes);
      setCabs(c.cabs);
      setAreas(a.areas);
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const genCode = async () => {
    setRegBusy(true);
    setRegResult(null);
    try {
      const payload: any = {};
      if (regForm.cab_id) payload.cab_id = regForm.cab_id;
      if (regForm.area_id) payload.area_id = regForm.area_id;
      const res = await adminRequest<{ registration_code: string; expires_at?: string }>(
        session,
        "/screens/registration-codes",
        { method: "POST", body: JSON.stringify(payload) }
      );
      setRegResult({ code: res.registration_code, expires_at: res.expires_at });
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    } finally {
      setRegBusy(false);
    }
  };

  const sendCommand = async (screen: Screen, command: string) => {
    try {
      await adminRequest(session, `/screens/${screen.screen_id}/commands`, {
        method: "POST",
        body: JSON.stringify({ command }),
      });
      setNotice({ type: "success", msg: `Command ${command} queued for ${screen.screen_id}` });
      setShowCommandsFor(null);
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    }
  };

  const unregister = async () => {
    if (!unregistering) return;
    try {
      await adminRequest(session, `/screens/${unregistering.screen_id}/unregister`, { method: "POST" });
      setNotice({
        type: "success",
        msg: `${unregistering.screen_id} unregistered. The physical tablet must re-register with a new code before it can operate again.`,
      });
      setUnregistering(null);
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
      setUnregistering(null);
    }
  };

  const copyCode = async (code: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        setNotice({ type: "success", msg: "Code copied to clipboard" });
      }
    } catch {}
  };

  return (
    <AdminLayout title="Screens">
      <View style={styles.head}>
        <Text style={styles.headSub}>
          Physical tablets registered to QwickAds Power. Each screen is permanently associated with its
          screen ID until unregistered.
        </Text>
        <Button
          label="Generate Registration Code"
          icon="qr-code-outline"
          onPress={() => {
            setRegResult(null);
            setRegForm({ cab_id: "", area_id: "" });
            setShowRegSheet(true);
          }}
          testID="generate-reg-code-btn"
        />
      </View>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <Text style={styles.section}>Registered Screens</Text>
      <DataTable<Screen>
        rows={rows}
        keyField="screen_id"
        loading={loading}
        searchFields={["screen_id", "cab_number", "area_name", "driver_name"]}
        testID="screens-table"
        empty={{
          title: "No screens registered yet",
          message: "Generate a registration code and enter it on a QwickAds Power tablet.",
        }}
        columns={[
          { key: "screen_id", header: "Screen ID", render: (r) => r.screen_id, width: 140 },
          {
            key: "status",
            header: "Status",
            width: 130,
            render: (r) => (
              <Pill
                label={
                  r.disabled
                    ? "Disabled"
                    : r.status === "online"
                    ? "Online"
                    : r.status === "offline"
                    ? "Offline"
                    : "Never Connected"
                }
                tone={
                  r.disabled
                    ? "error"
                    : r.status === "online"
                    ? "success"
                    : r.status === "offline"
                    ? "error"
                    : "warning"
                }
                testID={`screen-status-${r.screen_id}`}
              />
            ),
          },
          { key: "cab", header: "Cab", render: (r) => r.cab_number || "—", flex: 1 },
          { key: "area", header: "Area", render: (r) => r.area_name || "—", flex: 1 },
          { key: "pv", header: "PL Ver.", render: (r) => String(r.playlist_version), width: 80 },
          { key: "app", header: "App Ver.", render: (r) => r.app_version || "—", width: 90 },
          {
            key: "last_seen",
            header: "Last Seen",
            render: (r) => (r.last_seen ? new Date(r.last_seen).toLocaleString() : "Never"),
            flex: 1,
          },
          {
            key: "actions",
            header: "",
            width: 260,
            render: (r) => (
              <View style={styles.actions}>
                <Button
                  label="Commands"
                  variant="secondary"
                  size="sm"
                  onPress={() => setShowCommandsFor(r)}
                  testID={`commands-${r.screen_id}`}
                />
                <Button
                  label="Unregister"
                  variant="ghost"
                  size="sm"
                  onPress={() => setUnregistering(r)}
                  testID={`unregister-${r.screen_id}`}
                />
              </View>
            ),
          },
        ]}
      />

      <Text style={[styles.section, { marginTop: spacing.xl }]}>Registration Codes</Text>
      <DataTable<RegCode>
        rows={codes}
        keyField="registration_code"
        loading={loading}
        searchable={false}
        testID="codes-table"
        empty={{
          title: "No registration codes",
          message: "Generate a code above to onboard a new tablet.",
        }}
        columns={[
          {
            key: "code",
            header: "Code",
            width: 160,
            render: (r) => (
              <Pressable onPress={() => copyCode(r.registration_code)}>
                <Text style={styles.codeText}>{r.registration_code}</Text>
              </Pressable>
            ),
          },
          {
            key: "status",
            header: "Status",
            width: 110,
            render: (r) => (
              <Pill
                label={r.status}
                tone={r.status === "used" ? "success" : r.status === "expired" ? "error" : "info"}
                testID={`code-status-${r.registration_code}`}
              />
            ),
          },
          { key: "expires", header: "Expires", render: (r) => (r.expires_at ? new Date(r.expires_at).toLocaleString() : "—"), flex: 1 },
          { key: "used_by", header: "Used By", render: (r) => r.used_by || "—", flex: 1 },
          { key: "created", header: "Created", render: (r) => new Date(r.created_at).toLocaleString(), flex: 1 },
        ]}
      />

      {/* Generate registration code */}
      <Sheet
        visible={showRegSheet}
        onClose={() => setShowRegSheet(false)}
        title="Generate Registration Code"
        testID="reg-code-sheet"
      >
        {regResult ? (
          <View>
            <Text style={styles.helper}>
              Enter this code on the QwickAds Power tablet to complete registration.
            </Text>
            <Pressable onPress={() => copyCode(regResult.code)} style={styles.codeCard} testID="reg-code-value">
              <Text style={styles.codeBig}>{regResult.code}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.brand} />
            </Pressable>
            {regResult.expires_at ? (
              <Text style={styles.expiresText}>
                Expires {new Date(regResult.expires_at).toLocaleString()}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.lg }}>
              <Button label="Close" onPress={() => setShowRegSheet(false)} testID="reg-code-close" />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.helper}>
              Optionally pre-associate this code with a cab and area. The tablet will inherit these when it registers.
            </Text>
            <Text style={styles.pickerLabel}>Cab</Text>
            <View style={styles.pickerWrap}>
              <Chip label="— None —" active={!regForm.cab_id} onPress={() => setRegForm({ ...regForm, cab_id: "" })} />
              {cabs.map((c) => (
                <Chip
                  key={c.cab_id}
                  label={c.cab_number + (c.screen_id ? "  (has screen)" : "")}
                  active={regForm.cab_id === c.cab_id}
                  onPress={() =>
                    setRegForm({ ...regForm, cab_id: c.cab_id, area_id: c.area_id || regForm.area_id })
                  }
                />
              ))}
            </View>
            <Text style={styles.pickerLabel}>Area (auto-filled from cab)</Text>
            <View style={styles.pickerWrap}>
              <Chip label="— None —" active={!regForm.area_id} onPress={() => setRegForm({ ...regForm, area_id: "" })} />
              {areas.map((a) => (
                <Chip
                  key={a.area_id}
                  label={a.name}
                  active={regForm.area_id === a.area_id}
                  onPress={() => setRegForm({ ...regForm, area_id: a.area_id })}
                />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.md }}>
              <Button label="Cancel" variant="ghost" onPress={() => setShowRegSheet(false)} />
              <Button label="Generate Code" onPress={genCode} loading={regBusy} testID="reg-code-generate" />
            </View>
          </>
        )}
      </Sheet>

      {/* Commands */}
      <Sheet
        visible={!!showCommandsFor}
        onClose={() => setShowCommandsFor(null)}
        title={`Commands · ${showCommandsFor?.screen_id ?? ""}`}
        width={420}
        testID="commands-sheet"
      >
        <Text style={styles.helper}>Send a remote command to this screen. It will be delivered on the next poll.</Text>
        <View style={{ gap: spacing.sm }}>
          {COMMANDS.map((c) => (
            <Button
              key={c.command}
              label={c.label}
              icon={c.destructive ? "warning-outline" : "flash-outline"}
              variant={c.destructive ? "destructive" : "secondary"}
              onPress={() => showCommandsFor && sendCommand(showCommandsFor, c.command)}
              testID={`cmd-${c.command}`}
            />
          ))}
        </View>
      </Sheet>

      {/* Unregister */}
      <ConfirmDialog
        visible={!!unregistering}
        onCancel={() => setUnregistering(null)}
        onConfirm={unregister}
        title="Unregister Screen"
        message={`This will invalidate the screen token for ${unregistering?.screen_id}. The physical tablet will require a new registration code before it can play ads again.`}
        confirmLabel="Unregister"
        destructive
      />
    </AdminLayout>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, flexWrap: "wrap" },
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13, maxWidth: 640 },
  section: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, marginBottom: 6 },
  actions: { flexDirection: "row", gap: spacing.sm },
  codeText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  helper: { color: colors.onSurfaceTertiary, fontSize: 13, marginBottom: spacing.md, lineHeight: 20 },
  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  codeBig: { color: colors.brand, fontWeight: "800", fontSize: 28, letterSpacing: 3 },
  expiresText: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: spacing.sm },
  pickerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginBottom: 6,
    marginTop: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.md },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surfaceTertiary,
  },
  chipActive: { backgroundColor: colors.brandSecondary, borderColor: colors.brand },
  chipText: { fontSize: 12, color: colors.onSurfaceTertiary },
  chipTextActive: { color: colors.brand, fontWeight: "700" },
});
