/**
 * Reusable admin UI primitives. Kept intentionally small so every admin
 * screen stays under ~200 lines of layout code.
 */
import React from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/src/theme";

// ----- Button ---------------------------------------------------------------
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md";
  icon?: any;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const bg =
    variant === "primary"
      ? colors.brand
      : variant === "destructive"
      ? colors.error
      : variant === "secondary"
      ? colors.brandSecondary
      : "transparent";
  const fg =
    variant === "primary" || variant === "destructive"
      ? colors.onSurfaceInverse
      : variant === "secondary"
      ? colors.brand
      : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btnBase,
        size === "sm" ? styles.btnSm : styles.btnMd,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.border },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === "sm" ? 14 : 16} color={fg} /> : null}
          <Text style={[styles.btnText, { color: fg }, size === "sm" && { fontSize: 12 }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ----- Input ----------------------------------------------------------------
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  error,
  keyboardType,
  autoCapitalize,
  testID,
  multiline,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secure?: boolean;
  error?: string | null;
  keyboardType?: any;
  autoCapitalize?: any;
  testID?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        testID={testID}
        style={[
          styles.input,
          error ? { borderColor: colors.error } : null,
          multiline && { minHeight: 72, textAlignVertical: "top" },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceTertiary}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ----- Card / KPI -----------------------------------------------------------
export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function KPI({
  label,
  value,
  icon,
  color,
  testID,
}: {
  label: string;
  value: string | number;
  icon: any;
  color?: string;
  testID?: string;
}) {
  const c = color || colors.brand;
  return (
    <View testID={testID} style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: c + "1A" }]}>
        <Ionicons name={icon} size={20} color={c} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={styles.kpiValue}>{value}</Text>
      </View>
    </View>
  );
}

// ----- Modal ----------------------------------------------------------------
export function Sheet({
  visible,
  onClose,
  title,
  children,
  width = 560,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
  testID?: string;
}) {
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.sheetBackdrop}>
        <View testID={testID} style={[styles.sheet, { maxWidth: width }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} testID={testID ? `${testID}-close` : undefined}>
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 600 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ----- Toast (very simple inline banner) ------------------------------------
export function Toast({
  message,
  type = "info",
  testID,
}: {
  message: string | null;
  type?: "info" | "success" | "error";
  testID?: string;
}) {
  if (!message) return null;
  const bg =
    type === "success" ? colors.success : type === "error" ? colors.error : colors.info;
  return (
    <View testID={testID} style={[styles.toast, { backgroundColor: bg }]}>
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

// ----- Confirm dialog -------------------------------------------------------
export function ConfirmDialog({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  destructive,
}: {
  visible: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title} width={440} testID="confirm-dialog">
      <Text style={{ color: colors.onSurfaceTertiary, marginBottom: spacing.lg, lineHeight: 20 }}>
        {message}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.md, justifyContent: "flex-end" }}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} testID="confirm-cancel" />
        <Button
          label={confirmLabel}
          variant={destructive ? "destructive" : "primary"}
          onPress={onConfirm}
          testID="confirm-ok"
        />
      </View>
    </Sheet>
  );
}

// ----- Empty state ----------------------------------------------------------
export function EmptyState({
  icon,
  title,
  message,
  cta,
}: {
  icon: any;
  title: string;
  message: string;
  cta?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.brand} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {cta}
    </View>
  );
}

const styles = StyleSheet.create({
  btnBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.md,
  },
  btnSm: { paddingHorizontal: 10, paddingVertical: 6 },
  btnMd: { paddingHorizontal: 14, paddingVertical: 10 },
  btnText: { fontWeight: "700", fontSize: 14 },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 4 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpi: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 200,
    flex: 1,
  },
  kpiIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiLabel: {
    fontSize: 11,
    color: colors.onSurfaceTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "600",
  },
  kpiValue: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
    maxHeight: "90%",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  toast: {
    padding: 12,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  toastText: { color: "#FFF", fontWeight: "600", fontSize: 13 },
  empty: {
    alignItems: "center",
    padding: spacing.xxl,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  emptyMessage: {
    fontSize: 13,
    color: colors.onSurfaceTertiary,
    marginTop: 6,
    marginBottom: spacing.md,
    textAlign: "center",
  },
});
