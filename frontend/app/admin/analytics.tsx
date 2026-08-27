import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { KPI, Card, Toast } from "@/src/admin/ui";
import { DataTable } from "@/src/admin/table";
import { colors, spacing, radius } from "@/src/theme";

type Overview = {
  range: string;
  totals: any;
};
type CampaignRow = { campaign_id: string; plays: number; completed: number; duration_seconds: number; screens_count: number };
type ScreenRow = { screen_id: string; plays: number; duration_seconds: number };

const RANGES: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
];

export default function AnalyticsPage() {
  const { session } = useAdminSession();
  const [range, setRange] = useState("7d");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, c, s] = await Promise.all([
        adminRequest<Overview>(session, `/analytics/overview?range=${range}`),
        adminRequest<{ campaigns: CampaignRow[] }>(session, `/analytics/campaigns?range=${range}`),
        adminRequest<{ screens: ScreenRow[] }>(session, `/analytics/screens?range=${range}`),
      ]);
      setOverview(o);
      setCampaigns(c.campaigns);
      setScreens(s.screens);
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    }
  }, [session, range]);

  useEffect(() => {
    load();
  }, [load]);

  const t = overview?.totals;

  return (
    <AdminLayout title="Analytics">
      <View style={styles.head}>
        <Text style={styles.headSub}>Real playback data reported by every registered screen.</Text>
        <View style={styles.rangePicker}>
          {RANGES.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => setRange(r.key)}
              style={[styles.rangeBtn, range === r.key && styles.rangeBtnActive]}
              testID={`range-${r.key}`}
            >
              <Text style={[styles.rangeText, range === r.key && styles.rangeTextActive]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}

      {t ? (
        <View style={styles.row}>
          <KPI label="Total Plays" value={t.plays} icon="play-circle-outline" testID="ana-plays" />
          <KPI label="Impressions (≥80%)" value={t.completed_plays} icon="checkmark-done-outline" color={colors.success} />
          <KPI label="Completion Rate" value={`${t.completion_rate.toFixed(1)}%`} icon="stats-chart-outline" />
          <KPI label="Hours Played" value={t.hours_played} icon="time-outline" />
          <KPI label="Online Screens" value={t.online} icon="cloud-done-outline" color={colors.success} />
          <KPI label="Offline Screens" value={t.offline} icon="cloud-offline-outline" color={colors.error} />
        </View>
      ) : null}

      <Card>
        <Text style={styles.section}>Top Campaigns</Text>
        <DataTable<CampaignRow>
          rows={campaigns}
          keyField="campaign_id"
          searchable={false}
          testID="ana-campaigns"
          empty={{ title: "No playback yet", message: "Campaign metrics will appear here once screens start reporting playback." }}
          columns={[
            { key: "id", header: "Campaign", render: (r) => r.campaign_id, flex: 2 },
            { key: "plays", header: "Plays", render: (r) => String(r.plays), width: 90 },
            { key: "completed", header: "Completed", render: (r) => String(r.completed), width: 110 },
            {
              key: "rate",
              header: "Completion",
              width: 110,
              render: (r) => (r.plays ? `${((r.completed / r.plays) * 100).toFixed(1)}%` : "—"),
            },
            {
              key: "duration",
              header: "Total Time",
              width: 130,
              render: (r) => formatDuration(r.duration_seconds),
            },
            { key: "screens", header: "Screens", render: (r) => String(r.screens_count), width: 90 },
          ]}
        />
      </Card>

      <Card>
        <Text style={styles.section}>Top Screens</Text>
        <DataTable<ScreenRow>
          rows={screens}
          keyField="screen_id"
          searchable={false}
          testID="ana-screens"
          empty={{ title: "No playback yet", message: "Screen metrics will appear here as playback events come in." }}
          columns={[
            { key: "id", header: "Screen", render: (r) => r.screen_id, flex: 2 },
            { key: "plays", header: "Plays", render: (r) => String(r.plays), width: 90 },
            { key: "duration", header: "Total Time", render: (r) => formatDuration(r.duration_seconds), width: 130 },
          ]}
        />
      </Card>
    </AdminLayout>
  );
}

function formatDuration(sec: number): string {
  if (!sec) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: spacing.md },
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13, maxWidth: 640 },
  rangePicker: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 2,
  },
  rangeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  rangeBtnActive: { backgroundColor: colors.brand },
  rangeText: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: "600" },
  rangeTextActive: { color: colors.onSurfaceInverse },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  section: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
});
