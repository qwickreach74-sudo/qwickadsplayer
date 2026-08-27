/**
 * Data table used across admin resource screens. Keeps behaviour consistent:
 * search, sort, per-row actions, empty state, loading.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/src/theme";
import { EmptyState } from "./ui";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  width?: number;
  flex?: number;
};

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  keyField,
  searchable = true,
  searchFields = [],
  loading,
  empty,
  emptyIcon = "folder-open-outline",
  testID,
}: {
  rows: T[];
  columns: Column<T>[];
  keyField: keyof T;
  searchable?: boolean;
  searchFields?: (keyof T)[];
  loading?: boolean;
  empty?: { title: string; message: string; cta?: React.ReactNode };
  emptyIcon?: any;
  testID?: string;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim() || searchFields.length === 0) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      searchFields.some((f) => String(r[f] ?? "").toLowerCase().includes(needle))
    );
  }, [rows, q, searchFields]);

  return (
    <View style={styles.wrap} testID={testID}>
      {searchable && rows.length > 0 ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.onSurfaceTertiary} />
          <TextInput
            testID={testID ? `${testID}-search` : "table-search"}
            value={q}
            onChangeText={setQ}
            placeholder="Search…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
          />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <Text style={{ color: colors.onSurfaceTertiary }}>Loading…</Text>
        </View>
      ) : filtered.length === 0 ? (
        empty ? (
          <EmptyState icon={emptyIcon} title={empty.title} message={empty.message} cta={empty.cta} />
        ) : (
          <EmptyState
            icon={emptyIcon}
            title="No results"
            message={q ? "Try a different search" : "Nothing to show yet."}
          />
        )
      ) : (
        <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
          <View style={styles.table}>
            <View style={styles.thead}>
              {columns.map((c) => (
                <View
                  key={c.key}
                  style={[
                    styles.cell,
                    { width: c.width, flex: c.flex ?? (c.width ? undefined : 1) },
                  ]}
                >
                  <Text style={styles.th}>{c.header}</Text>
                </View>
              ))}
            </View>
            {filtered.map((row) => (
              <View key={String(row[keyField])} style={styles.tr}>
                {columns.map((c) => (
                  <View
                    key={c.key}
                    style={[
                      styles.cell,
                      { width: c.width, flex: c.flex ?? (c.width ? undefined : 1) },
                    ]}
                  >
                    {typeof c.render(row) === "string" || typeof c.render(row) === "number" ? (
                      <Text style={styles.td}>{c.render(row) as any}</Text>
                    ) : (
                      c.render(row)
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export function Pill({
  label,
  tone = "neutral",
  testID,
}: {
  label: string;
  tone?: "neutral" | "success" | "error" | "warning" | "info";
  testID?: string;
}) {
  const bg =
    tone === "success"
      ? "#DCFCE7"
      : tone === "error"
      ? "#FEE2E2"
      : tone === "warning"
      ? "#FEF3C7"
      : tone === "info"
      ? "#DBEAFE"
      : "#F3F4F6";
  const fg =
    tone === "success"
      ? "#166534"
      : tone === "error"
      ? "#991B1B"
      : tone === "warning"
      ? "#92400E"
      : tone === "info"
      ? "#1E3A8A"
      : "#374151";
  return (
    <View testID={testID} style={[pillStyles.pill, { backgroundColor: bg }]}>
      <Text style={[pillStyles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 320,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, outlineWidth: 0 as any },
  table: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: "100%",
  },
  thead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  th: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.onSurfaceTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  cell: { paddingRight: 12, justifyContent: "center" },
  td: { color: colors.onSurface, fontSize: 13 },
  loading: { padding: spacing.xl, alignItems: "center" },
});

const pillStyles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  text: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
});
