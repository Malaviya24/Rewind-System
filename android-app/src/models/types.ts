export type RepairStatus = "Received" | "Checking" | "In Repair" | "Waiting for Parts" | "Completed" | "Delivered";
export type PaymentStatus = "Unpaid" | "Partial" | "Paid";
export type AttendanceStatus = "Present" | "Leave" | "Absent";
export type SyncStatus = "local" | "exported" | "imported";
export type MediaType = "image" | "video";

export const repairStatuses: RepairStatus[] = [
  "Received",
  "Checking",
  "In Repair",
  "Waiting for Parts",
  "Completed",
  "Delivered"
];

export const paymentStatuses: PaymentStatus[] = ["Unpaid", "Partial", "Paid"];
export const attendanceStatuses: AttendanceStatus[] = ["Present", "Leave", "Absent"];

export type Motor = {
  id?: number;
  uuid: string;
  jobNumber: string;
  customerUuid: string;
  customerName: string;
  phoneNumber: string;
  motorType: string;
  problemDescription: string;
  estimatedCost: number;
  finalCost: number;
  advancePaid: number;
  paymentStatus: PaymentStatus;
  status: RepairStatus;
  dateAdded: string;
  deadlineDate: string;
  deviceId: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type MotorMedia = {
  id?: number;
  uuid: string;
  motorUuid: string;
  uri: string;
  filename: string;
  mediaType: MediaType;
  checksum: string;
  sortOrder: number;
  deviceId: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id?: number;
  uuid: string;
  name: string;
  phoneNumber: string;
  motorCount: number;
  balanceDue: number;
  lastActivity: string;
  deviceId: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type Worker = {
  id?: number;
  uuid: string;
  name: string;
  phoneNumber: string;
  role: string;
  monthlySalary: number;
  active: boolean;
  deviceId: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkerAttendance = {
  id?: number;
  uuid: string;
  workerUuid: string;
  workDate: string;
  status: AttendanceStatus;
  note: string;
  deviceId: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkerAttendanceRow = WorkerAttendance & {
  workerName: string;
  workerRole: string;
  phoneNumber: string;
};

export type WorkerSalaryPayment = {
  id?: number;
  uuid: string;
  workerUuid: string;
  paymentDate: string;
  amount: number;
  note: string;
  deviceId: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type MotorWithMedia = Motor & {
  media: MotorMedia[];
};

export type ShopSettings = {
  shopName: string;
  logoUri: string;
};

export type LicensePayload = {
  appId: string;
  platform: "android" | "pc";
  deviceId: string;
  licenseType: "permanent";
  customerName: string;
  issuedAt: string;
  features: string[];
};

export type StoredLicense = {
  key: string;
  payload: LicensePayload;
  activatedAt: string;
};

export type BackupRange = {
  startDate: string;
  endDate: string;
};

export type BackupData = {
  customers: Record<string, unknown>[];
  motors: Record<string, unknown>[];
  motorMedia: Record<string, unknown>[];
  workers: Record<string, unknown>[];
  workerAttendance: Record<string, unknown>[];
  workerSalaryPayments: Record<string, unknown>[];
  appMeta: Record<string, unknown>[];
};

export type DashboardSummary = {
  totalMotors: number;
  openRepairs: number;
  completedRepairs: number;
  overdueRepairs: number;
  unpaidJobs: number;
  collectedTotal: number;
  pendingBalance: number;
  totalWorkers: number;
  customers: number;
};

export type BackupManifest = {
  app: string;
  backupType: "phone_export" | "phone_export_range";
  appVersion: string;
  schemaVersion: number;
  deviceId: string;
  createdAt: string;
  dateRange?: BackupRange;
  shop?: ShopSettings;
  counts: {
    motors: number;
    customers: number;
    workers: number;
    attendance: number;
    salaryPayments: number;
    media: number;
  };
};
