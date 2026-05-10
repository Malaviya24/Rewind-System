import { StyleSheet, Text } from "react-native";
import { colors } from "@/theme/colors";
import { radius, spacing } from "@/theme/theme";

export function Badge({ label }: { label: string }) {
  const tone = toneFor(label);
  return <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.badge, styles[tone]]}>{label}</Text>;
}

function toneFor(label: string) {
  const value = label.toLowerCase();
  if (["completed", "delivered", "paid", "present", "available"].includes(value)) {
    return "success" as const;
  }
  if (["waiting for parts", "checking", "partial", "leave"].includes(value)) {
    return "warning" as const;
  }
  if (["overdue", "unpaid", "absent"].includes(value)) {
    return "danger" as const;
  }
  return "neutral" as const;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    maxWidth: "100%",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0
  },
  success: {
    color: colors.success,
    backgroundColor: colors.successSoft
  },
  warning: {
    color: colors.warning,
    backgroundColor: colors.warningSoft
  },
  danger: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft
  },
  neutral: {
    color: colors.info,
    backgroundColor: colors.infoSoft
  }
});
