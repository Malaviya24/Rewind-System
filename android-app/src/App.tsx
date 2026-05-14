import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, Image, Linking, Modal, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { MediaViewer } from "@/components/MediaViewer";
import { MotorCard } from "@/components/MotorCard";
import { Screen } from "@/components/Screen";
import { SelectField } from "@/components/SelectField";
import { StatTile } from "@/components/StatTile";
import { importLatestBackupFromPickedFolder, sharePhoneBackup } from "@/backup/backupService";
import { useAppDatabase } from "@/db/useAppDatabase";
import {
  attachMotorMedia,
  deleteMotor,
  getDashboardSummary,
  getMotor,
  getSecurityPinHash,
  getShopSettings,
  listCustomers,
  listAttendanceForMonth,
  listDashboardAttention,
  listMotors,
  listWorkerSalaryPaymentsForMonth,
  listWorkers,
  markAttendance,
  saveMotor,
  saveSecurityPinHash,
  saveShopSettings,
  saveWorkerSalaryPayment,
  saveWorker,
  updateMotorPayment,
  updateMotorStatus
} from "@/db/repositories";
import { AttendanceStatus, BackupImportStats, BackupManifest, BackupRange, DashboardSummary, MotorWithMedia, RepairStatus, ShopSettings, Worker, WorkerAttendanceRow, WorkerSalaryPayment, repairStatuses } from "@/models/types";
import { captureMotorPhoto, deleteLocalFiles, pickMotorMedia, pickShopLogo } from "@/services/mediaService";
import { activateLicenseKey, getLicenseStatus, LicenseStatus } from "@/services/license";
import { colors } from "@/theme/colors";
import { radius, shadow, spacing, typography } from "@/theme/theme";
import { addDaysIso, addMonthsIso, currentMonthIso, displayDate, displayMonth, todayIso } from "@/utils/dates";
import { balanceAmount, money, repairAmount } from "@/utils/money";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

type ScreenName = "dashboard" | "motors" | "motor-detail" | "motor-form" | "customers" | "customer-detail" | "workers" | "backup" | "settings";
type MotorFilterMode = "All" | "Date" | "Month" | "Range";
type MotorStatusFilter = "All" | RepairStatus;
type DashboardFilterMode = "All" | "Today" | "Date" | "Month" | "Range";
type PickerMode = "date" | "month";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { ready, error } = useAppDatabase();
  const [screenStack, setScreenStack] = useState<ScreenName[]>(["dashboard"]);
  const [selectedMotorUuid, setSelectedMotorUuid] = useState<string | null>(null);
  const [selectedCustomerUuid, setSelectedCustomerUuid] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseChecking, setLicenseChecking] = useState(true);
  const screen = screenStack[screenStack.length - 1] || "dashboard";
  const screenStackRef = useRef(screenStack);

  useEffect(() => {
    screenStackRef.current = screenStack;
  }, [screenStack]);

  function navigate(next: ScreenName) {
    setScreenStack((stack) => {
      const current = stack[stack.length - 1] || "dashboard";
      if (current === next) {
        return stack;
      }
      return [...stack, next];
    });
  }

  function refresh() {
    setRefreshKey((value) => value + 1);
  }

  async function refreshLicenseStatus() {
    setLicenseChecking(true);
    try {
      setLicenseStatus(await getLicenseStatus());
    } finally {
      setLicenseChecking(false);
    }
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const stack = screenStackRef.current;
      if (stack.length > 1) {
        setScreenStack(stack.slice(0, -1));
        return true;
      }

      if (stack[0] !== "dashboard") {
        setScreenStack(["dashboard"]);
      }
      return true;
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void refreshLicenseStatus();
  }, [ready]);

  useEffect(() => {
    if (!ready || !licenseStatus?.valid) {
      return;
    }
    void refreshDeadlineNotifications();
  }, [ready, refreshKey, licenseStatus?.valid]);

  if (error) {
    return <Centered message={error} danger />;
  }
  if (!ready) {
    return <LoadingScreen />;
  }
  if (licenseChecking) {
    return <LoadingScreen />;
  }
  if (!licenseStatus?.valid) {
    return <ActivationScreen status={licenseStatus} onActivated={refreshLicenseStatus} />;
  }

  return (
    <>
      <StatusBar style="dark" />
      {screen === "dashboard" ? (
        <DashboardScreen
          onNavigate={navigate}
          refreshKey={refreshKey}
          onOpenMotor={(uuid) => {
            setSelectedMotorUuid(uuid);
            navigate("motor-detail");
          }}
        />
      ) : null}
      {screen === "motors" ? (
        <MotorsScreen
          onNavigate={navigate}
          refreshKey={refreshKey}
          onOpen={(uuid) => {
            setSelectedMotorUuid(uuid);
            navigate("motor-detail");
          }}
          onAdd={() => {
            setSelectedMotorUuid(null);
            navigate("motor-form");
          }}
          onChanged={refresh}
        />
      ) : null}
      {screen === "motor-detail" && selectedMotorUuid ? (
        <MotorDetailScreen
          motorUuid={selectedMotorUuid}
          onNavigate={navigate}
          onEdit={() => navigate("motor-form")}
          onChanged={refresh}
          onDeleted={() => {
            setSelectedMotorUuid(null);
            refresh();
            setScreenStack(["motors"]);
          }}
        />
      ) : null}
      {screen === "motor-form" ? (
        <MotorFormScreen motorUuid={selectedMotorUuid || undefined} onNavigate={navigate} onSaved={(uuid) => {
          setSelectedMotorUuid(uuid);
          refresh();
          navigate("motor-detail");
        }} />
      ) : null}
      {screen === "customers" ? (
        <CustomersScreen
          onNavigate={navigate}
          refreshKey={refreshKey}
          onOpen={(uuid) => {
            setSelectedCustomerUuid(uuid);
            navigate("customer-detail");
          }}
        />
      ) : null}
      {screen === "customer-detail" && selectedCustomerUuid ? (
        <CustomerDetailScreen
          customerUuid={selectedCustomerUuid}
          onNavigate={navigate}
          refreshKey={refreshKey}
          onOpenMotor={(uuid) => {
            setSelectedMotorUuid(uuid);
            navigate("motor-detail");
          }}
          onChanged={refresh}
        />
      ) : null}
      {screen === "workers" ? <WorkersScreen onNavigate={navigate} refreshKey={refreshKey} onChanged={refresh} /> : null}
      {screen === "backup" ? <BackupScreen onNavigate={navigate} /> : null}
      {screen === "settings" ? <SettingsScreen onNavigate={navigate} /> : null}
    </>
  );
}

function ActivationScreen({ status, onActivated }: { status: LicenseStatus | null; onActivated: () => Promise<void> }) {
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(status && !status.valid ? status.reason : "");
  const deviceCode = status?.deviceCode || "";

  useEffect(() => {
    setError(status && !status.valid ? status.reason : "");
  }, [status]);

  async function shareDeviceCode() {
    await Share.share({
      message: `Device Code: ${deviceCode}`
    });
  }

  async function activate() {
    if (!licenseKey.trim()) {
      setError("Enter the license key provided by developer.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      await activateLicenseKey(licenseKey);
      await onActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "License could not be activated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.activationSafe}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.activationContent}>
        <View>
          <Text style={styles.activationEyebrow}>Offline activation</Text>
          <Text style={styles.activationTitle}>Activate App</Text>
        </View>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Device license</Text>
          <Text style={styles.problem}>Send this device code to developer to receive a permanent offline license key.</Text>
          <View style={styles.deviceCodeBox}>
            <Text style={styles.infoLabel}>Device Code</Text>
            <Text selectable style={styles.deviceCodeText}>{deviceCode || "Loading device code"}</Text>
          </View>
          <Button onPress={shareDeviceCode}>Share Device Code</Button>
        </View>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Enter license key</Text>
          <TextInput
            value={licenseKey}
            onChangeText={setLicenseKey}
            placeholder="RWND.payload.signature"
            placeholderTextColor={colors.muted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.licenseInput}
          />
          {error ? <Text style={styles.filterError}>{error}</Text> : null}
          <Button variant="primary" disabled={busy} onPress={activate}>{busy ? "Checking" : "Activate"}</Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DashboardScreen({
  onNavigate,
  refreshKey,
  onOpenMotor
}: {
  onNavigate: (screen: ScreenName) => void;
  refreshKey: number;
  onOpenMotor: (uuid: string) => void;
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [attention, setAttention] = useState<MotorWithMedia[]>([]);
  const [shop, setShop] = useState<ShopSettings>({ shopName: "", logoUri: "" });
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<DashboardFilterMode>("All");
  const [filterDate, setFilterDate] = useState(todayIso());
  const [filterMonth, setFilterMonth] = useState(currentMonthIso());
  const [filterStartDate, setFilterStartDate] = useState(todayIso());
  const [filterEndDate, setFilterEndDate] = useState(todayIso());
  const dashboardFilter = useMemo(
    () => dashboardFilterState(filterMode, filterDate, filterMonth, filterStartDate, filterEndDate),
    [filterMode, filterDate, filterMonth, filterStartDate, filterEndDate]
  );

  useEffect(() => {
    getShopSettings().then(setShop);
    if (dashboardFilter.error) {
      setSummary(emptyDashboardSummary());
      setAttention([]);
      return;
    }
    setLoading(true);
    Promise.all([getDashboardSummary(dashboardFilter.range), listDashboardAttention(30, dashboardFilter.range)])
      .then(([nextSummary, nextAttention]) => {
        setSummary(nextSummary);
        setAttention(nextAttention);
      })
      .finally(() => setLoading(false));
  }, [refreshKey, dashboardFilter]);

  const overdueMotors = useMemo(() => attention.filter((motor) => motor.deadlineDate < todayIso() && !["Completed", "Delivered"].includes(motor.status)), [attention]);
  const pendingMotors = useMemo(() => attention.filter((motor) => motor.paymentStatus !== "Paid"), [attention]);

  return (
    <Screen activeTab="dashboard" eyebrow={shop.shopName || "Offline shop app"} title="Dashboard" onNavigate={onNavigate} action={<Button variant="primary" onPress={() => onNavigate("motor-form")}>Add</Button>}>
      {shop.logoUri ? (
        <View style={styles.shopBanner}>
          <Image source={{ uri: shop.logoUri }} style={styles.shopLogo} />
          <View style={styles.body}>
            <Text numberOfLines={1} style={styles.shopName}>{shop.shopName || "Shop details"}</Text>
            <Text style={styles.panelHint}>Offline data on this phone</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => onNavigate("settings")}>
            <Ionicons name="settings" size={18} color={colors.accentDeep} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.filterPanel}>
        <View style={styles.sectionHeader}>
          <View style={styles.body}>
            <Text style={styles.panelTitle}>Dashboard filter</Text>
            <Text style={styles.panelHint}>{dashboardFilter.label}</Text>
          </View>
          <StatusBadge status={filterMode} />
        </View>
        <View style={styles.segmentRow}>
          {(["All", "Today", "Date", "Month", "Range"] as const).map((mode) => (
            <Pressable key={mode} style={[styles.segmentPill, filterMode === mode && styles.segmentPillActive]} onPress={() => setFilterMode(mode)}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.segmentText, filterMode === mode && styles.segmentTextActive]}>{mode}</Text>
            </Pressable>
          ))}
        </View>
        {filterMode === "Date" ? (
          <DatePickerField label="Date" value={filterDate} mode="date" onChange={setFilterDate} />
        ) : null}
        {filterMode === "Month" ? (
          <DatePickerField label="Month" value={filterMonth} mode="month" onChange={setFilterMonth} />
        ) : null}
        {filterMode === "Range" ? (
          <DateRangePickerField startDate={filterStartDate} endDate={filterEndDate} onStartChange={setFilterStartDate} onEndChange={setFilterEndDate} />
        ) : null}
        {dashboardFilter.error ? <Text style={styles.filterError}>{dashboardFilter.error}</Text> : null}
      </View>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <View style={styles.dashboardGrid}>
        <DashboardMetric icon="construct" label="Motors" value={summary?.totalMotors || 0} hint={`${summary?.openRepairs || 0} open`} />
        <DashboardMetric icon="alert-circle" label="Overdue" value={summary?.overdueRepairs || 0} hint="Need attention" tone="danger" />
        <DashboardMetric icon="wallet" label="Pending" value={money(summary?.pendingBalance || 0)} hint={`${summary?.unpaidJobs || 0} unpaid`} tone="warning" />
        <DashboardMetric icon="cash" label="Collected" value={money(summary?.collectedTotal || 0)} hint="On phone" tone="success" />
        <DashboardMetric icon="people" label="Customers" value={summary?.customers || 0} hint="Phone records" />
        <DashboardMetric icon="calendar" label="Workers" value={summary?.totalWorkers || 0} hint="Active staff" />
      </View>
      <DashboardMotorSection title="Needs attention" motors={attention.slice(0, 8)} empty="No pending repair or payment work right now." onOpenMotor={onOpenMotor} />
      <DashboardMotorSection title="Overdue motors" motors={overdueMotors.slice(0, 6)} empty="No overdue motors in this filter." onOpenMotor={onOpenMotor} />
      <DashboardMotorSection title="Pending payment" motors={pendingMotors.slice(0, 6)} empty="No pending payment motors in this filter." onOpenMotor={onOpenMotor} />
    </Screen>
  );
}

function DashboardMetric({
  icon,
  label,
  value,
  hint,
  tone
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  hint: string;
  tone?: "danger" | "warning" | "success";
}) {
  return (
    <View style={[styles.dashboardMetric, tone === "danger" && styles.dashboardMetricDanger, tone === "warning" && styles.dashboardMetricWarning, tone === "success" && styles.dashboardMetricSuccess]}>
      <View style={styles.metricIcon}>
        <Ionicons name={icon} size={17} color={colors.accentDeep} />
      </View>
      <Text numberOfLines={1} style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.metricHint}>{hint}</Text>
    </View>
  );
}

function DashboardMotorSection({ title, motors, empty, onOpenMotor }: { title: string; motors: MotorWithMedia[]; empty: string; onOpenMotor: (uuid: string) => void }) {
  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeader}>
        <Text style={styles.panelTitle}>{title}</Text>
        <StatusBadge status={`${motors.length}`} />
      </View>
      {motors.length ? (
        motors.map((motor) => <DashboardMotorRow key={`${title}-${motor.uuid}`} motor={motor} onOpen={() => onOpenMotor(motor.uuid)} />)
      ) : (
        <Text style={styles.problem}>{empty}</Text>
      )}
    </View>
  );
}

