import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Button, Field, Toast, Card } from "@/src/admin/ui";
import { Pill } from "@/src/admin/table";
import { colors, spacing, radius } from "@/src/theme";

type Screen = { screen_id: string; cab_number?: string; area_name?: string; playlist_version: number };
type Media = { media_id: string; title: string; media_type: string; duration?: number };
type Campaign = { campaign_id: string; name: string; status: string };
type PlaylistAd = {
  advertisement_id: string;
  media_id?: string;
  media_url: string;
  media_type: "image" | "video";
  duration: number;
  campaign_id?: string;
  priority: number;
};
type Playlist = { screen_id: string; playlist_version: number; advertisements: PlaylistAd[] };

type Item = { media_id: string; campaign_id?: string; duration: number; priority: number };

export default function PlaylistsPage() {
  const { session } = useAdminSession();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState<Playlist | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, m, c] = await Promise.all([
        adminRequest<{ screens: Screen[] }>(session, "/screens"),
        adminRequest<{ media: Media[] }>(session, "/media"),
        adminRequest<{ campaigns: Campaign[] }>(session, "/campaigns"),
      ]);
      setScreens(s.screens);
      setMedia(m.media);
      setCampaigns(c.campaigns.filter((x) => x.status !== "deleted"));
      if (!selected && s.screens.length > 0) setSelected(s.screens[0].screen_id);
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    }
  }, [session, selected]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      try {
        const p = await adminRequest<Playlist>(session, `/playlists/${selected}`);
        setCurrent(p);
        // Seed editor with current playlist items (map back to media_id)
        setItems(
          (p.advertisements || []).map((ad) => ({
            media_id: ad.media_id || "",
            campaign_id: ad.campaign_id,
            duration: ad.duration,
            priority: ad.priority,
          }))
        );
      } catch (e: any) {
        setNotice({ type: "error", msg: e.message });
      }
    })();
  }, [selected, session]);

  const addItem = (media_id: string) => {
    const m = media.find((x) => x.media_id === media_id);
    setItems((it) => [
      ...it,
      { media_id, duration: m?.duration || 10, priority: 100, campaign_id: undefined },
    ]);
  };

  const removeItem = (idx: number) => setItems((it) => it.filter((_, i) => i !== idx));

  const move = (idx: number, dir: -1 | 1) => {
    setItems((it) => {
      const next = [...it];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return next;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const setField = (idx: number, key: keyof Item, value: any) => {
    setItems((it) => {
      const next = [...it];
      (next[idx] as any)[key] = value;
      return next;
    });
  };

  const publish = async () => {
    if (!selected) return;
    const invalid = items.find((i) => !i.media_id);
    if (invalid) {
      setNotice({ type: "error", msg: "Every playlist item must reference a media." });
      return;
    }
    setSaving(true);
    try {
      const res = await adminRequest<{ ok: boolean; playlist_version: number; items: number }>(
        session,
        `/playlists/${selected}`,
        {
          method: "PUT",
          body: JSON.stringify({
            items: items.map((i) => ({
              media_id: i.media_id,
              campaign_id: i.campaign_id || null,
              duration: Number(i.duration) || 10,
              priority: Number(i.priority) || 100,
            })),
          }),
        }
      );
      setNotice({
        type: "success",
        msg: `Playlist v${res.playlist_version} published (${res.items} items).`,
      });
      // Refresh
      const p = await adminRequest<Playlist>(session, `/playlists/${selected}`);
      setCurrent(p);
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="Playlists">
      <Text style={styles.headSub}>
        Playlists are assigned per-screen. Publishing bumps the playlist_version — the Power Player picks it up on its
        next heartbeat or 5-minute poll and downloads any new media before switching.
      </Text>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      <View style={styles.row}>
        <Card style={{ width: 260 }}>
          <Text style={styles.section}>Screens</Text>
          {screens.length === 0 ? (
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>No screens registered yet.</Text>
          ) : (
            screens.map((s) => (
              <Pressable
                key={s.screen_id}
                onPress={() => setSelected(s.screen_id)}
                style={[styles.screenRow, selected === s.screen_id && styles.screenRowActive]}
                testID={`playlist-screen-${s.screen_id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.screenId, selected === s.screen_id && { color: colors.brand }]}>
                    {s.screen_id}
                  </Text>
                  <Text style={styles.screenSub}>
                    {s.cab_number || "—"} · {s.area_name || "—"}
                  </Text>
                </View>
                <Pill label={`v${s.playlist_version}`} tone="info" />
              </Pressable>
            ))
          )}
        </Card>

        <Card style={{ flex: 1 }}>
          {!selected ? (
            <Text style={{ color: colors.onSurfaceTertiary }}>Select a screen on the left.</Text>
          ) : (
            <>
              <View style={styles.editorHead}>
                <View>
                  <Text style={styles.section}>Editing {selected}</Text>
                  <Text style={styles.screenSub}>
                    Current version: v{current?.playlist_version ?? 0} · {items.length} item(s)
                  </Text>
                </View>
                <Button label="Publish Playlist" onPress={publish} loading={saving} testID="publish-playlist" />
              </View>

              {items.length === 0 ? (
                <Text style={{ color: colors.onSurfaceTertiary, marginTop: spacing.md }}>
                  Playlist is empty. Add media below to build it.
                </Text>
              ) : (
                items.map((it, idx) => {
                  const m = media.find((x) => x.media_id === it.media_id);
                  return (
                    <View key={idx} style={styles.item} testID={`playlist-item-${idx}`}>
                      <Text style={styles.itemIndex}>{idx + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle}>{m?.title || "(missing media)"}</Text>
                        <Text style={styles.itemSub}>
                          {m?.media_type || "?"} · {it.media_id}
                        </Text>
                      </View>
                      <View style={{ width: 80 }}>
                        <Field
                          label="Sec"
                          value={String(it.duration)}
                          onChangeText={(v) => setField(idx, "duration", Number(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={{ width: 80 }}>
                        <Field
                          label="Prio"
                          value={String(it.priority)}
                          onChangeText={(v) => setField(idx, "priority", Number(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <Pressable onPress={() => move(idx, -1)} style={styles.iconBtn} testID={`up-${idx}`}>
                        <Ionicons name="arrow-up" size={16} color={colors.onSurface} />
                      </Pressable>
                      <Pressable onPress={() => move(idx, 1)} style={styles.iconBtn} testID={`down-${idx}`}>
                        <Ionicons name="arrow-down" size={16} color={colors.onSurface} />
                      </Pressable>
                      <Pressable onPress={() => removeItem(idx)} style={styles.iconBtn} testID={`remove-${idx}`}>
                        <Ionicons name="trash" size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  );
                })
              )}

              <Text style={[styles.section, { marginTop: spacing.lg }]}>Add media</Text>
              <View style={styles.mediaGrid}>
                {media.length === 0 ? (
                  <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>
                    No media in library. Upload media first.
                  </Text>
                ) : (
                  media.map((m) => (
                    <Pressable key={m.media_id} onPress={() => addItem(m.media_id)} style={styles.mediaChip} testID={`add-media-${m.media_id}`}>
                      <Ionicons name={m.media_type === "video" ? "videocam" : "image"} size={14} color={colors.brand} />
                      <Text style={styles.mediaChipText}>{m.title}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            </>
          )}
        </Card>
      </View>
    </AdminLayout>
  );
}

const styles = StyleSheet.create({
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13, maxWidth: 800, marginBottom: spacing.sm },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  section: { fontSize: 13, fontWeight: "700", color: colors.onSurface, marginBottom: 8 },
  screenRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: radius.md,
    marginBottom: 4,
    gap: 8,
  },
  screenRowActive: { backgroundColor: colors.brandSecondary },
  screenId: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  screenSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  editorHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  item: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: 6,
  },
  itemIndex: { width: 22, fontWeight: "700", color: colors.brand, textAlign: "center", paddingBottom: 10 },
  itemTitle: { fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  itemSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mediaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
  },
  mediaChipText: { fontSize: 12, color: colors.brand, fontWeight: "600" },
});
