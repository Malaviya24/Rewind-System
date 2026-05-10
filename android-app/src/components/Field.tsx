import { StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/theme";

type Props = TextInputProps & {
  label: string;
};

export function Field({ label, style, ...props }: Props) {
  return (
    <View style={styles.wrap}>
      <Text numberOfLines={2} style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs
  },
  label: {
    ...typography.label
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700"
  }
});
