import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { KPI, Card } from "@/src/admin/ui";
import { colors, spacing } from "@/src/theme";

type Overview = {
  range: string;
  totals: {
    screens: number;
    online: number;
    offline: number;
    never_connected: number;
    cabs: number;
    areas: number;
    active_campaigns: number;
    plays: number;
    completed_plays: number;
    completion_rate: number;
    hours_played: number;
    screens_attention: number;
  };
};

export default function AdminDashboard() {
  const { session } = useAdminSession();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminRequest<Overview>(session, "/analytics/overview?range=7d");
        setData(res);
      } catch (e: any) {
        setErr(e.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : err ? (
        <Text style={styles.err}>{err}</Text>
      ) : data ? (
        <>
          <View style={styles.row}>
            <KPI label="Total Screens" value={data.totals.screens} icon="tv-outline" testID="kpi-screens" />
            <KPI label="Online" value={data.totals.online} icon="cloud-done-outline" color={colors.success} testID="kpi-online" />
            <KPI label="Offline" value={data.totals.offline} icon="cloud-offline-outline" color={colors.error} testID="kpi-offline" />
            <KPI label="Never Connected" value={data.totals.never_connected} icon="help-circle-outline" color={colors.warning} />
          </View>
          <View style={styles.row}>
            <KPI label="Active Cabs" value={data.totals.cabs} icon="car-outline" />
            <KPI label="Total Areas" value={data.totals.areas} icon="map-outline" />
            <KPI label="Active Campaigns" value={data.totals.active_campaigns} icon="megaphone-outline" />
            <KPI label="Attention Needed" value={data.totals.screens_attention} icon="warning-outline" color={colors.warning} />
          </View>
          <View style={styles.row}>
            <KPI label="Plays (7d)" value={data.totals.plays} icon="play-circle-outline" testID="kpi-plays" />
            <KPI label="Completed" value={data.totals.completed_plays} icon="checkmark-circle-outline" color={colors.success} />
            <KPI label="Completion Rate" value={`${data.totals.completion_rate.toFixed(1)}%`} icon="stats-chart-outline" />
            <KPI label="Hours Played (7d)" value={data.totals.hours_played} icon="time-outline" />
          </View>

          <Card>
            <Text style={styles.cardTitle}>How impressions are counted</Text>
            <Text style={styles.cardBody}>
              An "impression" is a playback event whose completion percentage is at least 80%.
              Plays below that threshold count as attempts but not impressions. This definition is
              derived from real events reported by the Power Player and is documented in
              /api/analytics/overview.
            </Text>
          </Card>
        </>
      ) : null}
    </AdminLayout>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  cardTitle: { fontWeight: "700", fontSize: 14, color: colors.onSurface, marginBottom: 6 },
  cardBody: { fontSize: 13, color: colors.onSurfaceTertiary, lineHeight: 20 },
  err: { color: colors.error, padding: spacing.lg },
});
