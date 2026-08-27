import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Sheet, Toast, ConfirmDialog } from "@/src/admin/ui";
import { DataTable, Pill } from "@/src/admin/table";
import { colors, spacing, radius } from "@/src/theme";

type Cab = {
  cab_id: string;
  cab_number: string;
  driver_name?: string;
  driver_mobile?: string;
  area_id?: string;
  area_name?: string;
  screen_id?: string;
  monthly_payment?: number;
  notes?: string;
  active: boolean;
};

type Area = { area_id: string; name: string };

export default function CabsPage() {
  const { session } = useAdminSession();
  const [rows, setRows] = useState<Cab[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [editing, setEditing] = useState<Cab | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    cab_number: "",
    driver_name: "",
    driver_mobile: "",
    area_id: "",
    monthly_payment: "0",
    notes: "",
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Cab | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([
        adminRequest<{ cabs: Cab[] }>(session, "/cabs"),
        adminRequest<{ areas: Area[] }>(session, "/areas"),
      ]);
      setRows(c.cabs);
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

  const openCreate = () => {
    setEditing(null);
    setForm({
      cab_number: "",
      driver_name: "",
      driver_mobile: "",
      area_id: "",
      monthly_payment: "0",
      notes: "",
      active: true,
    });
    setOpen(true);
  };

  const openEdit = (r: Cab) => {
    setEditing(r);
    setForm({
      cab_number: r.cab_number,
      driver_name: r.driver_name || "",
      driver_mobile: r.driver_mobile || "",
      area_id: r.area_id || "",
      monthly_payment: String(r.monthly_payment ?? 0),
      notes: r.notes || "",
      active: r.active,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        cab_number: form.cab_number,
        driver_name: form.driver_name || null,
        driver_mobile: form.driver_mobile || null,
        area_id: form.area_id || null,
        monthly_payment: Number(form.monthly_payment) || 0,
        notes: form.notes || null,
        active: form.active,
      };
      if (editing) {
        await adminRequest(session, `/cabs/${editing.cab_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice({ type: "success", msg: "Cab updated" });
      } else {
        await adminRequest(session, "/cabs", { method: "POST", body: JSON.stringify(payload) });
        setNotice({ type: "success", msg: "Cab created" });
      }
      setOpen(false);
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await adminRequest(session, `/cabs/${deleting.cab_id}`, { method: "DELETE" });
      setNotice({ type: "success", msg: "Cab deactivated" });
      setDeleting(null);
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
      setDeleting(null);
    }
  };

  const areaOptions = useMemo(() => [{ area_id: "", name: "— None —" }, ...areas], [areas]);

  return (
    <AdminLayout title="Cabs">
      <View style={styles.head}>
        <Text style={styles.headSub}>Vehicles that carry a QwickAds Power screen.</Text>
        <Button label="Add Cab" icon="add" onPress={openCreate} testID="add-cab-btn" />
      </View>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <DataTable<Cab>
        rows={rows}
        keyField="cab_id"
        loading={loading}
        searchFields={["cab_number", "driver_name", "area_name"]}
        testID="cabs-table"
        empty={{
          title: "No cabs yet",
          message: "Add your first cab to associate it with a driver, area, and screen.",
          cta: <Button label="Add Cab" icon="add" onPress={openCreate} />,
        }}
        columns={[
          { key: "cab_number", header: "Cab Number", render: (r) => r.cab_number, flex: 1 },
          { key: "driver", header: "Driver", render: (r) => r.driver_name || "—", flex: 1 },
          { key: "mobile", header: "Mobile", render: (r) => r.driver_mobile || "—", flex: 1 },
          { key: "area", header: "Area", render: (r) => r.area_name || "—", flex: 1 },
          {
            key: "screen",
            header: "Screen",
            render: (r) => (r.screen_id ? <Pill label={r.screen_id} tone="info" /> : <Pill label="Unassigned" />),
            width: 160,
          },
          {
            key: "status",
            header: "Status",
            render: (r) => <Pill label={r.active ? "Active" : "Inactive"} tone={r.active ? "success" : "neutral"} />,
            width: 100,
          },
          {
            key: "actions",
            header: "",
            width: 180,
            render: (r) => (
              <View style={styles.actions}>
                <Button label="Edit" variant="secondary" size="sm" onPress={() => openEdit(r)} testID={`edit-${r.cab_id}`} />
                <Button label="Delete" variant="ghost" size="sm" onPress={() => setDeleting(r)} testID={`delete-${r.cab_id}`} />
              </View>
            ),
          },
        ]}
      />

      <Sheet visible={open} onClose={() => setOpen(false)} title={editing ? "Edit Cab" : "New Cab"} testID="cab-sheet">
        <Field label="Cab Number" value={form.cab_number} onChangeText={(v) => setForm({ ...form, cab_number: v })} testID="cab-number" />
        <Field label="Driver Name" value={form.driver_name} onChangeText={(v) => setForm({ ...form, driver_name: v })} testID="cab-driver-name" />
        <Field label="Driver Mobile" value={form.driver_mobile} onChangeText={(v) => setForm({ ...form, driver_mobile: v })} keyboardType="phone-pad" testID="cab-driver-mobile" />
        <Text style={styles.pickerLabel}>Area</Text>
        <View style={styles.pickerWrap}>
          {areaOptions.map((a) => (
            <Pressable
              key={a.area_id || "none"}
              onPress={() => setForm({ ...form, area_id: a.area_id })}
              style={[styles.chip, form.area_id === a.area_id && styles.chipActive]}
              testID={`area-chip-${a.area_id || "none"}`}
            >
              <Text style={[styles.chipText, form.area_id === a.area_id && styles.chipTextActive]}>
                {a.name}
              </Text>
            </Pressable>
          ))}
        </View>
        <Field label="Monthly Payment (₹)" value={form.monthly_payment} onChangeText={(v) => setForm({ ...form, monthly_payment: v })} keyboardType="numeric" />
        <Field label="Notes" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline />
        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.md }}>
          <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
          <Button label={editing ? "Save Changes" : "Create Cab"} onPress={save} loading={saving} testID="cab-save" />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title="Deactivate Cab"
        message={`Deactivate cab ${deleting?.cab_number}? Playback history and its screen registration will be preserved.`}
        confirmLabel="Deactivate"
        destructive
      />
    </AdminLayout>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13 },
  actions: { flexDirection: "row", gap: spacing.sm },
  pickerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginBottom: 6,
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
