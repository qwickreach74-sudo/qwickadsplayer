import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { AdminLayout } from "@/src/admin/layout";
import { adminRequest, useAdminSession } from "@/src/admin/session";
import { Toast } from "@/src/admin/ui";
import { DataTable, Pill } from "@/src/admin/table";
import { colors, spacing } from "@/src/theme";

type Log = {
  admin_email: string;
  action: string;
  entity: string;
  entity_id?: string;
  timestamp: string;
  meta?: any;
};

export default function AuditPage() {
  const { session } = useAdminSession();
  const [rows, setRows] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequest<{ audit_logs: Log[] }>(session, "/audit?limit=500");
      setRows(res.audit_logs);
    } catch (e: any) {
      setNotice({ type: "error", msg: e.message });
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title="Audit Log">
      <Text style={styles.headSub}>Every admin action against the system is recorded here.</Text>
      {notice ? <Toast message={notice.msg} type={notice.type} /> : null}
      <DataTable<Log>
        rows={rows}
        keyField={"timestamp" as any}
        loading={loading}
        searchFields={["admin_email", "action", "entity", "entity_id"] as any}
        testID="audit-table"
        empty={{ title: "No audit entries", message: "Admin actions will appear here." }}
        columns={[
          { key: "when", header: "When", render: (r) => new Date(r.timestamp).toLocaleString(), flex: 2 },
          { key: "who", header: "Admin", render: (r) => r.admin_email || "—", flex: 2 },
          {
            key: "action",
            header: "Action",
            width: 130,
            render: (r) => <Pill label={r.action} tone={r.action === "delete" ? "error" : r.action === "create" ? "success" : "info"} />,
          },
          { key: "entity", header: "Entity", render: (r) => r.entity, width: 130 },
          { key: "id", header: "Entity ID", render: (r) => r.entity_id || "—", flex: 2 },
        ]}
      />
    </AdminLayout>
  );
}

const styles = StyleSheet.create({
  headSub: { color: colors.onSurfaceTertiary, fontSize: 13 },
});
