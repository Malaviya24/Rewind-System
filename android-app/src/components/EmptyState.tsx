import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/theme";

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.xl,
    gap: spacing.sm
  },
  title: {
    ...typography.sectionTitle
  },
  message: {
    ...typography.body,
    color: colors.muted
  }
});