function DashboardMotorRow({ motor, onOpen }: { motor: MotorWithMedia; onOpen: () => void }) {
  const balance = balanceAmount(motor.finalCost, motor.estimatedCost, motor.advancePaid);
  const overdue = motor.deadlineDate < todayIso() && !["Completed", "Delivered"].includes(motor.status);
  return (
    <Pressable style={[styles.attentionRow, overdue && styles.attentionRowDanger]} onPress={onOpen}>
      {motor.media[0]?.mediaType === "image" ? (
        <Image source={{ uri: motor.media[0].uri }} style={styles.attentionThumb} />
      ) : (
        <View style={styles.attentionThumbEmpty}>
          <Ionicons name="construct" size={18} color={colors.accentDeep} />
        </View>
      )}
      <View style={styles.body}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.name}>{motor.customerName}</Text>
        <Text numberOfLines={2} style={styles.mutedText}>{motor.jobNumber} - {motor.motorType}</Text>
        <Text numberOfLines={1} style={styles.panelHint}>{displayDate(motor.deadlineDate)} - {motor.status} - {motor.paymentStatus}</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.66} style={styles.balance}>{money(balance)}</Text>
    </Pressable>
  );
}

function DatePickerField({ label, value, mode, onChange }: { label: string; value: string; mode: PickerMode; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={styles.dateField} onPress={() => setOpen(true)}>
        <View style={styles.body}>
          <Text style={styles.dateFieldLabel}>{label}</Text>
          <Text numberOfLines={1} style={styles.dateFieldValue}>{mode === "month" ? displayMonth(value) : displayDate(value)}</Text>
        </View>
        <Ionicons name="calendar" size={20} color={colors.accentDeep} />
      </Pressable>
      <DatePickerModal
        visible={open}
        mode={mode}
        value={value}
        onClose={() => setOpen(false)}
        onSelect={(nextValue) => {
          onChange(nextValue);
          setOpen(false);
        }}
      />
    </>
  );
}

function DateRangePickerField({
  startDate,
  endDate,
  onStartChange,
  onEndChange
}: {
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={styles.dateField} onPress={() => setOpen(true)}>
        <View style={styles.body}>
          <Text style={styles.dateFieldLabel}>Date Range</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.dateFieldValue}>
            {displayDate(startDate)} to {displayDate(endDate)}
          </Text>
        </View>
        <Ionicons name="calendar" size={20} color={colors.accentDeep} />
      </Pressable>
      <RangePickerModal
        visible={open}
        startDate={startDate}
        endDate={endDate}
        onClose={() => setOpen(false)}
        onApply={(nextStart, nextEnd) => {
          onStartChange(nextStart);
          onEndChange(nextEnd);
          setOpen(false);
        }}
      />
    </>
  );
}

