import { PropsWithChildren, ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/theme";

type NavScreen = "dashboard" | "motors" | "customers" | "workers" | "settings";
const BOTTOM_NAV_HEIGHT = 60;

type Props = PropsWithChildren<{
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  activeTab?: NavScreen;
  onNavigate?: (screen: NavScreen) => void;
}>;

export function Screen({ title, eyebrow, action, children, activeTab, onNavigate }: Props) {
  const insets = useSafeAreaInsets();
  const contentMotion = useRef(new Animated.Value(0)).current;
  const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight || 24) : 0;
  const topPadding = insets.top > 0 ? insets.top : statusBarHeight;
  const bottomBarPadding = Math.max(insets.bottom, 8);
  const contentBottomPadding = BOTTOM_NAV_HEIGHT + bottomBarPadding + spacing.lg;

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
    <View style={styles.safe}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: topPadding + spacing.md, paddingBottom: contentBottomPadding }]}
      >
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
      <View style={[styles.bottomBar, { paddingBottom: bottomBarPadding, height: BOTTOM_NAV_HEIGHT + bottomBarPadding }]}>
        <NavItem icon="home" label="Home" active={activeTab === "dashboard"} onPress={() => onNavigate?.("dashboard")} />
        <NavItem icon="construct" label="Motors" active={activeTab === "motors"} onPress={() => onNavigate?.("motors")} />
        <NavItem icon="people" label="Customers" active={activeTab === "customers"} onPress={() => onNavigate?.("customers")} />
        <NavItem icon="calendar" label="Workers" active={activeTab === "workers"} onPress={() => onNavigate?.("workers")} />
        <NavItem icon="settings" label="Settings" active={activeTab === "settings"} onPress={() => onNavigate?.("settings")} />
      </View>
    </View>
  );
}

function NavItem({
  icon,
  label,
  active,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navButton} onPress={onPress} hitSlop={4}>
      <Ionicons name={icon} size={24} color={active ? colors.accent : colors.muted} />
      <Text numberOfLines={1} style={[styles.navLabel, active && styles.navLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surface
  },
  content: {
    paddingHorizontal: spacing.lg
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
  bottomBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8
  },
  navButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    gap: 2
  },
  navLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700"
  },
  navLabelActive: {
    color: colors.accent,
    fontWeight: "900"
  }
});
