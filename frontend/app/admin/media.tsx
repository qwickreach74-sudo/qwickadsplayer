import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Sheet, Toast, ConfirmDialog } from "@/src/admin/ui";
import { DataTable, Pill } from "@/src/admin/table";
import { colors, spacing, radius } from "@/src/theme";

type Media = {
  media_id: string;
  title: string;
  description?: string;
  media_url: string;
  media_type: "image" | "video";
  duration?: number;
  file_size_bytes?: number;
  dimensions?: string;
  active: boolean;
  created_at: string;
};

export default function MediaPage() {
  const { session } = useAdminSession();
  const [rows, setRows] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [editing, setEditing] = useState<Media | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    media_url: "",
    media_type: "image" as "image" | "video",
    duration: "10",
    dimensions: "",
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Media | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequest<{ media: Media[] }>(session, "/media");
      setRows(res.media);
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
      title: "",
      description: "",
      media_url: "",
      media_type: "image",
      duration: "10",
      dimensions: "",
      active: true,
    });
    setOpen(true);
  };

  const openEdit = (r: Media) => {
    setEditing(r);
    setForm({
      title: r.title,
      description: r.description || "",
      media_url: r.media_url,
      media_type: r.media_type,
      duration: String(r.duration ?? 10),
      dimensions: r.dimensions || "",
      active: r.active,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        description: form.description || null,
        media_url: form.media_url,
        media_type: form.media_type,
        duration: Number(form.duration) || 10,
        dimensions: form.dimensions || null,
        active: form.active,
      };
      if (editing) {
        await adminRequest(session, `/media/${editing.media_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice({ type: "success", msg: "Media updated" });
      } else {
        await adminRequest(session, "/media", { method: "POST", body: JSON.stringify(payload) });
        setNotice({ type: "success", msg: "Media added" });
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
      await adminRequest(session, `/media/${deleting.media_id}`, { method: "DELETE" });
      setNotice({ type: "success", msg: "Media deleted" });
      setDeleting(null);
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
      setDeleting(null);
    }
  };

  return (
    <AdminLayout title="Media Library">
      <View style={styles.head}>
        <Text style={styles.headSub}>
          Reference advertisements by their secure media URL. Cloudinary integration can be enabled later.
        </Text>
        <Button label="Add Media" icon="add" onPress={openCreate} testID="add-media-btn" />
      </View>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <DataTable<Media>
        rows={rows}
        keyField="media_id"
        loading={loading}
        searchFields={["title", "media_type"]}
        testID="media-table"
        empty={{
          title: "Media library is empty",
          message: "Add your first advertisement by pasting a public MP4 or image URL.",
          cta: <Button label="Add Media" icon="add" onPress={openCreate} />,
        }}
        columns={[
          { key: "title", header: "Title", render: (r) => r.title, flex: 2 },
          {
            key: "type",
            header: "Type",
            width: 100,
            render: (r) => <Pill label={r.media_type} tone={r.media_type === "video" ? "info" : "neutral"} />,
          },
          { key: "duration", header: "Duration", render: (r) => (r.duration ? `${r.duration}s` : "—"), width: 100 },
          { key: "dimensions", header: "Size", render: (r) => r.dimensions || "—", width: 120 },
          {
            key: "status",
            header: "Status",
            width: 100,
            render: (r) => <Pill label={r.active ? "Active" : "Inactive"} tone={r.active ? "success" : "neutral"} />,
          },
          {
            key: "actions",
            header: "",
            width: 180,
            render: (r) => (
              <View style={styles.actions}>
                <Button label="Edit" size="sm" variant="secondary" onPress={() => openEdit(r)} testID={`edit-${r.media_id}`} />
                <Button label="Delete" size="sm" variant="ghost" onPress={() => setDeleting(r)} testID={`delete-${r.media_id}`} />
              </View>
            ),
          },
        ]}
      />

      <Sheet visible={open} onClose={() => setOpen(false)} title={editing ? "Edit Media" : "Add Media"} testID="media-sheet">
        <Field label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} testID="media-title" />
        <Field
          label="Media URL"
          value={form.media_url}
          onChangeText={(v) => setForm({ ...form, media_url: v })}
          placeholder="https://…/creative.mp4"
          testID="media-url"
        />
        <Text style={styles.pickerLabel}>Type</Text>
        <View style={styles.pickerWrap}>
          {(["image", "video"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setForm({ ...form, media_type: t })}
              style={[styles.chip, form.media_type === t && styles.chipActive]}
              testID={`media-type-${t}`}
            >
              <Text style={[styles.chipText, form.media_type === t && styles.chipTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="Default Duration (seconds)"
          value={form.duration}
          onChangeText={(v) => setForm({ ...form, duration: v })}
          keyboardType="numeric"
        />
        <Field label="Dimensions (e.g. 1920x1080)" value={form.dimensions} onChangeText={(v) => setForm({ ...form, dimensions: v })} />
        <Field label="Description" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline />
        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.md }}>
          <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
          <Button label={editing ? "Save Changes" : "Add Media"} onPress={save} loading={saving} testID="media-save" />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete Media"
        message={`Delete "${deleting?.title}"? Blocked if any playlist still references this media.`}
        confirmLabel="Delete"
        destructive
      />
    </AdminLayout>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, flexWrap: "wrap" },
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13, maxWidth: 640 },
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
