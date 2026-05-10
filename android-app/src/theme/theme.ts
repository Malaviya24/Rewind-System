import { StyleSheet } from "react-native";
import { colors } from "./colors";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
};

export const radius = {
  sm: 8,
  pill: 999
};

export const typography = {
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800" as const,
    color: colors.ink
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800" as const,
    color: colors.ink
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800" as const,
    color: colors.muted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink
  }
};

export const shadow = StyleSheet.create({
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3
  }
});