function RangePickerModal({
  visible,
  startDate,
  endDate,
  onApply,
  onClose
}: {
  visible: boolean;
  startDate: string;
  endDate: string;
  onApply: (startDate: string, endDate: string) => void;
  onClose: () => void;
}) {
  const [viewMonth, setViewMonth] = useState(startDate.slice(0, 7));
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const cells = buildDateCalendar(viewMonth);

  useEffect(() => {
    if (visible) {
      setViewMonth(startDate.slice(0, 7));
      setDraftStart(startDate);
      setDraftEnd(endDate);
      setSelectingEnd(false);
    }
  }, [visible, startDate, endDate]);

  function selectDate(date: string) {
    if (!selectingEnd) {
      setDraftStart(date);
      setDraftEnd(date);
      setSelectingEnd(true);
      return;
    }
    if (date < draftStart) {
      setDraftStart(date);
      setDraftEnd(date);
      setSelectingEnd(true);
      return;
    }
    setDraftEnd(date);
    setSelectingEnd(false);
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.actionSheetBackdrop}>
        <View style={styles.datePickerSheet}>
          <View style={styles.datePickerHeader}>
            <Pressable style={styles.monthIconAction} onPress={() => setViewMonth((current) => addMonthsIso(-1, current))}>
              <Ionicons name="chevron-back" size={18} color={colors.accentDeep} />
            </Pressable>
            <View style={styles.body}>
              <Text style={styles.filterCalendarLabel}>{selectingEnd ? "Select end date" : "Select start date"}</Text>
              <Text style={styles.filterCalendarTitle}>{displayMonth(viewMonth)}</Text>
            </View>
            <Pressable style={styles.monthIconAction} onPress={() => setViewMonth((current) => addMonthsIso(1, current))}>
              <Ionicons name="chevron-forward" size={18} color={colors.accentDeep} />
            </Pressable>
          </View>
          <View style={styles.rangeSummary}>
            <Text style={styles.rangeSummaryText}>{displayDate(draftStart)} to {displayDate(draftEnd)}</Text>
          </View>
          <View style={styles.weekHeader}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekDay}>{day}</Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {cells.map((cell) => {
              const isToday = cell.date === todayIso();
              const selectedEdge = cell.date === draftStart || cell.date === draftEnd;
              const inRange = Boolean(cell.date && cell.date > draftStart && cell.date < draftEnd);
              return (
                <Pressable
                  key={cell.key}
                  disabled={!cell.date}
                  style={[
                    styles.filterDayCell,
                    !cell.day && styles.dayCellEmpty,
                    isToday && styles.dayToday,
                    inRange && styles.dayInRange,
                    selectedEdge && styles.filterDaySelected
                  ]}
                  onPress={() => cell.date && selectDate(cell.date)}
                >
                  {cell.day ? <Text style={[styles.dayNumber, (selectedEdge || inRange) && styles.dayNumberMarked]}>{cell.day}</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.datePickerActions}>
            <Pressable style={styles.actionSheetCancel} onPress={onClose}>
              <Text style={styles.actionSheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.actionSheetPrimary} onPress={() => onApply(draftStart, draftEnd)}>
              <Text style={styles.actionSheetPrimaryText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DatePickerModal({
  visible,
  mode,
  value,
  onSelect,
  onClose
}: {
  visible: boolean;
  mode: PickerMode;
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const [viewMonth, setViewMonth] = useState((value || todayIso()).slice(0, 7));
  const cells = buildDateCalendar(viewMonth);
  const year = Number(viewMonth.slice(0, 4));
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  useEffect(() => {
    if (visible) {
      setViewMonth((value || todayIso()).slice(0, 7));
    }
  }, [visible, value]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.actionSheetBackdrop}>
        <View style={styles.datePickerSheet}>
          <View style={styles.datePickerHeader}>
            <Pressable style={styles.monthIconAction} onPress={() => setViewMonth((current) => addMonthsIso(mode === "month" ? -12 : -1, current))}>
              <Ionicons name="chevron-back" size={18} color={colors.accentDeep} />
            </Pressable>
            <View style={styles.body}>
              <Text style={styles.filterCalendarLabel}>{mode === "month" ? "Select year" : "Select date"}</Text>
              <Text style={styles.filterCalendarTitle}>{mode === "month" ? String(year) : displayMonth(viewMonth)}</Text>
            </View>
            <Pressable style={styles.monthIconAction} onPress={() => setViewMonth((current) => addMonthsIso(mode === "month" ? 12 : 1, current))}>
              <Ionicons name="chevron-forward" size={18} color={colors.accentDeep} />
            </Pressable>
          </View>
          {mode === "month" ? (
            <View style={styles.monthPickerGrid}>
              {monthNames.map((name, index) => {
                const nextMonth = `${year}-${String(index + 1).padStart(2, "0")}`;
                const selected = nextMonth === value.slice(0, 7);
                return (
                  <Pressable key={name} style={[styles.monthPickerCell, selected && styles.filterDaySelected]} onPress={() => onSelect(nextMonth)}>
                    <Text style={[styles.monthPickerText, selected && styles.dayNumberMarked]}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <>
              <View style={styles.datePickerQuickRow}>
                <Pressable style={styles.datePickerQuickButton} onPress={() => onSelect(todayIso())}>
                  <Ionicons name="today" size={15} color={colors.accentDeep} />
                  <Text style={styles.datePickerQuickText}>Today</Text>
                </Pressable>
              </View>
              <View style={styles.weekHeader}>
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                  <Text key={`${day}-${index}`} style={styles.weekDay}>{day}</Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {cells.map((cell) => {
                  const selected = cell.date === value;
                  const isToday = cell.date === todayIso();
                  return (
                    <Pressable key={cell.key} disabled={!cell.date} style={[styles.filterDayCell, !cell.day && styles.dayCellEmpty, isToday && styles.dayToday, selected && styles.filterDaySelected]} onPress={() => cell.date && onSelect(cell.date)}>
                      {cell.day ? <Text style={[styles.dayNumber, selected && styles.dayNumberMarked]}>{cell.day}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          <Pressable style={styles.actionSheetCancel} onPress={onClose}>
            <Text style={styles.actionSheetCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MotorsScreen({
  onNavigate,
  refreshKey,
  onOpen,
  onAdd,
  onChanged
}: {
  onNavigate: (screen: ScreenName) => void;
  refreshKey: number;
  onOpen: (uuid: string) => void;
  onAdd: () => void;
  onChanged: () => void;
}) {
  const [motors, setMotors] = useState<MotorWithMedia[]>([]);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<MotorFilterMode>("All");
  const [filterDate, setFilterDate] = useState(todayIso());
  const [filterMonth, setFilterMonth] = useState(currentMonthIso());
  const [filterStartDate, setFilterStartDate] = useState(todayIso());
  const [filterEndDate, setFilterEndDate] = useState(todayIso());
  const [filterStatus, setFilterStatus] = useState<MotorStatusFilter>("All");

  async function load() {
    setMotors(await listMotors(query));
  }

  useEffect(() => {
    load();
  }, [query, refreshKey]);

  const filteredMotors = motors.filter((motor) => {
    if (filterStatus !== "All" && motor.status !== filterStatus) {
      return false;
    }
    if (filterMode === "All") {
      return true;
    }
    const addedDate = motor.dateAdded.slice(0, 10);
    if (filterMode === "Date") {
      return addedDate === filterDate;
    }
    if (filterMode === "Month") {
      return addedDate.startsWith(filterMonth);
    }
    return addedDate >= filterStartDate && addedDate <= filterEndDate;
  });
  const motorFilterLabel = filterMode === "All" ? "All motor jobs" : filterMode === "Date" ? displayDate(filterDate) : filterMode === "Month" ? displayMonth(filterMonth) : `${displayDate(filterStartDate)} to ${displayDate(filterEndDate)}`;

  return (
    <Screen activeTab="motors" eyebrow="Repair operations" title="Motors" onNavigate={onNavigate} action={<Button variant="primary" onPress={onAdd}>Add</Button>}>
      <View style={styles.motorSearchBar}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Job, name or phone"
          placeholderTextColor={colors.muted}
          style={styles.motorSearchInput}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.filterPanel}>
        <View style={styles.sectionHeader}>
          <View style={styles.body}>
            <Text style={styles.panelTitle}>Motor filter</Text>
            <Text style={styles.panelHint}>{motorFilterLabel}</Text>
          </View>
          <StatusBadge status={`${filteredMotors.length} jobs`} />
        </View>
        <SelectField label="Repair status" value={filterStatus} options={["All", ...repairStatuses] as const} onChange={setFilterStatus} />
        <View style={styles.segmentRow}>
          {(["All", "Date", "Month", "Range"] as const).map((mode) => (
            <Pressable key={mode} style={[styles.segmentPill, filterMode === mode && styles.segmentPillActive]} onPress={() => setFilterMode(mode)}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.segmentText, filterMode === mode && styles.segmentTextActive]}>{mode}</Text>
            </Pressable>
          ))}
        </View>
        {filterMode === "Date" ? <DatePickerField label="Date" value={filterDate} mode="date" onChange={setFilterDate} /> : null}
        {filterMode === "Month" ? <DatePickerField label="Month" value={filterMonth} mode="month" onChange={setFilterMonth} /> : null}
        {filterMode === "Range" ? <DateRangePickerField startDate={filterStartDate} endDate={filterEndDate} onStartChange={setFilterStartDate} onEndChange={setFilterEndDate} /> : null}
      </View>
      <View style={styles.list}>
        {filteredMotors.length ? (
          filteredMotors.map((motor) => (
            <MotorCard
              key={motor.uuid}
              motor={motor}
              onOpen={() => onOpen(motor.uuid)}
              onStatus={async (status) => {
                await updateMotorStatus(motor.uuid, status);
                onChanged();
              }}
              onPayment={async (status) => {
                await updateMotorPayment(motor.uuid, status);
                onChanged();
              }}
            />
          ))
        ) : (
          <EmptyState title="No motors found" message="Add a repair job or adjust your search/filter." />
        )}
      </View>
    </Screen>
  );
}

function MotorDetailScreen({
  motorUuid,
  onNavigate,
  onEdit,
  onChanged,
  onDeleted
}: {
  motorUuid: string;
  onNavigate: (screen: ScreenName) => void;
  onEdit: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [motor, setMotor] = useState<MotorWithMedia | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [deletePinOpen, setDeletePinOpen] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    setMotor(await getMotor(motorUuid));
  }

  useEffect(() => {
    load();
  }, [motorUuid]);

  async function addMedia(kind: "gallery" | "camera") {
    if (!motor) {
      return;
    }
    try {
      const media = kind === "gallery" ? await pickMotorMedia(motor.uuid, motor.media.length) : await captureMotorPhoto(motor.uuid, motor.media.length);
      await attachMotorMedia(media);
      await load();
      onChanged();
    } catch (err) {
      Alert.alert("Media failed", err instanceof Error ? err.message : "Could not attach media.");
    }
  }

  async function askDelete() {
    const savedHash = await getSecurityPinHash();
    if (!savedHash) {
      Alert.alert("PIN required", "Set a security PIN in Settings before deleting motor records.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => onNavigate("settings") }
      ]);
      return;
    }
    Alert.alert("Delete motor", "This removes the motor record and its local media from this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: () => setDeletePinOpen(true) }
    ]);
  }

  async function confirmDelete() {
    if (!motor) {
      return;
    }
    const savedHash = await getSecurityPinHash();
    if (!deletePin.trim() || (await hashPin(deletePin)) !== savedHash) {
      Alert.alert("Wrong PIN", "Motor was not deleted.");
      return;
    }
    try {
      setDeleteBusy(true);
      const mediaUris = await deleteMotor(motor.uuid);
      await deleteLocalFiles(mediaUris);
      setDeletePin("");
      setDeletePinOpen(false);
      onDeleted();
    } catch (err) {
      Alert.alert("Delete failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function openMedia(index = 0) {
    if (!motor?.media.length) {
      return;
    }
    setViewerIndex(index);
    setViewerOpen(true);
  }

  if (!motor) {
    return (
      <Screen activeTab="motors" title="Motor" onNavigate={onNavigate}>
        <EmptyState title="Motor not found" message="This record may have been removed." />
      </Screen>
    );
  }

  const repairTotal = repairAmount(motor.finalCost, motor.estimatedCost);
  const balance = balanceAmount(motor.finalCost, motor.estimatedCost, motor.advancePaid);
  const overdue = motor.deadlineDate < todayIso() && !["Completed", "Delivered"].includes(motor.status);
  const customerPhone = normalizePhone(motor.phoneNumber);

  return (
    <Screen activeTab="motors" eyebrow={motor.jobNumber} title={motor.customerName} onNavigate={onNavigate} action={<Button onPress={onEdit}>Edit</Button>}>
      <PinModal
        visible={deletePinOpen}
        title="Delete motor"
        hint="Enter security PIN to delete this motor."
        pin={deletePin}
        busy={deleteBusy}
        confirmLabel="Delete"
        onChange={setDeletePin}
        onCancel={() => {
          setDeletePin("");
          setDeletePinOpen(false);
        }}
        onConfirm={confirmDelete}
      />
      <View style={[styles.jobHeaderCard, overdue && styles.jobHeaderOverdue]}>
        <Pressable style={styles.jobHero} onPress={() => openMedia(0)}>
          {motor.media[0]?.mediaType === "image" ? (
            <Image source={{ uri: motor.media[0].uri }} style={styles.heroImage} />
          ) : motor.media[0]?.mediaType === "video" ? (
            <View style={styles.videoHero}>
              <Ionicons name="play-circle" size={46} color={colors.accentDeep} />
              <Text style={styles.videoHeroTitle}>Video attached</Text>
              <Text style={styles.mutedText}>Tap to view full screen</Text>
            </View>
          ) : (
            <View style={styles.videoHero}>
              <Ionicons name="image" size={42} color={colors.accentDeep} />
              <Text style={styles.videoHeroTitle}>No media yet</Text>
              <Text style={styles.mutedText}>Add a clear motor photo or video</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.jobHeaderBody}>
          <View style={styles.topLine}>
            <Badge label={motor.status} />
            <Badge label={motor.paymentStatus} />
            {overdue ? <Badge label="Overdue" /> : null}
          </View>
          <Text numberOfLines={2} style={styles.jobTitle}>{motor.motorType}</Text>
          <Text numberOfLines={1} style={styles.panelHint}>{motor.jobNumber} - Due {displayDate(motor.deadlineDate)}</Text>
        </View>
      </View>
      <DetailSection title="Customer">
        <DetailRow icon="person" label="Name" value={motor.customerName} />
        <DetailRow icon="call" label="Phone" value={motor.phoneNumber || "No phone"} />
        <View style={styles.detailActionRow}>
          <DetailActionButton icon="call" label="Call" onPress={() => customerPhone && Linking.openURL(`tel:${customerPhone}`)} />
          <DetailActionButton icon="logo-whatsapp" label="WhatsApp" onPress={() => customerPhone && Linking.openURL(`https://wa.me/${customerPhone}`)} />
        </View>
      </DetailSection>
      <DetailSection title="Motor details">
        <DetailRow icon="receipt" label="Job Number" value={motor.jobNumber} />
        <DetailRow icon="construct" label="Motor Type" value={motor.motorType} />
        <DetailRow icon="time" label="Deadline" value={displayDate(motor.deadlineDate)} />
        <DetailRow icon="flag" label="Status" value={motor.status} />
        <View style={styles.problemBox}>
          <Text style={styles.infoLabel}>Problem</Text>
          <Text style={styles.problem}>{motor.problemDescription || "No problem description added."}</Text>
        </View>
      </DetailSection>
      <DetailSection title="Payment">
        <View style={styles.paymentGrid}>
          <PaymentTile label="Estimated" value={money(motor.estimatedCost)} />
          <PaymentTile label="Final" value={money(motor.finalCost)} />
          <PaymentTile label="Advance/Paid" value={money(motor.advancePaid)} tone="success" />
          <PaymentTile label="Balance" value={money(balance)} tone={balance > 0 ? "danger" : "success"} />
        </View>
        <Text style={styles.panelHint}>Repair amount: {money(repairTotal)}</Text>
      </DetailSection>
      <DetailSection title="Actions">
        <View style={styles.detailActionGrid}>
          <DetailActionButton icon="images" label="Add Media" onPress={() => addMedia("gallery")} />
          <DetailActionButton icon="camera" label="Camera" onPress={() => addMedia("camera")} />
          <DetailActionButton icon="create" label="Edit" onPress={onEdit} />
          <DetailActionButton icon="trash" label="Delete" tone="danger" onPress={askDelete} />
        </View>
      </DetailSection>
      <DetailSection title="Media">
        {motor.media.length ? (
          <View style={styles.mediaGrid}>
            {motor.media.map((item, index) => (
              <Pressable key={item.uuid} style={styles.mediaTile} onPress={() => openMedia(index)}>
                {item.mediaType === "image" ? (
                  <Image source={{ uri: item.uri }} style={styles.mediaTileImage} />
                ) : (
                  <View style={styles.mediaTileVideo}>
                    <Ionicons name="play-circle" size={28} color={colors.accentDeep} />
                    <Text style={styles.mediaTileText}>Video</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable style={styles.mediaStrip} onPress={() => addMedia("gallery")}>
            <Ionicons name="images" size={18} color={colors.accentDeep} />
            <Text style={styles.panelHint}>No files attached. Add media for this repair.</Text>
          </Pressable>
        )}
      </DetailSection>
      <MediaViewer visible={viewerOpen} media={motor.media} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
    </Screen>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.detailSection}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>
        <Ionicons name={icon} size={16} color={colors.accentDeep} />
      </View>
      <View style={styles.body}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text numberOfLines={2} style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function PaymentTile({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <View style={[styles.paymentTile, tone === "success" && styles.paymentTileSuccess, tone === "danger" && styles.paymentTileDanger]}>
      <Text numberOfLines={1} style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64} style={styles.paymentTileValue}>{value}</Text>
    </View>
  );
}

function DetailActionButton({
  icon,
  label,
  tone,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "danger";
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.detailActionButton, tone === "danger" && styles.detailActionButtonDanger]} onPress={onPress}>
      <View style={[styles.detailActionIcon, tone === "danger" && styles.detailActionIconDanger]}>
        <Ionicons name={icon} size={19} color={tone === "danger" ? colors.danger : colors.accentDeep} />
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.detailActionText, tone === "danger" && styles.detailActionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function MotorFormScreen({ motorUuid, onNavigate, onSaved }: { motorUuid?: string; onNavigate: (screen: ScreenName) => void; onSaved: (uuid: string) => void }) {
  const [customerName, setCustomerName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [motorType, setMotorType] = useState("");
  const [problemDescription, setProblemDescription] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [finalCost, setFinalCost] = useState("");
  const [advancePaid, setAdvancePaid] = useState("");
  const [deadlineDate, setDeadlineDate] = useState(addDaysIso(2));
  const [status, setStatus] = useState<RepairStatus>("Received");
  const [batchNumber, setBatchNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!motorUuid) {
      return;
    }
    getMotor(motorUuid).then((motor) => {
      if (!motor) {
        return;
      }
      setCustomerName(motor.customerName);
      setPhoneNumber(phoneDigitsForEdit(motor.phoneNumber));
      setMotorType(motor.motorType);
      setProblemDescription(motor.problemDescription);
      setEstimatedCost(String(motor.estimatedCost));
      setFinalCost(String(motor.finalCost));
      setAdvancePaid(String(motor.advancePaid));
      setDeadlineDate(motor.deadlineDate);
      setStatus(motor.status);
      if (motor.batchNumber) {
        setBatchNumber(motor.batchNumber);
      }
    });
  }, [motorUuid]);

  async function submit() {
    if (!customerName.trim() || !phoneNumber.trim() || !motorType.trim()) {
      Alert.alert("Missing details", "Customer name, phone, and motor type are required.");
      return;
    }
    if (phoneNumber.length !== 10) {
      Alert.alert("Invalid phone", "Enter exactly 10 digits for the mobile number.");
      return;
    }
    const uuid = await saveMotor(
      {
        customerName,
        phoneNumber,
        motorType,
        problemDescription,
        estimatedCost: Number(estimatedCost || 0),
        finalCost: Number(finalCost || 0),
        advancePaid: Number(advancePaid || 0),
        status,
        deadlineDate
      },
      motorUuid
    );
    onSaved(uuid);
  }

  return (
    <Screen activeTab="motors" eyebrow={motorUuid ? "Edit repair" : "New repair"} title={motorUuid ? "Edit Motor" : "Add Motor"} onNavigate={onNavigate}>
      <View style={styles.form}>
        {motorUuid && batchNumber ? (
          <Field label="Batch Number" value={String(batchNumber)} editable={false} />
        ) : null}
        <Field label="Customer Name" value={customerName} onChangeText={setCustomerName} />
        <Field label="Phone" value={phoneNumber} onChangeText={(value) => setPhoneNumber(onlyPhoneDigits(value))} keyboardType="phone-pad" maxLength={10} />
        <Field label="Motor" value={motorType} onChangeText={setMotorType} />
        <Field label="Problem" value={problemDescription} onChangeText={setProblemDescription} multiline style={styles.multiline} />
        <Field label="Estimated Cost" value={estimatedCost} onChangeText={setEstimatedCost} keyboardType="numeric" />
        <Field label="Final Cost" value={finalCost} onChangeText={setFinalCost} keyboardType="numeric" />
        <Field label="Advance Paid" value={advancePaid} onChangeText={setAdvancePaid} keyboardType="numeric" />
        <DatePickerField label="Deadline" value={deadlineDate} mode="date" onChange={setDeadlineDate} />
        <SelectField label="Status" value={status} options={repairStatuses} onChange={setStatus} />
        <Button variant="primary" onPress={submit}>Save Motor</Button>
      </View>
    </Screen>
  );
}

function CustomersScreen({ onNavigate, refreshKey, onOpen }: { onNavigate: (screen: ScreenName) => void; refreshKey: number; onOpen: (uuid: string) => void }) {
  const [customers, setCustomers] = useState<Record<string, unknown>[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    listCustomers(query).then(setCustomers);
  }, [query, refreshKey]);

  return (
    <Screen activeTab="customers" eyebrow="Customer desk" title="Customers" onNavigate={onNavigate}>
      <View style={styles.motorSearchBar}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Customer name or phone"
          placeholderTextColor={colors.muted}
          style={styles.motorSearchInput}
          autoCapitalize="words"
          keyboardType="default"
        />
      </View>
      <View style={styles.list}>
        {customers.length ? (
          customers.map((customer) => (
            <Pressable key={String(customer.uuid)} style={styles.row} onPress={() => onOpen(String(customer.uuid))}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{String(customer.name).slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.body}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.name}>{String(customer.name)}</Text>
                <Text numberOfLines={2} style={styles.mutedText}>{String(customer.phone_number)} - {Number(customer.motor_count || 0)} motors</Text>
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={styles.balance}>{money(Number(customer.balance_due || 0))}</Text>
            </Pressable>
          ))
        ) : (
          <EmptyState title={query.trim() ? "No customers found" : "No customers yet"} message={query.trim() ? "Try a different customer name or phone number." : "Customers are created automatically when motors are added."} />
        )}
      </View>
    </Screen>
  );
}

function CustomerDetailScreen({
  customerUuid,
  onNavigate,
  refreshKey,
  onOpenMotor,
  onChanged
}: {
  customerUuid: string;
  onNavigate: (screen: ScreenName) => void;
  refreshKey: number;
  onOpenMotor: (uuid: string) => void;
  onChanged: () => void;
}) {
  const [motors, setMotors] = useState<MotorWithMedia[]>([]);
  useEffect(() => {
    listMotors().then(setMotors);
  }, [refreshKey]);
  const customerMotors = useMemo(() => motors.filter((motor) => motor.customerUuid === customerUuid), [motors, customerUuid]);
  const customer = customerMotors[0];

  return (
    <Screen activeTab="customers" eyebrow="Customer record" title={customer?.customerName || "Customer"} onNavigate={onNavigate}>
      <View style={styles.summary}>
        <StatTile label="Motors" value={customerMotors.length} hint="For customer" />
        <StatTile label="Balance" value={money(customerMotors.reduce((total, motor) => total + balanceAmount(motor.finalCost, motor.estimatedCost, motor.advancePaid), 0))} hint="Due total" />
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>All customer motors</Text>
        <Text style={styles.problem}>Every motor saved under this customer's phone number appears here.</Text>
      </View>
      <View style={styles.list}>
        {customerMotors.length ? (
          customerMotors.map((motor) => (
            <MotorCard
              key={motor.uuid}
              motor={motor}
              onOpen={() => onOpenMotor(motor.uuid)}
              onStatus={async (status) => {
                await updateMotorStatus(motor.uuid, status);
                onChanged();
              }}
              onPayment={async (status) => {
                await updateMotorPayment(motor.uuid, status);
                onChanged();
              }}
            />
          ))
        ) : (
          <EmptyState title="No motors found" message="This customer does not have jobs on this phone yet." />
        )}
      </View>
    </Screen>
  );
}

function WorkersScreen({ onNavigate, refreshKey, onChanged }: { onNavigate: (screen: ScreenName) => void; refreshKey: number; onChanged: () => void }) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [monthAttendance, setMonthAttendance] = useState<WorkerAttendanceRow[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<WorkerSalaryPayment[]>([]);
  const [reportMonth, setReportMonth] = useState(currentMonthIso());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Repair Technician");
  const [salary, setSalary] = useState("");
  const [salaryPaymentAmount, setSalaryPaymentAmount] = useState("");
  const [salaryPaymentDate, setSalaryPaymentDate] = useState(todayIso());
  const [salaryPaymentType, setSalaryPaymentType] = useState<"Advance" | "Paid">("Advance");
  const [salaryPaymentNote, setSalaryPaymentNote] = useState("");
  const [selectedWorkerUuid, setSelectedWorkerUuid] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<{ workerUuid: string; workerName: string; date: string; status?: AttendanceStatus } | null>(null);

  async function load() {
    setWorkers(await listWorkers());
    setMonthAttendance(await listAttendanceForMonth(reportMonth));
    setSalaryPayments(await listWorkerSalaryPaymentsForMonth(reportMonth));
  }

  useEffect(() => {
    load();
  }, [refreshKey, reportMonth]);

  async function addWorker() {
    if (!name.trim()) {
      Alert.alert("Missing name", "Worker name is required.");
      return;
    }
    if (phone.trim() && phone.length !== 10) {
      Alert.alert("Invalid phone", "Enter exactly 10 digits for the mobile number.");
      return;
    }
    await saveWorker({ name, phoneNumber: phone, role, monthlySalary: Number(salary || 0) });
    setName("");
    setPhone("");
    setSalary("");
    await load();
    onChanged();
  }

  async function setCalendarAttendance(workerUuid: string, date: string, status: AttendanceStatus) {
    try {
      await markAttendance(workerUuid, status, date);
      const worker = workers.find((item) => item.uuid === workerUuid);
      const optimisticRow: WorkerAttendanceRow | null = worker
        ? {
            uuid: `${workerUuid}-${date}`,
            workerUuid,
            workDate: date,
            status,
            note: "",
            deviceId: "",
            syncStatus: "local",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            workerName: worker.name,
            workerRole: worker.role,
            phoneNumber: worker.phoneNumber
          }
        : null;
      const savedRows = await listAttendanceForMonth(date.slice(0, 7));
      const nextRows =
        savedRows.some((item) => item.workerUuid === workerUuid && item.workDate === date)
          ? savedRows.map((item) => (item.workerUuid === workerUuid && item.workDate === date ? { ...item, status } : item))
          : optimisticRow
            ? [optimisticRow, ...savedRows]
            : savedRows;
      setSelectedCalendarDate(null);
      setReportMonth(date.slice(0, 7));
      setMonthAttendance(nextRows);
      onChanged();
    } catch (err) {
      Alert.alert("Attendance not saved", err instanceof Error ? err.message : "Please try again.");
    }
  }

  async function addSalaryPayment(workerUuid: string) {
    const amount = Number(salaryPaymentAmount || 0);
    if (!amount || amount <= 0) {
      Alert.alert("Missing amount", "Enter salary advance or paid money for this worker.");
      return;
    }
    try {
      await saveWorkerSalaryPayment(workerUuid, amount, salaryPaymentDate || todayIso(), salaryPaymentNote.trim(), salaryPaymentType);
      setSalaryPaymentAmount("");
      setSalaryPaymentNote("");
      setSalaryPayments(await listWorkerSalaryPaymentsForMonth((salaryPaymentDate || todayIso()).slice(0, 7)));
      setReportMonth((salaryPaymentDate || todayIso()).slice(0, 7));
      onChanged();
    } catch (err) {
      Alert.alert("Salary not saved", err instanceof Error ? err.message : "Please try again.");
    }
  }

  function openCalendarAttendance(workerUuid: string, workerName: string, date: string, currentStatus?: AttendanceStatus) {
    setSelectedCalendarDate({ workerUuid, workerName, date, status: currentStatus });
  }

  const monthPresent = monthAttendance.filter((item) => item.status === "Present").length;
  const monthLeave = monthAttendance.filter((item) => item.status === "Leave").length;
  const monthAbsent = monthAttendance.filter((item) => item.status === "Absent").length;
  const [reportYear, reportMonthNumber] = reportMonth.split("-").map(Number);
  const daysInReportMonth = new Date(reportYear, reportMonthNumber, 0).getDate();
  const possibleMonthRecords = workers.length * daysInReportMonth;
  const monthUnmarked = Math.max(possibleMonthRecords - monthAttendance.length, 0);
  const totalMonthlySalary = workers.reduce((total, worker) => total + worker.monthlySalary, 0);
  const monthByWorker = workers.map((worker) => {
    const records = monthAttendance.filter((item) => item.workerUuid === worker.uuid);
    const present = records.filter((item) => item.status === "Present").length;
    const leave = records.filter((item) => item.status === "Leave").length;
    const absent = records.filter((item) => item.status === "Absent").length;
    const paidDays = present;
    const deductedDays = absent + leave;
    const daySalary = daysInReportMonth ? worker.monthlySalary / daysInReportMonth : 0;
    const payableSalary = Math.round(daySalary * paidDays);
    const deductionSalary = Math.round(daySalary * deductedDays);
    const unmarkedSalary = Math.max(worker.monthlySalary - payableSalary - deductionSalary, 0);
    const salaryPaid = salaryPayments.filter((item) => item.workerUuid === worker.uuid).reduce((total, item) => total + item.amount, 0);
    const salaryBalance = payableSalary - salaryPaid;
    return {
      worker,
      present,
      leave,
      absent,
      payableSalary,
      deductionSalary,
      unmarkedSalary,
      salaryPaid,
      salaryBalance,
      records,
      payments: salaryPayments.filter((item) => item.workerUuid === worker.uuid),
      calendar: buildAttendanceCalendar(reportMonth, records)
    };
  });
  const totalPayableSalary = monthByWorker.reduce((total, item) => total + item.payableSalary, 0);
  const totalDeductionSalary = monthByWorker.reduce((total, item) => total + item.deductionSalary, 0);
  const totalSalaryPaid = monthByWorker.reduce((total, item) => total + item.salaryPaid, 0);
  const totalSalaryBalance = monthByWorker.reduce((total, item) => total + item.salaryBalance, 0);
  const selectedWorkerReport = monthByWorker.find((item) => item.worker.uuid === selectedWorkerUuid);

  if (selectedWorkerReport) {
    const { worker, present, leave, absent, payableSalary, deductionSalary, salaryPaid, salaryBalance, payments, records, calendar } = selectedWorkerReport;
    const workerPhone = normalizePhone(worker.phoneNumber);
    return (
      <Screen activeTab="workers" eyebrow="Worker details" title={worker.name} onNavigate={onNavigate} action={<Button onPress={() => setSelectedWorkerUuid(null)}>Back</Button>}>
        <Modal transparent visible={Boolean(selectedCalendarDate)} animationType="fade" onRequestClose={() => setSelectedCalendarDate(null)}>
          <View style={styles.actionSheetBackdrop}>
            <View style={styles.actionSheet}>
              <Text numberOfLines={1} style={styles.actionSheetTitle}>{selectedCalendarDate?.workerName}</Text>
              <Text style={styles.actionSheetHint}>{selectedCalendarDate?.date} - {selectedCalendarDate?.status || "Unmarked"}</Text>
              <View style={styles.actionSheetButtons}>
                <AttendanceActionButton label="P" title="Present" tone="present" onPress={() => selectedCalendarDate && setCalendarAttendance(selectedCalendarDate.workerUuid, selectedCalendarDate.date, "Present")} />
                <AttendanceActionButton label="A" title="Absent" tone="absent" onPress={() => selectedCalendarDate && setCalendarAttendance(selectedCalendarDate.workerUuid, selectedCalendarDate.date, "Absent")} />
                <AttendanceActionButton label="L" title="Leave" tone="leave" onPress={() => selectedCalendarDate && setCalendarAttendance(selectedCalendarDate.workerUuid, selectedCalendarDate.date, "Leave")} />
              </View>
              <Pressable style={styles.actionSheetCancel} onPress={() => setSelectedCalendarDate(null)}>
                <Text style={styles.actionSheetCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        <View style={[styles.workerHero, styles.workerDetailHero]}>
          <View style={styles.workerDetailTop}>
            <View style={styles.workerAvatarLarge}>
              <Text style={styles.workerAvatarLargeText}>{worker.name.trim().slice(0, 1).toUpperCase() || "W"}</Text>
            </View>
            <View style={styles.workerDetailInfo}>
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.workerHeroLabel}>{worker.role}</Text>
              <Text numberOfLines={1} style={styles.panelHint}>{worker.phoneNumber || "No phone"}</Text>
            </View>
            <View style={styles.workerSalaryPill}>
              <Text style={styles.salaryMetricLabel}>Monthly</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={styles.workerSalary}>{money(worker.monthlySalary)}</Text>
            </View>
          </View>
          <WorkerCallButton phone={workerPhone} size="large" />
        </View>
        <View style={[styles.panel, styles.calendarPanel]}>
          <View style={styles.sectionHeader}>
            <View style={styles.body}>
              <Text style={styles.panelTitle}>Attendance calendar</Text>
              <Text style={styles.panelHint}>Tap any date, then choose P, A, or L.</Text>
            </View>
          </View>
          <MonthSwitcher
            month={reportMonth}
            onPrev={() => setReportMonth((current) => addMonthsIso(-1, current))}
            onNext={() => setReportMonth((current) => addMonthsIso(1, current))}
            onThis={() => setReportMonth(currentMonthIso())}
            onLast={() => setReportMonth(addMonthsIso(-1))}
          />
          <View style={styles.monthStats}>
            <Text style={[styles.monthStat, styles.monthStatPresent]}>P {present}</Text>
            <Text style={[styles.monthStat, styles.monthStatLeave]}>L {leave}</Text>
            <Text style={[styles.monthStat, styles.monthStatAbsent]}>A {absent}</Text>
            <Text style={styles.monthStat}>{records.length} days</Text>
          </View>
          <View style={styles.workerSalaryStatus}>
            <SalaryMetric label="Payable" value={money(payableSalary)} tone="present" compact />
            <SalaryMetric label="Deduct" value={money(deductionSalary)} tone="absent" compact />
            <SalaryMetric label="Advance/Paid" value={money(salaryPaid)} tone="present" compact />
            <SalaryMetric label={salaryBalanceLabel(salaryBalance)} value={money(salaryBalance)} tone={salaryBalanceTone(salaryBalance)} compact />
          </View>
          <AttendanceCalendar
            cells={calendar}
            selectedDate={selectedCalendarDate?.workerUuid === worker.uuid ? selectedCalendarDate.date : null}
            onSelectDate={(date, status) => openCalendarAttendance(worker.uuid, worker.name, date, status)}
            onMarkDate={(date, status) => setCalendarAttendance(worker.uuid, date, status)}
          />
        </View>
        <View style={[styles.panel, styles.salaryPaymentPanel]}>
          <View style={styles.sectionHeader}>
            <View style={styles.body}>
              <Text style={styles.panelTitle}>Salary advance</Text>
              <Text style={styles.panelHint}>Manual money taken by this worker in {displayMonth(reportMonth)}.</Text>
            </View>
            <View style={[styles.salaryBalanceBadge, salaryBalance < 0 && styles.salaryBalanceExtraBadge]}>
              <Text style={styles.salaryMetricLabel}>{salaryBalanceLabel(salaryBalance)}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.66} style={styles.workerSalary}>{money(salaryBalance)}</Text>
            </View>
          </View>
          <View style={styles.compactFormGrid}>
            <SelectField label="Type" value={salaryPaymentType} options={["Advance", "Paid"]} onChange={(value) => setSalaryPaymentType(value as "Advance" | "Paid")} />
            <Field label="Amount" value={salaryPaymentAmount} onChangeText={setSalaryPaymentAmount} keyboardType="numeric" />
            <DatePickerField label="Date" value={salaryPaymentDate} mode="date" onChange={setSalaryPaymentDate} />
            <Field label="Note" value={salaryPaymentNote} onChangeText={setSalaryPaymentNote} />
          </View>
          <Button variant="primary" onPress={() => addSalaryPayment(worker.uuid)}>Add Worker Payment</Button>
          <View style={styles.salaryPaymentList}>
            {payments.length ? (
              payments.map((payment) => (
                <View key={payment.uuid} style={styles.salaryPaymentRow}>
                  <View style={styles.body}>
                    <Text style={styles.salaryPaymentAmount}>{money(payment.amount)}</Text>
                    <Text numberOfLines={1} style={styles.panelHint}>{payment.paymentType}{payment.note ? ` - ${payment.note}` : ""}</Text>
                  </View>
                  <Text style={styles.salaryPaymentDate}>{displayDate(payment.paymentDate)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.panelHint}>No salary advance added this month.</Text>
            )}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen activeTab="workers" eyebrow="Attendance" title="Workers" onNavigate={onNavigate}>
      <View style={[styles.workerHero, styles.workerListHero]}>
        <View style={styles.workerHeroIcon}>
          <Ionicons name="people" size={24} color={colors.white} />
        </View>
        <View style={styles.body}>
          <Text style={styles.workerHeroLabel}>Worker list</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.76} style={styles.workerHeroDate}>{workers.length} workers</Text>
          <Text style={styles.panelHint}>{displayMonth(reportMonth)} salary and attendance.</Text>
        </View>
      </View>

      <View style={[styles.panel, styles.workerListPanel]}>
        <View style={styles.sectionHeader}>
          <View style={styles.body}>
            <Text style={styles.panelTitle}>Monthly payroll</Text>
            <Text style={styles.panelHint}>Select a worker to mark attendance or add advance.</Text>
          </View>
        </View>
        <MonthSwitcher
          month={reportMonth}
          onPrev={() => setReportMonth((current) => addMonthsIso(-1, current))}
          onNext={() => setReportMonth((current) => addMonthsIso(1, current))}
          onThis={() => setReportMonth(currentMonthIso())}
          onLast={() => setReportMonth(addMonthsIso(-1))}
        />
        <View style={styles.salarySummary}>
          <SalaryMetric label="Month salary" value={money(totalMonthlySalary)} />
          <SalaryMetric label="Payable" value={money(totalPayableSalary)} tone="present" />
          <SalaryMetric label="Deduction" value={money(totalDeductionSalary)} tone="absent" />
          <SalaryMetric label="Advance/Paid" value={money(totalSalaryPaid)} tone="present" />
          <SalaryMetric label={salaryBalanceLabel(totalSalaryBalance)} value={money(totalSalaryBalance)} tone={salaryBalanceTone(totalSalaryBalance)} />
        </View>
        <View style={styles.monthTotals}>
          <AttendanceMetric label="Present" value={monthPresent} tone="present" compact />
          <AttendanceMetric label="Leave" value={monthLeave} tone="leave" compact />
          <AttendanceMetric label="Absent" value={monthAbsent} tone="absent" compact />
          <AttendanceMetric label="Unmarked" value={monthUnmarked} tone="unmarked" compact />
        </View>
        <View style={styles.monthList}>
          {monthByWorker.length ? (
            monthByWorker.map(({ worker, present, leave, absent, payableSalary, deductionSalary, salaryPaid, salaryBalance, records }) => (
              <Pressable key={worker.uuid} style={styles.monthWorker} onPress={() => setSelectedWorkerUuid(worker.uuid)}>
                <View style={styles.workerTop}>
                  <View style={styles.workerAvatar}>
                    <Text style={styles.workerAvatarText}>{worker.name.trim().slice(0, 1).toUpperCase() || "W"}</Text>
                  </View>
                  <View style={styles.workerInfo}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.name}>{worker.name}</Text>
                    <Text numberOfLines={1} style={styles.mutedText}>{worker.role} - {worker.phoneNumber || "No phone"}</Text>
                  </View>
                  <View style={styles.workerMetaRight}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} style={styles.workerSalary}>{money(worker.monthlySalary)}</Text>
                    <StatusBadge status={`${records.length} days`} />
                  </View>
                </View>
                <View style={styles.monthStats}>
                  <Text style={[styles.monthStat, styles.monthStatPresent]}>P {present}</Text>
                  <Text style={[styles.monthStat, styles.monthStatLeave]}>L {leave}</Text>
                  <Text style={[styles.monthStat, styles.monthStatAbsent]}>A {absent}</Text>
                </View>
                <View style={styles.workerSalaryStatus}>
                  <SalaryMetric label="Payable" value={money(payableSalary)} tone="present" compact />
                  <SalaryMetric label="Deduct" value={money(deductionSalary)} tone="absent" compact />
                  <SalaryMetric label="Advance" value={money(salaryPaid)} tone="present" compact />
                  <SalaryMetric label={salaryBalanceLabel(salaryBalance)} value={money(salaryBalance)} tone={salaryBalanceTone(salaryBalance)} compact />
                </View>
                <View style={styles.workerOpenRow}>
                  <Text style={styles.workerOpenText}>Open details and attendance</Text>
                  <WorkerCallButton phone={normalizePhone(worker.phoneNumber)} />
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>
              </Pressable>
            ))
          ) : (
            <EmptyState title="No workers yet" message="Add a worker below, then mark attendance from the calendar." />
          )}
        </View>
      </View>
      <View style={[styles.form, styles.addWorkerForm]}>
        <Text style={styles.panelTitle}>Add worker</Text>
        <View style={styles.compactFormGrid}>
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Phone" value={phone} onChangeText={(value) => setPhone(onlyPhoneDigits(value))} keyboardType="phone-pad" maxLength={10} />
          <Field label="Role" value={role} onChangeText={setRole} />
          <Field label="Monthly Salary" value={salary} onChangeText={setSalary} keyboardType="numeric" />
        </View>
        <Button variant="primary" onPress={addWorker}>Add Worker</Button>
      </View>
    </Screen>
  );
}

function WorkerCallButton({ phone, size = "compact" }: { phone: string; size?: "compact" | "large" }) {
  const disabled = !phone;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.workerCallButton,
        size === "large" && styles.workerCallButtonLarge,
        disabled && styles.workerCallButtonDisabled,
        pressed && !disabled && styles.pressed
      ]}
      onPress={(event) => {
        event.stopPropagation();
        void callPhone(phone);
      }}
    >
      <Ionicons name="call" size={size === "large" ? 18 : 16} color={disabled ? colors.muted : colors.white} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.workerCallText, disabled && styles.workerCallTextDisabled]}>
        {size === "large" ? "Call Worker" : "Call"}
      </Text>
    </Pressable>
  );
}

async function callPhone(phone: string) {
  if (!phone) {
    return;
  }

  try {
    await Linking.openURL(`tel:${phone}`);
  } catch {
    Alert.alert("Call failed", "Could not open the phone dialer for this worker.");
  }
}

function normalizePhone(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

function onlyPhoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function phoneDigitsForEdit(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

type CalendarCell = {
  key: string;
  day: number | null;
  date?: string;
  status?: AttendanceStatus;
};

function MonthSwitcher({ month, onPrev, onNext, onThis, onLast }: { month: string; onPrev: () => void; onNext: () => void; onThis: () => void; onLast: () => void }) {
  return (
    <View style={styles.monthSwitcher}>
      <Pressable style={styles.monthIconAction} hitSlop={8} onPress={onPrev}>
        <Ionicons name="chevron-back" size={18} color={colors.accentDeep} />
      </Pressable>
      <View style={styles.monthTitleWrap}>
        <Text style={styles.monthSwitcherLabel}>Selected month</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.monthSwitcherTitle}>{displayMonth(month)}</Text>
      </View>
      <Pressable style={styles.monthIconAction} hitSlop={8} onPress={onNext}>
        <Ionicons name="chevron-forward" size={18} color={colors.accentDeep} />
      </Pressable>
      <View style={styles.monthQuickActions}>
        <Pressable style={styles.monthAction} onPress={onThis}>
          <Text style={styles.monthActionText}>This</Text>
        </Pressable>
        <Pressable style={styles.monthAction} onPress={onLast}>
          <Text style={styles.monthActionText}>Last</Text>
        </Pressable>
      </View>
    </View>
  );
}

function buildAttendanceCalendar(month: string, records: WorkerAttendanceRow[]): CalendarCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const leadingEmpty = firstDay.getDay();
  const byDay = new Map(records.map((record) => [Number(record.workDate.slice(8)), record.status]));
  const cells: CalendarCell[] = [];

  for (let index = 0; index < leadingEmpty; index += 1) {
    cells.push({ key: `empty-start-${index}`, day: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ key: `day-${day}`, day, date, status: byDay.get(day) });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-end-${cells.length}`, day: null });
  }
  return cells;
}

function buildDateCalendar(month: string): CalendarCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const leadingEmpty = firstDay.getDay();
  const cells: CalendarCell[] = [];

  for (let index = 0; index < leadingEmpty; index += 1) {
    cells.push({ key: `empty-start-${index}`, day: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ key: `date-${day}`, day, date });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-end-${cells.length}`, day: null });
  }
  return cells;
}

function AttendanceCalendar({
  cells,
  selectedDate,
  onSelectDate,
  onMarkDate
}: {
  cells: CalendarCell[];
  selectedDate: string | null;
  onSelectDate: (date: string, status?: AttendanceStatus) => void;
  onMarkDate: (date: string, status: AttendanceStatus) => void;
}) {
  const weekDays = ["S", "M", "T", "W", "T", "F", "S"];
  const selectedCell = cells.find((cell) => cell.date === selectedDate);
  return (
    <View style={styles.calendar}>
      <View style={styles.weekHeader}>
        {weekDays.map((day, index) => (
          <Text key={`${day}-${index}`} style={styles.weekDay}>{day}</Text>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((cell) => (
          <Pressable
            key={cell.key}
            disabled={!cell.date}
            style={[
              styles.dayCell,
              !cell.day && styles.dayCellEmpty,
              cell.status === "Present" && styles.dayPresent,
              cell.status === "Leave" && styles.dayLeave,
              cell.status === "Absent" && styles.dayAbsent,
              cell.date === selectedDate && styles.daySelected
            ]}
            onPress={() => cell.date && onSelectDate(cell.date, cell.status)}
          >
            {cell.day ? (
              <>
                <Text style={[styles.dayNumber, cell.status && styles.dayNumberMarked]}>{cell.day}</Text>
                <Text style={[styles.dayStatus, cell.status && styles.dayStatusMarked]}>{cell.status ? cell.status.slice(0, 1) : "-"}</Text>
              </>
            ) : null}
          </Pressable>
        ))}
      </View>
      {selectedDate && selectedCell ? (
        <View style={styles.quickMark}>
          <View style={styles.quickMarkTextWrap}>
            <Text style={styles.quickMarkLabel}>Set {selectedCell.day}</Text>
            <Text numberOfLines={1} style={styles.quickMarkHint}>{selectedCell.status || "Unmarked"}</Text>
          </View>
          <View style={styles.quickMarkActions}>
            <QuickMarkButton label="P" tone="present" onPress={() => onMarkDate(selectedDate, "Present")} />
            <QuickMarkButton label="A" tone="absent" onPress={() => onMarkDate(selectedDate, "Absent")} />
            <QuickMarkButton label="L" tone="leave" onPress={() => onMarkDate(selectedDate, "Leave")} />
          </View>
        </View>
      ) : null}
      <View style={styles.legend}>
        <LegendDot label="Present" color={colors.success} />
        <LegendDot label="Leave" color={colors.warning} />
        <LegendDot label="Absent" color={colors.danger} />
      </View>
    </View>
  );
}

function QuickMarkButton({ label, tone, onPress }: { label: string; tone: "present" | "absent" | "leave"; onPress: () => void }) {
  return (
    <Pressable hitSlop={8} android_ripple={{ color: "rgba(20,24,36,0.08)", borderless: false }} style={[styles.quickMarkButton, tone === "present" && styles.quickMarkPresent, tone === "absent" && styles.quickMarkAbsent, tone === "leave" && styles.quickMarkLeave]} onPress={onPress}>
      <Text style={styles.quickMarkButtonText}>{label}</Text>
    </Pressable>
  );
}

function AttendanceActionButton({ label, title, tone, onPress }: { label: string; title: string; tone: "present" | "absent" | "leave"; onPress: () => void }) {
  return (
    <Pressable style={[styles.attendanceActionButton, tone === "present" && styles.quickMarkPresent, tone === "absent" && styles.quickMarkAbsent, tone === "leave" && styles.quickMarkLeave]} onPress={onPress}>
      <Text style={styles.attendanceActionLetter}>{label}</Text>
      <Text style={styles.attendanceActionTitle}>{title}</Text>
    </Pressable>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function AttendanceMetric({ label, value, tone, compact }: { label: string; value: string | number; tone: "present" | "leave" | "absent" | "unmarked"; compact?: boolean }) {
  return (
    <View style={[styles.attendanceMetric, compact && styles.attendanceMetricCompact, tone === "present" && styles.metricPresent, tone === "leave" && styles.metricLeave, tone === "absent" && styles.metricAbsent]}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.attendanceMetricLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={styles.attendanceMetricValue}>{value}</Text>
    </View>
  );
}

function salaryBalanceLabel(balance: number) {
  if (balance < 0) {
    return "Advance extra";
  }
  if (balance > 0) {
    return "To pay";
  }
  return "Settled";
}

function salaryBalanceTone(balance: number): "present" | "absent" | "warning" {
  if (balance < 0) {
    return "warning";
  }
  if (balance === 0) {
    return "present";
  }
  return "absent";
}

function SalaryMetric({ label, value, tone, compact }: { label: string; value: string; tone?: "present" | "absent" | "warning"; compact?: boolean }) {
  return (
    <View style={[styles.salaryMetric, compact && styles.salaryMetricCompact, tone === "present" && styles.salaryMetricPresent, tone === "absent" && styles.salaryMetricAbsent, tone === "warning" && styles.salaryMetricWarning]}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.salaryMetricLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62} style={styles.salaryMetricValue}>{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "Present" ? styles.statusPresent : status === "Leave" ? styles.statusLeave : status === "Absent" ? styles.statusAbsent : styles.statusNeutral;
  return (
    <View style={[styles.statusBadge, tone]}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.statusBadgeText}>{status}</Text>
    </View>
  );
}

function weekRangeIso(dateIso: string) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(year || 2000, (month || 1) - 1, day || 1);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: toLocalIsoDate(start),
    end: toLocalIsoDate(end)
  };
}

function dashboardFilterState(
  mode: DashboardFilterMode,
  dateValue: string,
  monthValue: string,
  startDateValue: string,
  endDateValue: string
): { range?: BackupRange; label: string; error?: string } {
  if (mode === "All") {
    return { label: "Showing all phone records" };
  }
  if (mode === "Today") {
    const today = todayIso();
    return { range: { startDate: today, endDate: today }, label: "Today" };
  }
  if (mode === "Date") {
    const date = dateValue.trim();
    if (!isValidIsoDate(date)) {
      return { label: "Enter date as YYYY-MM-DD", error: "Invalid date. Use a real date like 2026-05-08." };
    }
    return { range: { startDate: date, endDate: date }, label: displayDate(date) };
  }
  if (mode === "Month") {
    const month = monthValue.trim();
    if (!isValidIsoMonth(month)) {
      return { label: "Enter month as YYYY-MM", error: "Invalid month. Use a real month like 2026-05." };
    }
    const [year, monthNumber] = month.split("-").map(Number);
    const endDay = new Date(year, monthNumber, 0).getDate();
    return {
      range: { startDate: `${month}-01`, endDate: `${month}-${String(endDay).padStart(2, "0")}` },
      label: displayMonth(month)
    };
  }
  const startDate = startDateValue.trim();
  const endDate = endDateValue.trim();
  try {
    const range = validateRange(startDate, endDate);
    return { range, label: `${displayDate(range.startDate)} to ${displayDate(range.endDate)}` };
  } catch (err) {
    return {
      label: "Enter start and end date",
      error: err instanceof Error ? err.message : "Invalid date range."
    };
  }
}

function emptyDashboardSummary(): DashboardSummary {
  return {
    totalMotors: 0,
    openRepairs: 0,
    completedRepairs: 0,
    overdueRepairs: 0,
    unpaidJobs: 0,
    collectedTotal: 0,
    pendingBalance: 0,
    totalWorkers: 0,
    customers: 0
  };
}

function toLocalIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function BackupScreen({ onNavigate }: { onNavigate: (screen: ScreenName) => void }) {
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());

  async function exportBackup(range?: BackupRange) {
    try {
      setBusy(true);
      const backup = await sharePhoneBackup(range);
      setManifest(backup.manifest);
      Alert.alert("Backup ready", "ZIP backup was created. Keep it safe or import it on a new phone.");
    } catch (err) {
      Alert.alert("Backup failed", err instanceof Error ? err.message : "Could not create backup.");
    } finally {
      setBusy(false);
    }
  }

  async function importBackup() {
    try {
      setImportBusy(true);
      const result = await importLatestBackupFromPickedFolder();
      setManifest(result.manifest);
      Alert.alert("Import complete", formatImportStats(result.stats));
    } catch (err) {
      Alert.alert("Import failed", err instanceof Error ? err.message : "Could not import backup.");
    } finally {
      setImportBusy(false);
    }
  }

  function exportDateBackup() {
    try {
      void exportBackup(validateRange(startDate, endDate));
    } catch (err) {
      Alert.alert("Invalid date range", err instanceof Error ? err.message : "Please check the dates.");
    }
  }

  return (
    <Screen activeTab="settings" eyebrow="Offline export" title="Phone Backup" onNavigate={onNavigate} action={<Button onPress={() => onNavigate("settings")}>Settings</Button>}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Export phone data</Text>
        <Text style={styles.problem}>Creates a ZIP with selected records, related uploads, and backup_manifest.json.</Text>
        <DateRangePickerField startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
        <View style={styles.actions}>
          <Button variant="primary" disabled={busy} onPress={exportDateBackup}>{busy ? "Creating" : "Date Backup"}</Button>
          <Button disabled={busy} onPress={() => exportBackup()}>{busy ? "Creating" : "Full Backup"}</Button>
        </View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Import backup</Text>
        <Text style={styles.problem}>Pick the folder that contains your backup ZIP. The newest ZIP in that folder will be merged into this phone.</Text>
        <Button variant="primary" disabled={importBusy} onPress={importBackup}>{importBusy ? "Importing" : "Import ZIP"}</Button>
      </View>
      {manifest ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Last manifest</Text>
          <Text style={styles.problem}>Source: {manifest.deviceId || manifest.platform || "Backup file"}</Text>
          <Text style={styles.problem}>Motors: {manifest.counts.motors}</Text>
          <Text style={styles.problem}>Customers: {manifest.counts.customers}</Text>
          <Text style={styles.problem}>Workers: {manifest.counts.workers}</Text>
          <Text style={styles.problem}>Attendance: {manifest.counts.attendance}</Text>
          <Text style={styles.problem}>Salary payments: {manifest.counts.salaryPayments}</Text>
          <Text style={styles.problem}>Media: {manifest.counts.media}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function SettingsScreen({ onNavigate }: { onNavigate: (screen: ScreenName) => void }) {
  const [shopName, setShopName] = useState("");
  const [logoUri, setLogoUri] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  async function load() {
    const settings = await getShopSettings();
    setShopName(settings.shopName);
    setLogoUri(settings.logoUri);
    setHasPin(Boolean(await getSecurityPinHash()));
    setLicense(await getLicenseStatus());
  }

  useEffect(() => {
    load();
  }, []);

  async function saveShop() {
    try {
      await saveShopSettings({ shopName, logoUri });
      Alert.alert("Saved", "Shop details were saved on this phone.");
    } catch (err) {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Please try again.");
    }
  }

  async function chooseLogo() {
    try {
      const uri = await pickShopLogo();
      if (uri) {
        setLogoUri(uri);
        await saveShopSettings({ shopName, logoUri: uri });
      }
    } catch (err) {
      Alert.alert("Logo failed", err instanceof Error ? err.message : "Could not save logo.");
    }
  }

  async function savePin() {
    const cleanNewPin = newPin.trim();
    if (!/^\d{4}$|^\d{6}$/.test(cleanNewPin)) {
      Alert.alert("Invalid PIN", "Use a 4 or 6 digit PIN.");
      return;
    }
    const savedHash = await getSecurityPinHash();
    if (savedHash && (await hashPin(oldPin)) !== savedHash) {
      Alert.alert("Wrong old PIN", "PIN was not changed.");
      return;
    }
    try {
      setBusy(true);
      await saveSecurityPinHash(await hashPin(cleanNewPin));
      setOldPin("");
      setNewPin("");
      setHasPin(true);
      Alert.alert("PIN saved", "Protected delete actions now require this PIN.");
    } catch (err) {
      Alert.alert("PIN failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup(range?: BackupRange) {
    try {
      setBackupBusy(true);
      const backup = await sharePhoneBackup(range);
      setManifest(backup.manifest);
      Alert.alert("Backup ready", "ZIP backup was created. Keep it safe or import it on a new phone.");
    } catch (err) {
      Alert.alert("Backup failed", err instanceof Error ? err.message : "Could not create backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  function exportDateBackup() {
    try {
      void exportBackup(validateRange(startDate, endDate));
    } catch (err) {
      Alert.alert("Invalid date range", err instanceof Error ? err.message : "Please check the dates.");
    }
  }

  async function importBackup() {
    try {
      setImportBusy(true);
      const result = await importLatestBackupFromPickedFolder();
      setManifest(result.manifest);
      Alert.alert("Import complete", formatImportStats(result.stats));
    } catch (err) {
      Alert.alert("Import failed", err instanceof Error ? err.message : "Could not import backup.");
    } finally {
      setImportBusy(false);
    }
  }

  async function shareDeviceCode() {
    if (!license?.deviceCode) {
      return;
    }
    await Share.share({ message: `Device Code: ${license.deviceCode}` });
  }

  return (
    <Screen activeTab="settings" eyebrow="Offline settings" title="Settings" onNavigate={onNavigate}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>License</Text>
        {license?.valid ? (
          <>
            <StatusBadge status="Activated" />
            <DetailRow icon="business" label="Customer" value={license.license.payload.customerName} />
            <DetailRow icon="phone-portrait" label="Device Code" value={license.deviceCode} />
            <DetailRow icon="key" label="License Type" value="Permanent" />
            <DetailRow icon="calendar" label="Issued" value={displayDate(license.license.payload.issuedAt)} />
            <Button onPress={shareDeviceCode}>Share Device Code</Button>
          </>
        ) : (
          <>
            <Text style={styles.problem}>{license?.reason || "License information is not available."}</Text>
            <Button onPress={shareDeviceCode}>Share Device Code</Button>
          </>
        )}
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Shop details</Text>
        {logoUri ? <Image source={{ uri: logoUri }} style={styles.settingsLogo} /> : null}
        <Field label="Shop Name" value={shopName} onChangeText={setShopName} placeholder="Your shop name" />
        <View style={styles.actions}>
          <Button onPress={chooseLogo}>Logo</Button>
          <Button variant="primary" onPress={saveShop}>Save Shop</Button>
        </View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Security PIN</Text>
        <Text style={styles.problem}>{hasPin ? "Reset PIN requires your old PIN." : "Create a PIN before deleting motor records."}</Text>
        {hasPin ? <Field label="Old PIN" value={oldPin} onChangeText={setOldPin} keyboardType="number-pad" secureTextEntry maxLength={6} /> : null}
        <Field label={hasPin ? "New PIN" : "Set PIN"} value={newPin} onChangeText={setNewPin} keyboardType="number-pad" secureTextEntry maxLength={6} />
        <Button variant="primary" disabled={busy} onPress={savePin}>{busy ? "Saving" : hasPin ? "Reset PIN" : "Set PIN"}</Button>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Backup & restore</Text>
        <Text style={styles.problem}>Export date-wise backups and import them when changing phones.</Text>
        <DateRangePickerField startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
        <View style={styles.actions}>
          <Button variant="primary" disabled={backupBusy} onPress={exportDateBackup}>{backupBusy ? "Creating" : "Date Backup"}</Button>
          <Button disabled={backupBusy} onPress={() => exportBackup()}>{backupBusy ? "Creating" : "Full Backup"}</Button>
        </View>
        <Button variant="primary" disabled={importBusy} onPress={importBackup}>{importBusy ? "Importing" : "Import ZIP"}</Button>
      </View>
      {manifest ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Last backup</Text>
          <Text style={styles.problem}>Source: {manifest.deviceId || manifest.platform || "Backup file"}</Text>
          <Text style={styles.problem}>Motors: {manifest.counts.motors}</Text>
          <Text style={styles.problem}>Customers: {manifest.counts.customers}</Text>
          <Text style={styles.problem}>Workers: {manifest.counts.workers}</Text>
          <Text style={styles.problem}>Media: {manifest.counts.media}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function PinModal({
  visible,
  title,
  hint,
  pin,
  busy,
  confirmLabel,
  onChange,
  onCancel,
  onConfirm
}: {
  visible: boolean;
  title: string;
  hint: string;
  pin: string;
  busy?: boolean;
  confirmLabel: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.actionSheetBackdrop}>
        <View style={styles.actionSheet}>
          <Text style={styles.actionSheetTitle}>{title}</Text>
          <Text style={styles.actionSheetHint}>{hint}</Text>
          <Field label="Security PIN" value={pin} onChangeText={onChange} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus />
          <View style={styles.actions}>
            <Button onPress={onCancel}>Cancel</Button>
            <Button variant="danger" disabled={busy} onPress={onConfirm}>{busy ? "Working" : confirmLabel}</Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

async function hashPin(pin: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `rewindin:${pin.trim()}`);
}

function validateRange(startDate: string, endDate: string): BackupRange {
  const start = startDate.trim();
  const end = endDate.trim();
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    throw new Error("Enter real start and end dates as YYYY-MM-DD.");
  }
  if (start > end) {
    throw new Error("Start date must be before end date.");
  }
  return { startDate: start, endDate: end };
}

function formatImportStats(stats: BackupImportStats) {
  const total =
    stats.motors +
    stats.customers +
    stats.workers +
    stats.attendance +
    stats.salaryPayments +
    stats.media;
  if (!total) {
    return "Backup is valid, but no records were imported.";
  }
  return [
    `Motors: ${stats.motors}`,
    `Customers: ${stats.customers}`,
    `Workers: ${stats.workers}`,
    `Attendance: ${stats.attendance}`,
    `Salary payments: ${stats.salaryPayments}`,
    `Media files: ${stats.media}`
  ].join("\n");
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isValidIsoMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month] = value.split("-").map(Number);
  return year >= 2000 && month >= 1 && month <= 12;
}

async function refreshDeadlineNotifications() {
  await Notifications.dismissAllNotificationsAsync();
  const permission = await Notifications.getPermissionsAsync();
  const granted = permission.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) {
    return;
  }

  await Notifications.setNotificationChannelAsync("motor-deadlines", {
    name: "Motor deadlines",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.accent
  });
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const motors = (await listMotors())
    .filter((motor) => !["Completed", "Delivered"].includes(motor.status))
    .slice(0, 50);

  for (const motor of motors) {
    const triggerDate = deadlineNotificationDate(motor.deadlineDate, now);
    await Notifications.scheduleNotificationAsync({
      identifier: `motor-deadline-${motor.uuid}`,
      content: {
        title: motor.deadlineDate < todayIso() ? "Motor overdue" : "Motor deadline near",
        body:
          motor.deadlineDate < todayIso()
            ? `${motor.jobNumber} - ${motor.motorType} is overdue.`
            : `${motor.jobNumber} - ${motor.motorType} due tomorrow.`,
        data: { motorUuid: motor.uuid }
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: "motor-deadlines"
      }
    });
  }
}

function deadlineNotificationDate(deadlineDate: string, now: Date) {
  const [year, month, day] = deadlineDate.split("-").map(Number);
  const date = new Date(year || now.getFullYear(), (month || 1) - 1, day || now.getDate(), 9, 0, 0);
  date.setDate(date.getDate() - 1);
  if (date <= now) {
    return new Date(now.getTime() + 5000);
  }
  return date;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Centered({ message, danger }: { message: string; danger?: boolean }) {
  return (
    <View style={styles.centered}>
      {danger ? null : <ActivityIndicator size="large" color={colors.accent} />}
      <Text style={[styles.centerText, danger && styles.danger]}>{message}</Text>
    </View>
  );
}

function LoadingScreen() {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1300,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 850,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    spinLoop.start();
    pulseLoop.start();
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"]
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.06]
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.8]
  });

  return (
    <View style={styles.loadingScreen}>
      <View style={styles.loadingMark}>
        <Animated.View style={[styles.loadingRing, { transform: [{ rotate }] }]} />
        <Animated.View style={[styles.loadingPulse, { opacity, transform: [{ scale }] }]} />
        <Ionicons name="construct" size={34} color={colors.white} />
      </View>
      <Text style={styles.loadingTitle}>Motor Repair Manager</Text>
      <Text style={styles.loadingText}>Opening offline shop data</Text>
      <View style={styles.loadingDots}>
        <View style={styles.loadingDot} />
        <View style={[styles.loadingDot, styles.loadingDotMuted]} />
        <View style={[styles.loadingDot, styles.loadingDotMuted]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  activationSafe: {
    flex: 1,
    backgroundColor: colors.surface
  },
  activationContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 64,
    paddingBottom: spacing.xl,
    gap: spacing.lg
  },
  activationEyebrow: {
    ...typography.label,
    color: colors.accent
  },
  activationTitle: {
    ...typography.title
  },
  deviceCodeBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs
  },
  deviceCodeText: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900"
  },
  licenseInput: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    textAlignVertical: "top"
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
    padding: spacing.xl
  },
  loadingMark: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    marginBottom: spacing.xl
  },
  loadingRing: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.18)",
    borderTopColor: colors.white
  },
  loadingPulse: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accentDeep
  },
  loadingTitle: {
    color: colors.white,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    textAlign: "center"
  },
  loadingText: {
    marginTop: spacing.sm,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center"
  },
  loadingDots: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.white
  },
  loadingDotMuted: {
    opacity: 0.45
  },
  actionSheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,24,36,0.42)",
    padding: spacing.lg
  },
  actionSheet: {
    borderRadius: 24,
    backgroundColor: colors.white,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)"
  },
  actionSheetTitle: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900"
  },
  actionSheetHint: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "800"
  },
  actionSheetButtons: {
    flexDirection: "row",
    gap: spacing.sm
  },
  attendanceActionButton: {
    flex: 1,
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  attendanceActionLetter: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "900"
  },
  attendanceActionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  actionSheetCancel: {
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface
  },
  actionSheetCancelText: {
    color: colors.accentDeep,
    fontSize: 15,
    fontWeight: "900"
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    padding: spacing.xl
  },
  centerText: {
    marginTop: spacing.md,
    color: colors.ink,
    fontWeight: "800",
    textAlign: "center"
  },
  danger: {
    color: colors.danger
  },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  filterPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md
  },
  filterError: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800"
  },
  segmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  segmentPill: {
    flexGrow: 1,
    minWidth: 72,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  segmentPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  segmentText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  segmentTextActive: {
    color: colors.white
  },
  dashboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  dashboardMetric: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 138,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.xs
  },
  dashboardMetricDanger: {
    borderColor: "rgba(180,35,24,0.24)",
    backgroundColor: colors.dangerSoft
  },
  dashboardMetricWarning: {
    borderColor: "rgba(169,106,0,0.28)",
    backgroundColor: colors.warningSoft
  },
  dashboardMetricSuccess: {
    borderColor: "rgba(22,133,59,0.26)",
    backgroundColor: colors.successSoft
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  metricLabel: {
    ...typography.label,
    fontSize: 11
  },
  metricValue: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900"
  },
  metricHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  dateField: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  dateFieldLabel: {
    ...typography.label,
    fontSize: 10
  },
  dateFieldValue: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  dateRangeGrid: {
    gap: spacing.md
  },
  datePickerSheet: {
    borderRadius: 22,
    backgroundColor: colors.white,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 10
  },
  datePickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  monthPickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  monthPickerCell: {
    width: "30.8%",
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  monthPickerText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  datePickerQuickRow: {
    flexDirection: "row",
    justifyContent: "flex-end"
  },
  datePickerQuickButton: {
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  datePickerQuickText: {
    color: colors.accentDeep,
    fontSize: 12,
    fontWeight: "900"
  },
  rangeSummary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md
  },
  rangeSummaryText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center"
  },
  datePickerActions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  actionSheetPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent
  },
  actionSheetPrimaryText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "900"
  },
  motorSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  motorSearchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  filterCalendar: {
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.9)",
    borderRadius: 18,
    backgroundColor: "rgba(245,245,245,0.72)",
    padding: spacing.md,
    gap: spacing.md
  },
  filterCalendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  filterCalendarLabel: {
    ...typography.label,
    fontSize: 10
  },
  filterCalendarTitle: {
    color: colors.ink,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
    textAlign: "left"
  },
  filterCalendarSelection: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  filterModePill: {
    minWidth: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    alignItems: "center"
  },
  filterModeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  filterSelectionText: {
    flex: 1,
    minWidth: 0,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  filterDayCell: {
    width: "13.15%",
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  filterDaySelected: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.accent,
    borderWidth: 2
  },
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.lg,
    gap: spacing.md
  },
  shopBanner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  shopLogo: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface
  },
  settingsLogo: {
    width: 86,
    height: 86,
    borderRadius: 20,
    backgroundColor: colors.surface
  },
  shopName: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  workerHero: {
    ...shadow.card,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.78)",
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  workerListHero: {
    backgroundColor: "rgba(255,255,255,0.94)"
  },
  workerDetailHero: {
    alignItems: "stretch",
    flexDirection: "column"
  },
  workerDetailTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0
  },
  workerDetailInfo: {
    flex: 1,
    minWidth: 0
  },
  workerHeroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  workerHeroLabel: {
    ...typography.label,
    color: colors.accentDeep
  },
  workerHeroDate: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900"
  },
  workerPanel: {
    ...shadow.card,
    backgroundColor: "rgba(255,255,255,0.94)"
  },
  workerListPanel: {
    ...shadow.card,
    backgroundColor: "rgba(255,255,255,0.97)"
  },
  calendarPanel: {
    ...shadow.card,
    backgroundColor: "rgba(255,255,255,0.96)"
  },
  panelTitle: {
    ...typography.sectionTitle
  },
  panelHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    flexShrink: 1
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md
  },
  monthSwitcher: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.9)",
    borderRadius: 18,
    backgroundColor: "rgba(245,245,245,0.72)",
    padding: spacing.sm
  },
  monthIconAction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  monthTitleWrap: {
    flex: 1,
    minWidth: 0
  },
  monthSwitcherLabel: {
    ...typography.label,
    fontSize: 10
  },
  monthSwitcherTitle: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900"
  },
  monthQuickActions: {
    flexDirection: "row",
    gap: spacing.sm,
    flexBasis: "100%"
  },
  monthActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.xs,
    maxWidth: 176
  },
  monthAction: {
    minHeight: 38,
    minWidth: 50,
    flexGrow: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2
  },
  monthActionText: {
    color: colors.accentDeep,
    fontSize: 13,
    fontWeight: "900"
  },
  attendanceMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  monthTotals: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  salarySummary: {
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.9)",
    borderRadius: 18,
    backgroundColor: colors.white,
    padding: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  attendanceMetric: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 132,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.xs
  },
  attendanceMetricCompact: {
    minWidth: 96,
    flexBasis: "22%",
    paddingVertical: spacing.sm
  },
  metricPresent: {
    borderColor: "rgba(22,133,59,0.26)",
    backgroundColor: colors.successSoft
  },
  metricLeave: {
    borderColor: "rgba(169,106,0,0.28)",
    backgroundColor: colors.warningSoft
  },
  metricAbsent: {
    borderColor: "rgba(180,35,24,0.24)",
    backgroundColor: colors.dangerSoft
  },
  attendanceMetricLabel: {
    ...typography.label,
    fontSize: 11
  },
  attendanceMetricValue: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900"
  },
  attentionRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0
  },
  attentionRowDanger: {
    borderColor: "rgba(180,35,24,0.28)",
    backgroundColor: colors.dangerSoft
  },
  attentionThumb: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.white
  },
  attentionThumbEmpty: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "stretch"
  },
  list: {
    gap: spacing.lg
  },
  monthList: {
    gap: spacing.md
  },
  monthWorker: {
    ...shadow.card,
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.9)",
    borderRadius: 18,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md
  },
  monthStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  workerSalaryStatus: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  workerSalaryPill: {
    minWidth: 104,
    maxWidth: 132,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    justifyContent: "center"
  },
  salaryBalanceBadge: {
    minWidth: 112,
    maxWidth: 136,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(22,133,59,0.26)",
    backgroundColor: colors.successSoft,
    padding: spacing.sm
  },
  salaryBalanceExtraBadge: {
    borderColor: "rgba(169,106,0,0.28)",
    backgroundColor: colors.warningSoft
  },
  monthStat: {
    minWidth: 58,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: colors.white,
    color: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontWeight: "900",
    textAlign: "center"
  },
  monthStatPresent: {
    color: colors.success,
    backgroundColor: colors.successSoft
  },
  monthStatLeave: {
    color: colors.warning,
    backgroundColor: colors.warningSoft
  },
  monthStatAbsent: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft
  },
  calendar: {
    borderRadius: 18,
    backgroundColor: "rgba(245,245,245,0.72)",
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm
  },
  weekHeader: {
    flexDirection: "row",
    gap: 3
  },
  weekDay: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center"
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3
  },
  dayCell: {
    width: "13.15%",
    aspectRatio: 0.92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2
  },
  dayCellEmpty: {
    opacity: 0.18,
    borderWidth: 0,
    backgroundColor: "transparent"
  },
  dayToday: {
    borderColor: colors.accentDeep,
    borderWidth: 2
  },
  dayInRange: {
    backgroundColor: colors.dangerSoft,
    borderColor: "rgba(199,44,65,0.16)"
  },
  dayPresent: {
    borderColor: colors.success,
    backgroundColor: colors.successSoft
  },
  dayLeave: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft
  },
  dayAbsent: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft
  },
  daySelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    transform: [{ scale: 0.98 }]
  },
  dayNumber: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "900"
  },
  dayNumberMarked: {
    color: colors.ink
  },
  dayStatus: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900"
  },
  dayStatusMarked: {
    color: colors.ink
  },
  quickMark: {
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.9)",
    borderRadius: 16,
    backgroundColor: colors.white,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  quickMarkTextWrap: {
    flex: 1,
    minWidth: 0
  },
  quickMarkLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900"
  },
  quickMarkHint: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  quickMarkActions: {
    flexDirection: "row",
    gap: spacing.xs
  },
  quickMarkButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1
  },
  quickMarkPresent: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success
  },
  quickMarkAbsent: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger
  },
  quickMarkLeave: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning
  },
  quickMarkButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  salaryMetric: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 118,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2
  },
  salaryMetricCompact: {
    flexBasis: "30%",
    minWidth: 92
  },
  salaryMetricPresent: {
    borderColor: "rgba(22,133,59,0.26)",
    backgroundColor: colors.successSoft
  },
  salaryMetricAbsent: {
    borderColor: "rgba(180,35,24,0.24)",
    backgroundColor: colors.dangerSoft
  },
  salaryMetricWarning: {
    borderColor: "rgba(169,106,0,0.28)",
    backgroundColor: colors.warningSoft
  },
  salaryMetricLabel: {
    ...typography.label,
    fontSize: 10
  },
  salaryMetricValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900"
  },
  salaryPaymentPanel: {
    gap: spacing.md
  },
  salaryPaymentList: {
    gap: spacing.sm
  },
  salaryPaymentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md
  },
  salaryPaymentAmount: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  salaryPaymentDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between"
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5
  },
  legendText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  hero: {
    height: 260,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  jobHeaderCard: {
    ...shadow.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    overflow: "hidden"
  },
  jobHeaderOverdue: {
    borderColor: colors.accent
  },
  jobHero: {
    height: 262,
    backgroundColor: "#F8F8F9",
    alignItems: "center",
    justifyContent: "center"
  },
  jobHeaderBody: {
    padding: spacing.md,
    gap: spacing.sm
  },
  topLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  jobTitle: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900"
  },
  heroImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain"
  },
  videoHero: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  videoHeroTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  details: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  detailSection: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0
  },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  detailActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  detailActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  detailActionButton: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 132,
    minHeight: 74,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  detailActionButtonDanger: {
    borderColor: "rgba(180,35,24,0.24)",
    backgroundColor: colors.dangerSoft
  },
  detailActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  detailActionIconDanger: {
    backgroundColor: colors.white
  },
  detailActionText: {
    flex: 1,
    minWidth: 0,
    color: colors.accentDeep,
    fontSize: 14,
    fontWeight: "900"
  },
  detailActionTextDanger: {
    color: colors.danger
  },
  problemBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs
  },
  paymentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  paymentTile: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 132,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs
  },
  paymentTileSuccess: {
    borderColor: "rgba(22,133,59,0.26)",
    backgroundColor: colors.successSoft
  },
  paymentTileDanger: {
    borderColor: "rgba(180,35,24,0.24)",
    backgroundColor: colors.dangerSoft
  },
  paymentTileValue: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  mediaStrip: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  mediaTile: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 132,
    height: 138,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#F8F8F9",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  mediaTileImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain"
  },
  mediaTileVideo: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  mediaTileText: {
    color: colors.accentDeep,
    fontSize: 12,
    fontWeight: "900"
  },
  info: {
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 140,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.xs
  },
  infoLabel: {
    ...typography.label
  },
  infoValue: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900",
    flexShrink: 1
  },
  problem: {
    ...typography.body,
    color: colors.muted,
    fontWeight: "700"
  },
  form: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md
  },
  addWorkerForm: {
    backgroundColor: "rgba(255,255,255,0.92)"
  },
  compactFormGrid: {
    gap: spacing.md
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: "top"
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minWidth: 0
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: colors.accentDeep,
    fontWeight: "900"
  },
  body: {
    flex: 1,
    minWidth: 0
  },
  name: {
    ...typography.sectionTitle,
    fontSize: 18
  },
  mutedText: {
    color: colors.muted,
    fontWeight: "700",
    flexShrink: 1
  },
  balance: {
    color: colors.ink,
    fontWeight: "900",
    flexShrink: 1,
    maxWidth: 132,
    textAlign: "right"
  },
  worker: {
    ...shadow.card,
    borderWidth: 1,
    borderColor: "rgba(217,217,217,0.9)",
    borderRadius: 18,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md
  },
  workerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    alignItems: "flex-start"
  },
  workerInfo: {
    flex: 1,
    minWidth: 0
  },
  workerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.infoSoft
  },
  workerAvatarLarge: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.infoSoft
  },
  workerAvatarLargeText: {
    color: colors.info,
    fontSize: 24,
    fontWeight: "900"
  },
  workerAvatarText: {
    color: colors.info,
    fontWeight: "900",
    fontSize: 17
  },
  workerMetaRight: {
    alignItems: "flex-end",
    gap: spacing.xs,
    maxWidth: 118
  },
  attendanceStatus: {
    marginTop: spacing.xs,
    color: colors.accentDeep,
    fontWeight: "900"
  },
  workerSalary: {
    color: colors.ink,
    fontWeight: "900",
    textAlign: "right",
    fontSize: 14
  },
  workerSectionTitle: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md
  },
  workerOpenRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  workerOpenText: {
    color: colors.accentDeep,
    fontSize: 13,
    fontWeight: "900",
    flex: 1,
    minWidth: 0
  },
  workerCallButton: {
    minHeight: 36,
    minWidth: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  workerCallButtonLarge: {
    minHeight: 44,
    alignSelf: "stretch",
    flexShrink: 0
  },
  workerCallButtonDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  workerCallText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  workerCallTextDisabled: {
    color: colors.muted
  },
  pressed: {
    transform: [{ scale: 0.98 }]
  },
  statusBadge: {
    maxWidth: 112,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderWidth: 1
  },
  statusNeutral: {
    backgroundColor: colors.surface,
    borderColor: colors.border
  },
  statusPresent: {
    backgroundColor: colors.successSoft,
    borderColor: "rgba(22,133,59,0.26)"
  },
  statusLeave: {
    backgroundColor: colors.warningSoft,
    borderColor: "rgba(169,106,0,0.28)"
  },
  statusAbsent: {
    backgroundColor: colors.dangerSoft,
    borderColor: "rgba(180,35,24,0.24)"
  },
  statusBadgeText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center"
  }
});
