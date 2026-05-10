import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/theme";

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View style={styles.tile}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.label}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} style={styles.value}>{value}</Text>
      {hint ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: "47%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.xs
  },
  label: {
    ...typography.label
  },
  value: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.ink
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  }
});
