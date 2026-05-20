import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Badge } from "@/components/Badge";
import { SelectField } from "@/components/SelectField";
import { MotorWithMedia, paymentStatuses, repairStatuses } from "@/models/types";
import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/theme";
import { displayDate, isOverdue } from "@/utils/dates";
import { balanceAmount, money, repairAmount } from "@/utils/money";

type Props = {
  motor: MotorWithMedia;
  onOpen: () => void;
  onStatus: (status: MotorWithMedia["status"]) => void;
  onPayment: (status: MotorWithMedia["paymentStatus"]) => void;
};

export function MotorCard({ motor, onOpen, onStatus, onPayment }: Props) {
  const preview = motor.media[0];
  const overdue = isOverdue(motor.deadlineDate, motor.status);
  const phone = normalizePhone(motor.phoneNumber);

  function callCustomer() {
    if (phone) {
      void safeOpenUrl(`tel:${phone}`);
    }
  }

  function openWhatsApp() {
    if (phone) {
      void safeOpenUrl(`https://wa.me/${phone}`, `sms:${phone}`);
    }
  }

  return (
    <View style={[styles.card, overdue && styles.overdueCard]}>
      {motor.batchNumber ? (
        <View style={styles.batchTag}>
          <Text style={styles.batchTagText}>#{motor.batchNumber}</Text>
        </View>
      ) : null}
      <Pressable style={styles.preview} onPress={onOpen}>
        {preview?.mediaType === "image" ? (
          <Image source={{ uri: preview.uri }} style={styles.previewImage} />
        ) : preview?.mediaType === "video" ? (
          <View style={styles.videoPreview}>
            <Ionicons name="play-circle" size={38} color={colors.accentDeep} />
            <Text style={styles.previewHint}>Video attached</Text>
          </View>
        ) : (
          <View style={styles.videoPreview}>
            <Ionicons name="image" size={34} color={colors.accentDeep} />
            <Text style={styles.previewHint}>No media</Text>
          </View>
        )}
        <Text style={styles.mediaCount}>{motor.media.length || 0}</Text>
      </Pressable>
      <View style={styles.cardTop}>
        <View style={styles.topContent}>
          <View style={styles.topLine}>
            <Badge label={motor.status} />
            <Badge label={motor.paymentStatus} />
            {overdue ? <Badge label="Overdue" /> : null}
          </View>
          <Pressable onPress={onOpen}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.name}>{motor.customerName}</Text>
            <Text numberOfLines={2} style={styles.meta}>
              #{motor.batchNumber} · {motor.motorType}
            </Text>
          </Pressable>
          <Text numberOfLines={2} style={styles.meta}>
            Due {displayDate(motor.deadlineDate)}
          </Text>
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.amountRow}>
          <View style={styles.amountPill}>
            <Text style={styles.amountLabel}>Amount</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64} style={styles.amount}>{money(repairAmount(motor.finalCost, motor.estimatedCost))}</Text>
          </View>
          <View style={[styles.amountPill, balanceAmount(motor.finalCost, motor.estimatedCost, motor.advancePaid) > 0 && styles.balanceDuePill]}>
            <Text style={styles.amountLabel}>Balance</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={styles.balance}>{money(balanceAmount(motor.finalCost, motor.estimatedCost, motor.advancePaid))}</Text>
          </View>
        </View>
        <View style={styles.selectRow}>
          <SelectField compact label="Repair Status" value={motor.status} options={repairStatuses} onChange={onStatus} />
          <SelectField compact label="Payment" value={motor.paymentStatus} options={paymentStatuses} onChange={onPayment} />
        </View>
        <View style={styles.quickActions}>
          <ActionButton icon="call" label="Call" onPress={callCustomer} />
          <ActionButton icon="logo-whatsapp" label="WhatsApp" onPress={openWhatsApp} />
          <ActionButton icon="open" label="Open" onPress={onOpen} strong />
        </View>
      </View>
    </View>
  );
}

async function safeOpenUrl(url: string, fallback?: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
    if (fallback) {
      await Linking.openURL(fallback);
    }
  } catch {
    if (fallback) {
      try {
        await Linking.openURL(fallback);
      } catch {
        // Some Android skins reject intent URLs. Keeping this caught prevents red-screen promise errors.
      }
    }
  }
}

function ActionButton({ icon, label, onPress, strong }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable style={[styles.actionButton, strong && styles.actionButtonStrong]} onPress={onPress}>
      <Ionicons name={icon} size={17} color={strong ? colors.white : colors.accentDeep} />
      <Text numberOfLines={1} style={[styles.actionText, strong && styles.actionTextStrong]}>{label}</Text>
    </Pressable>
  );
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3
  },
  overdueCard: {
    borderColor: colors.accent
  },
  batchTag: {
    position: "absolute",
    top: -14,
    left: spacing.md,
    zIndex: 10,
    backgroundColor: colors.accentDeep,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4
  },
  batchTagText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5
  },
  cardTop: {
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: 0
  },
  preview: {
    height: 188,
    overflow: "hidden",
    backgroundColor: "#F8F8F9",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  previewImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain"
  },
  videoPreview: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  previewHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  mediaCount: {
    position: "absolute",
    top: 6,
    right: 6,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: colors.accentDeep,
    color: colors.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontWeight: "900",
    textTransform: "uppercase",
    fontSize: 10
  },
  topContent: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm
  },
  body: {
    padding: spacing.md,
    gap: spacing.md
  },
  topLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  name: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.ink,
    flexShrink: 1
  },
  meta: {
    color: colors.muted,
    fontWeight: "700",
    marginTop: 2,
    flexShrink: 1
  },
  amountRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  amountPill: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.sm
  },
  balanceDuePill: {
    backgroundColor: colors.warningSoft,
    borderColor: "rgba(169,106,0,0.28)"
  },
  amountLabel: {
    ...typography.label,
    fontSize: 10
  },
  amount: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  balance: {
    color: colors.ink,
    fontWeight: "900"
  },
  selectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm
  },
  actionText: {
    color: colors.accentDeep,
    fontSize: 12,
    fontWeight: "900"
  },
  actionButtonStrong: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  actionTextStrong: {
    color: colors.white
  }
});
