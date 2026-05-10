import { PropsWithChildren, ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/theme";

type NavScreen = "dashboard" | "motors" | "customers" | "workers" | "settings";

type Props = PropsWithChildren<{
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  activeTab?: NavScreen;
  onNavigate?: (screen: NavScreen) => void;
}>;

export function Screen({ title, eyebrow, action, children, activeTab, onNavigate }: Props) {
  const contentMotion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    contentMotion.setValue(0);
    Animated.timing(contentMotion, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [activeTab, contentMotion, title]);

  const translateY = contentMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0]
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Animated.View renderToHardwareTextureAndroid style={[styles.contentMotion, { transform: [{ translateY }] }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              {eyebrow ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.eyebrow}>{eyebrow}</Text> : null}
              <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.76} style={styles.title}>{title}</Text>
            </View>
            {action ? <View style={styles.headerAction}>{action}</View> : null}
          </View>
          {children}
        </Animated.View>
      </ScrollView>
      <View style={styles.bottomNav}>
        <NavItem icon="home" label="Home" active={activeTab === "dashboard"} onPress={() => onNavigate?.("dashboard")} />
        <NavItem icon="construct" label="Motors" active={activeTab === "motors"} onPress={() => onNavigate?.("motors")} />
        <NavItem icon="people" label="Customers" active={activeTab === "customers"} onPress={() => onNavigate?.("customers")} />
        <NavItem icon="calendar" label="Workers" active={activeTab === "workers"} onPress={() => onNavigate?.("workers")} />
        <NavItem icon="settings" label="Settings" active={activeTab === "settings"} accent onPress={() => onNavigate?.("settings")} />
      </View>
    </SafeAreaView>
  );
}

function NavItem({
  icon,
  label,
  active,
  accent,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  accent?: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function pressIn() {
    Animated.spring(scale, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 28,
      bounciness: 8
    }).start();
  }

  function pressOut() {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 10
    }).start();
  }

  return (
    <Pressable onPressIn={pressIn} onPressOut={pressOut} style={styles.navButton} onPress={onPress} hitSlop={8}>
      <Animated.View style={[styles.navBubble, active && styles.navBubbleActive, { transform: [{ scale }] }]}>
        <Ionicons name={icon} size={17} color={active ? colors.white : accent ? colors.accentDeep : colors.muted} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.navItem, active && styles.navItemActive, accent && !active && styles.navAccent]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 208
  },
  contentMotion: {
    gap: spacing.lg,
    backgroundColor: colors.surface
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  headerText: {
    flex: 1,
    minWidth: 0
  },
  headerAction: {
    flexShrink: 0
  },
  eyebrow: {
    ...typography.label,
    color: colors.accent
  },
  title: {
    ...typography.title,
    flexShrink: 1
  },
  bottomNav: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: Platform.OS === "android" ? spacing.lg : spacing.md,
    minHeight: 66,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.78)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8
  },
  navButton: {
    flex: 1,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2
  },
  navBubble: {
    minHeight: 46,
    minWidth: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    gap: 2
  },
  navBubbleActive: {
    backgroundColor: colors.accent
  },
  navItem: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  navItemActive: {
    color: colors.white
  },
  navAccent: {
    color: colors.accentDeep
  }
});
