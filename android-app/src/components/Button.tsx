import { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "@/theme/colors";
import { radius, spacing } from "@/theme/theme";

type Props = PropsWithChildren<{
  onPress?: () => void;
  variant?: "primary" | "ghost" | "danger" | "success";
  disabled?: boolean;
}>;

export function Button({ children, onPress, variant = "ghost", disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed
      ]}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.text, variant === "ghost" && styles.ghostText]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 86,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border
  },
  primary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  ghost: {
    backgroundColor: colors.white
  },
  danger: {
    backgroundColor: colors.accentDeep,
    borderColor: colors.accentDeep
  },
  success: {
    backgroundColor: colors.success,
    borderColor: colors.success
  },
  disabled: {
    opacity: 0.5
  },
  pressed: {
    transform: [{ scale: 0.98 }]
  },
  text: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0,
    textAlign: "center"
  },
  ghostText: {
    color: colors.accentDeep
  }
});
