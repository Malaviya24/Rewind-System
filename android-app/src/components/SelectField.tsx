import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/theme";

type Props<T extends string> = {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  compact?: boolean;
};

export function SelectField<T extends string>({ label, value, options, onChange, compact }: Props<T>) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      <Text numberOfLines={1} style={styles.label}>{label}</Text>
      <Pressable style={[styles.control, compact && styles.compactControl]} onPress={() => setOpen((next) => !next)}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.value}>{value}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {open ? (
        <View style={styles.menu}>
          {options.map((option) => (
            <Pressable
              key={option}
              style={[styles.option, option === value && styles.optionActive]}
              onPress={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.optionText, option === value && styles.optionTextActive]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs
  },
  compactWrap: {
    flex: 1,
    minWidth: 148
  },
  label: {
    ...typography.label
  },
  control: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  compactControl: {
    minHeight: 42
  },
  value: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  menu: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    overflow: "hidden"
  },
  option: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  optionActive: {
    backgroundColor: colors.dangerSoft
  },
  optionText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800"
  },
  optionTextActive: {
    color: colors.accentDeep
  }
});
