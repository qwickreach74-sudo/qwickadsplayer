import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Card, Toast } from "@/src/admin/ui";
import { colors, spacing } from "@/src/theme";

type Settings = {
  heartbeat_interval_seconds: number;
  offline_threshold_seconds: number;
  registration_code_expiry_hours: number;
  default_ad_duration_seconds: number;
  playback_batch_size: number;
  playlist_poll_seconds: number;
  command_poll_seconds: number;
};

export default function SettingsPage() {
  const { session, changePassword, logout } = useAdminSession();
  const [values, setValues] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await adminRequest<Settings>(session, "/settings");
        setValues(s);
      } catch (e: any) {
        setNotice({ type: "error", msg: e.message });
      }
    })();
  }, [session]);

  const save = async () => {
    if (!values) return;
    setSaving(true);
    try {
      await adminRequest(session, "/settings", { method: "PUT", body: JSON.stringify(values) });
      setNotice({ type: "success", msg: "Settings saved" });
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    } finally {
      setSaving(false);
    }
  };

  const submitPwd = async () => {
    setPwdErr(null);
    if (pwd.next.length < 8) {
      setPwdErr("New password must be at least 8 characters");
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setPwdErr("Passwords do not match");
      return;
    }
    setPwdBusy(true);
    try {
      await changePassword(pwd.current, pwd.next);
      // logout was triggered inside changePassword because password_version rotated
    } catch (e: any) {
      setPwdErr(e.message);
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <AdminLayout title="Settings">
      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <View style={styles.row}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.section}>System Configuration</Text>
          <Text style={styles.help}>
            These values control Power Player behaviour. The player picks them up on its next sync.
          </Text>
          {values ? (
            <>
              <NumField label="Heartbeat interval (seconds)" value={values.heartbeat_interval_seconds} onChange={(v) => setValues({ ...values, heartbeat_interval_seconds: v })} />
              <NumField label="Offline threshold (seconds)" value={values.offline_threshold_seconds} onChange={(v) => setValues({ ...values, offline_threshold_seconds: v })} />
              <NumField label="Registration code expiry (hours)" value={values.registration_code_expiry_hours} onChange={(v) => setValues({ ...values, registration_code_expiry_hours: v })} />
              <NumField label="Default ad duration (seconds)" value={values.default_ad_duration_seconds} onChange={(v) => setValues({ ...values, default_ad_duration_seconds: v })} />
              <NumField label="Playback batch size" value={values.playback_batch_size} onChange={(v) => setValues({ ...values, playback_batch_size: v })} />
              <NumField label="Playlist poll (seconds)" value={values.playlist_poll_seconds} onChange={(v) => setValues({ ...values, playlist_poll_seconds: v })} />
              <NumField label="Command poll (seconds)" value={values.command_poll_seconds} onChange={(v) => setValues({ ...values, command_poll_seconds: v })} />
              <Button label="Save Settings" onPress={save} loading={saving} testID="settings-save" />
            </>
          ) : null}
        </Card>

        <Card style={{ flex: 1 }}>
          <Text style={styles.section}>Change Password</Text>
          <Text style={styles.help}>You will be signed out after a successful password change.</Text>
          <Field label="Current Password" value={pwd.current} onChangeText={(v) => setPwd({ ...pwd, current: v })} secure testID="pwd-current" />
          <Field label="New Password" value={pwd.next} onChangeText={(v) => setPwd({ ...pwd, next: v })} secure testID="pwd-new" />
          <Field label="Confirm New Password" value={pwd.confirm} onChangeText={(v) => setPwd({ ...pwd, confirm: v })} secure error={pwdErr} testID="pwd-confirm" />
          <Button label="Update Password" onPress={submitPwd} loading={pwdBusy} testID="pwd-submit" />
        </Card>
      </View>
    </AdminLayout>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field
      label={label}
      value={String(value ?? "")}
      onChangeText={(v) => onChange(Number(v) || 0)}
      keyboardType="numeric"
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" },
  section: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginBottom: 6 },
  help: { color: colors.onSurfaceTertiary, fontSize: 12, marginBottom: spacing.md, lineHeight: 18 },
});
