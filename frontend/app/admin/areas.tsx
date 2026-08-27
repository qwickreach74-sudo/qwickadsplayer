import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Sheet, Toast, ConfirmDialog } from "@/src/admin/ui";
import { DataTable, Pill } from "@/src/admin/table";
import { colors, spacing } from "@/src/theme";

type Area = {
  area_id: string;
  name: string;
  description?: string;
  city?: string;
  state?: string;
  active: boolean;
  cab_count?: number;
  screen_count?: number;
  created_at: string;
};

export default function AreasPage() {
  const { session } = useAdminSession();
  const [rows, setRows] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [editing, setEditing] = useState<Area | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", city: "", state: "", active: true });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Area | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequest<{ areas: Area[] }>(session, "/areas");
      setRows(res.areas);
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
    setForm({ name: "", description: "", city: "", state: "", active: true });
    setCreating(true);
  };

  const openEdit = (row: Area) => {
    setEditing(row);
    setForm({
      name: row.name,
      description: row.description || "",
      city: row.city || "",
      state: row.state || "",
      active: row.active,
    });
    setCreating(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, active: form.active };
      if (editing) {
        await adminRequest(session, `/areas/${editing.area_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice({ type: "success", msg: "Area updated" });
      } else {
        await adminRequest(session, "/areas", { method: "POST", body: JSON.stringify(payload) });
        setNotice({ type: "success", msg: "Area created" });
      }
      setCreating(false);
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
      await adminRequest(session, `/areas/${deleting.area_id}`, { method: "DELETE" });
      setNotice({ type: "success", msg: "Area deleted" });
      setDeleting(null);
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
      setDeleting(null);
    }
  };

  return (
    <AdminLayout title="Areas">
      <View style={styles.head}>
        <Text style={styles.headSub}>Group cabs and screens by city or region.</Text>
        <Button label="Add Area" icon="add" onPress={openCreate} testID="add-area-btn" />
      </View>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <DataTable<Area>
        rows={rows}
        keyField="area_id"
        loading={loading}
        searchFields={["name", "city", "state"]}
        testID="areas-table"
        empty={{
          title: "No areas yet",
          message: "Create your first operating area to start assigning cabs and screens.",
          cta: <Button label="Add Area" icon="add" onPress={openCreate} />,
        }}
        columns={[
          { key: "name", header: "Name", flex: 2, render: (r) => r.name },
          { key: "city", header: "City", render: (r) => r.city || "—" },
          { key: "state", header: "State", render: (r) => r.state || "—" },
          {
            key: "cabs",
            header: "Cabs",
            render: (r) => <Text style={styles.num}>{r.cab_count ?? 0}</Text>,
            width: 80,
          },
          {
            key: "screens",
            header: "Screens",
            render: (r) => <Text style={styles.num}>{r.screen_count ?? 0}</Text>,
            width: 90,
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
                <Button label="Edit" variant="secondary" size="sm" onPress={() => openEdit(r)} testID={`edit-${r.area_id}`} />
                <Button
                  label="Delete"
                  variant="ghost"
                  size="sm"
                  onPress={() => setDeleting(r)}
                  testID={`delete-${r.area_id}`}
                />
              </View>
            ),
          },
        ]}
      />

      <Sheet visible={creating} onClose={() => setCreating(false)} title={editing ? "Edit Area" : "New Area"} testID="area-sheet">
        <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="area-name" />
        <Field label="City" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} testID="area-city" />
        <Field label="State" value={form.state} onChangeText={(v) => setForm({ ...form, state: v })} testID="area-state" />
        <Field label="Description" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline />
        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.md }}>
          <Button label="Cancel" variant="ghost" onPress={() => setCreating(false)} />
          <Button label={editing ? "Save Changes" : "Create Area"} onPress={save} loading={saving} testID="area-save" />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete Area"
        message={`Delete "${deleting?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
      />
    </AdminLayout>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13 },
  num: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", gap: spacing.sm },
});
