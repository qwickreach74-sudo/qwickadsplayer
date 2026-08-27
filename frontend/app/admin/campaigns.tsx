import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Sheet, Toast, ConfirmDialog } from "@/src/admin/ui";
import { DataTable, Pill } from "@/src/admin/table";
import { colors, spacing, radius } from "@/src/theme";

type Campaign = {
  campaign_id: string;
  name: string;
  advertiser?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  priority: number;
  media_ids: string[];
  area_ids: string[];
  screen_ids: string[];
  status: "draft" | "scheduled" | "active" | "paused" | "completed" | "deleted";
  created_at: string;
};

type Media = { media_id: string; title: string; media_type: string };
type Area = { area_id: string; name: string };
type Screen = { screen_id: string; cab_number?: string };

const STATUSES: Campaign["status"][] = ["draft", "scheduled", "active", "paused", "completed"];

export default function CampaignsPage() {
  const { session } = useAdminSession();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    advertiser: "",
    description: "",
    start_date: "",
    end_date: "",
    priority: "100",
    media_ids: [] as string[],
    area_ids: [] as string[],
    screen_ids: [] as string[],
    status: "draft" as Campaign["status"],
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, m, a, s] = await Promise.all([
        adminRequest<{ campaigns: Campaign[] }>(session, "/campaigns"),
        adminRequest<{ media: Media[] }>(session, "/media"),
        adminRequest<{ areas: Area[] }>(session, "/areas"),
        adminRequest<{ screens: Screen[] }>(session, "/screens"),
      ]);
      setRows(c.campaigns);
      setMedia(m.media);
      setAreas(a.areas);
      setScreens(s.screens);
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
      name: "",
      advertiser: "",
      description: "",
      start_date: "",
      end_date: "",
      priority: "100",
      media_ids: [],
      area_ids: [],
      screen_ids: [],
      status: "draft",
    });
    setOpen(true);
  };

  const openEdit = (r: Campaign) => {
    setEditing(r);
    setForm({
      name: r.name,
      advertiser: r.advertiser || "",
      description: r.description || "",
      start_date: r.start_date || "",
      end_date: r.end_date || "",
      priority: String(r.priority),
      media_ids: r.media_ids || [],
      area_ids: r.area_ids || [],
      screen_ids: r.screen_ids || [],
      status: r.status,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        priority: Number(form.priority) || 100,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (editing) {
        await adminRequest(session, `/campaigns/${editing.campaign_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setNotice({ type: "success", msg: "Campaign updated" });
      } else {
        await adminRequest(session, "/campaigns", { method: "POST", body: JSON.stringify(payload) });
        setNotice({ type: "success", msg: "Campaign created" });
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
      await adminRequest(session, `/campaigns/${deleting.campaign_id}`, { method: "DELETE" });
      setNotice({ type: "success", msg: "Campaign archived" });
      setDeleting(null);
      load();
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
      setDeleting(null);
    }
  };

  const toggle = (key: "media_ids" | "area_ids" | "screen_ids", id: string) => {
    setForm((f) => {
      const list = f[key];
      return {
        ...f,
        [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
      };
    });
  };

  const statusTone: Record<Campaign["status"], any> = {
    draft: "neutral",
    scheduled: "info",
    active: "success",
    paused: "warning",
    completed: "neutral",
    deleted: "error",
  };

  return (
    <AdminLayout title="Campaigns">
      <View style={styles.head}>
        <Text style={styles.headSub}>Group ads under a business objective and assign them to areas or screens.</Text>
        <Button label="New Campaign" icon="add" onPress={openCreate} testID="add-campaign-btn" />
      </View>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <DataTable<Campaign>
        rows={rows.filter((r) => r.status !== "deleted")}
        keyField="campaign_id"
        loading={loading}
        searchFields={["name", "advertiser"]}
        testID="campaigns-table"
        empty={{
          title: "No campaigns yet",
          message: "Create a campaign, attach media and assign it to areas or screens.",
          cta: <Button label="New Campaign" icon="add" onPress={openCreate} />,
        }}
        columns={[
          { key: "name", header: "Name", render: (r) => r.name, flex: 2 },
          { key: "advertiser", header: "Advertiser", render: (r) => r.advertiser || "—", flex: 1 },
          { key: "priority", header: "Priority", render: (r) => String(r.priority), width: 90 },
          {
            key: "ads",
            header: "Ads",
            render: (r) => String((r.media_ids || []).length),
            width: 70,
          },
          {
            key: "status",
            header: "Status",
            width: 110,
            render: (r) => <Pill label={r.status} tone={statusTone[r.status]} testID={`campaign-status-${r.campaign_id}`} />,
          },
          {
            key: "actions",
            header: "",
            width: 180,
            render: (r) => (
              <View style={styles.actions}>
                <Button label="Edit" size="sm" variant="secondary" onPress={() => openEdit(r)} testID={`edit-${r.campaign_id}`} />
                <Button label="Delete" size="sm" variant="ghost" onPress={() => setDeleting(r)} testID={`delete-${r.campaign_id}`} />
              </View>
            ),
          },
        ]}
      />

      <Sheet visible={open} onClose={() => setOpen(false)} title={editing ? "Edit Campaign" : "New Campaign"} width={720} testID="campaign-sheet">
        <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="campaign-name" />
        <Field label="Advertiser" value={form.advertiser} onChangeText={(v) => setForm({ ...form, advertiser: v })} />
        <Field label="Description" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="Start Date (YYYY-MM-DD)" value={form.start_date} onChangeText={(v) => setForm({ ...form, start_date: v })} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="End Date (YYYY-MM-DD)" value={form.end_date} onChangeText={(v) => setForm({ ...form, end_date: v })} />
          </View>
          <View style={{ width: 120 }}>
            <Field label="Priority" value={form.priority} onChangeText={(v) => setForm({ ...form, priority: v })} keyboardType="numeric" />
          </View>
        </View>

        <Text style={styles.pickerLabel}>Status</Text>
        <View style={styles.pickerWrap}>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setForm({ ...form, status: s })} style={[styles.chip, form.status === s && styles.chipActive]} testID={`campaign-status-${s}`}>
              <Text style={[styles.chipText, form.status === s && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.pickerLabel}>Media</Text>
        <View style={styles.pickerWrap}>
          {media.length === 0 ? (
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>No media in library</Text>
          ) : (
            media.map((m) => (
              <Pressable
                key={m.media_id}
                onPress={() => toggle("media_ids", m.media_id)}
                style={[styles.chip, form.media_ids.includes(m.media_id) && styles.chipActive]}
                testID={`campaign-media-${m.media_id}`}
              >
                <Text style={[styles.chipText, form.media_ids.includes(m.media_id) && styles.chipTextActive]}>
                  {m.title}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <Text style={styles.pickerLabel}>Areas</Text>
        <View style={styles.pickerWrap}>
          {areas.map((a) => (
            <Pressable
              key={a.area_id}
              onPress={() => toggle("area_ids", a.area_id)}
              style={[styles.chip, form.area_ids.includes(a.area_id) && styles.chipActive]}
            >
              <Text style={[styles.chipText, form.area_ids.includes(a.area_id) && styles.chipTextActive]}>{a.name}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.pickerLabel}>Specific Screens (optional)</Text>
        <View style={styles.pickerWrap}>
          {screens.map((s) => (
            <Pressable
              key={s.screen_id}
              onPress={() => toggle("screen_ids", s.screen_id)}
              style={[styles.chip, form.screen_ids.includes(s.screen_id) && styles.chipActive]}
            >
              <Text style={[styles.chipText, form.screen_ids.includes(s.screen_id) && styles.chipTextActive]}>
                {s.screen_id}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end", marginTop: spacing.md }}>
          <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
          <Button label={editing ? "Save Changes" : "Create Campaign"} onPress={save} loading={saving} testID="campaign-save" />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title="Archive Campaign"
        message={`Archive "${deleting?.name}"? Playback history and analytics are preserved.`}
        confirmLabel="Archive"
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
