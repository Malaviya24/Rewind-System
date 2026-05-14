import { AttendanceStatus, BackupData, BackupImportStats, BackupRange, DashboardSummary, LicensePayload, Motor, MotorMedia, MotorWithMedia, PaymentStatus, RepairStatus, ShopSettings, StoredLicense, Worker, WorkerAttendanceRow, WorkerSalaryPayment, WorkerSalaryPaymentType } from "@/models/types";
import { getDeviceId } from "@/services/device";
import { monthBounds, nowIso, todayIso } from "@/utils/dates";
import { createJobNumber, createUuid } from "@/utils/ids";
import { balanceAmount, paymentStatus, repairAmount } from "@/utils/money";
import { all, first, run } from "./database";

type MotorInput = {
  customerName: string;
  phoneNumber: string;
  motorType: string;
  problemDescription: string;
  estimatedCost: number;
  finalCost: number;
  advancePaid: number;
  status: RepairStatus;
  deadlineDate: string;
};

function mapMotor(row: Record<string, unknown>): Motor {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    jobNumber: String(row.job_number),
    batchNumber: Number(row.batch_number) || 0,
    customerUuid: String(row.customer_uuid),
    customerName: String(row.customer_name),
    phoneNumber: String(row.phone_number),
    motorType: String(row.motor_type),
    problemDescription: String(row.problem_description),
    estimatedCost: Number(row.estimated_cost),
    finalCost: Number(row.final_cost),
    advancePaid: Number(row.advance_paid),
    paymentStatus: String(row.payment_status) as PaymentStatus,
    status: String(row.status) as RepairStatus,
    dateAdded: String(row.date_added),
    deadlineDate: String(row.deadline_date),
    deviceId: String(row.device_id),
    syncStatus: "local",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMedia(row: Record<string, unknown>): MotorMedia {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    motorUuid: String(row.motor_uuid),
    uri: String(row.uri),
    filename: String(row.filename),
    mediaType: String(row.media_type) as MotorMedia["mediaType"],
    checksum: String(row.checksum),
    sortOrder: Number(row.sort_order),
    deviceId: String(row.device_id),
    syncStatus: "local",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function normalizeSalaryPaymentType(value: unknown): WorkerSalaryPaymentType {
  return value === "Advance" ? "Advance" : "Paid";
}

export async function getDashboardSummary(range?: BackupRange): Promise<DashboardSummary> {
  const today = todayIso();
  const whereClause = range ? "WHERE date_added BETWEEN ? AND ?" : "";
  const rangeParams = range ? [range.startDate, range.endDate] : [];
  const motorStats = await first<Record<string, number>>(
    `SELECT
      COUNT(*) AS totalMotors,
      SUM(CASE WHEN status NOT IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) AS openRepairs,
      SUM(CASE WHEN status IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) AS completedRepairs,
      SUM(CASE WHEN status NOT IN ('Completed', 'Delivered') AND deadline_date < ? THEN 1 ELSE 0 END) AS overdueRepairs,
      SUM(CASE WHEN payment_status != 'Paid' THEN 1 ELSE 0 END) AS unpaidJobs,
      COALESCE(SUM(advance_paid), 0) AS collectedTotal,
      COALESCE(SUM(CASE WHEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) > advance_paid
        THEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) - advance_paid ELSE 0 END), 0) AS pendingBalance
      FROM motors ${whereClause}`,
    [today, ...rangeParams]
  );
  const workerStats = await first<{ totalWorkers: number }>("SELECT COUNT(*) AS totalWorkers FROM workers WHERE active = 1");
  const customerStats = await first<{ customers: number }>("SELECT COUNT(*) AS customers FROM customers");
  return {
    totalMotors: Number(motorStats?.totalMotors || 0),
    openRepairs: Number(motorStats?.openRepairs || 0),
    completedRepairs: Number(motorStats?.completedRepairs || 0),
    overdueRepairs: Number(motorStats?.overdueRepairs || 0),
    unpaidJobs: Number(motorStats?.unpaidJobs || 0),
    collectedTotal: Number(motorStats?.collectedTotal || 0),
    pendingBalance: Number(motorStats?.pendingBalance || 0),
    totalWorkers: Number(workerStats?.totalWorkers || 0),
    customers: Number(customerStats?.customers || 0)
  };
}

export async function listMotors(query = ""): Promise<MotorWithMedia[]> {
  const search = `%${query.trim()}%`;
  const searchPrefix = `${query.trim()}%`;
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM motors
     WHERE ? = '%%' OR job_number LIKE ? OR customer_name LIKE ? OR phone_number LIKE ? OR CAST(batch_number AS TEXT) LIKE ?
     ORDER BY
      CASE WHEN status NOT IN ('Completed', 'Delivered') AND deadline_date < date('now') THEN 0 ELSE 1 END,
      deadline_date ASC,
      id DESC`,
    [search, search, search, search, searchPrefix]
  );
  const mediaRows = await all<Record<string, unknown>>("SELECT * FROM motor_media ORDER BY sort_order ASC, id ASC");
  const mediaMap = new Map<string, MotorMedia[]>();
  mediaRows.map(mapMedia).forEach((media) => {
    mediaMap.set(media.motorUuid, [...(mediaMap.get(media.motorUuid) || []), media]);
  });
  return rows.map((row) => {
    const motor = mapMotor(row);
    return { ...motor, media: mediaMap.get(motor.uuid) || [] };
  });
}

export async function getMotor(uuid: string): Promise<MotorWithMedia | null> {
  const row = await first<Record<string, unknown>>("SELECT * FROM motors WHERE uuid = ?", [uuid]);
  if (!row) {
    return null;
  }
  const motor = mapMotor(row);
  const media = (await all<Record<string, unknown>>("SELECT * FROM motor_media WHERE motor_uuid = ? ORDER BY sort_order ASC, id ASC", [uuid])).map(mapMedia);
  return { ...motor, media };
}

export async function listDashboardAttention(limit = 12, range?: BackupRange): Promise<MotorWithMedia[]> {
  const today = todayIso();
  const tomorrow = addDaysForQuery(today, 1);
  const rangeClause = range ? "AND date_added BETWEEN ? AND ?" : "";
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM motors
     WHERE (payment_status != 'Paid'
       OR (status NOT IN ('Completed', 'Delivered') AND deadline_date <= ?))
       ${rangeClause}
     ORDER BY
      CASE
        WHEN status NOT IN ('Completed', 'Delivered') AND deadline_date < ? THEN 0
        WHEN payment_status != 'Paid' THEN 1
        ELSE 2
      END,
      deadline_date ASC,
      id DESC
     LIMIT ?`,
    range ? [tomorrow, range.startDate, range.endDate, today, limit] : [tomorrow, today, limit]
  );
  const mediaRows = await all<Record<string, unknown>>(
    `SELECT mm.* FROM motor_media mm
     JOIN (${rows.map(() => "SELECT ? AS uuid").join(" UNION ALL ") || "SELECT '' AS uuid"}) selected ON selected.uuid = mm.motor_uuid
     ORDER BY mm.sort_order ASC, mm.id ASC`,
    rows.map((row) => String(row.uuid))
  );
  const mediaMap = new Map<string, MotorMedia[]>();
  mediaRows.map(mapMedia).forEach((media) => {
    mediaMap.set(media.motorUuid, [...(mediaMap.get(media.motorUuid) || []), media]);
  });
  return rows.map((row) => {
    const motor = mapMotor(row);
    return { ...motor, media: mediaMap.get(motor.uuid) || [] };
  });
}

export async function listDeadlineAlerts(): Promise<MotorWithMedia[]> {
  const today = todayIso();
  const tomorrow = addDaysForQuery(today, 1);
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM motors
     WHERE status NOT IN ('Completed', 'Delivered')
       AND deadline_date <= ?
     ORDER BY deadline_date ASC, id DESC
     LIMIT 20`,
    [tomorrow]
  );
  const mediaRows = rows.length
    ? await all<Record<string, unknown>>(
        `SELECT * FROM motor_media WHERE motor_uuid IN (${rows.map(() => "?").join(",")}) ORDER BY sort_order ASC, id ASC`,
        rows.map((row) => String(row.uuid))
      )
    : [];
  const mediaMap = new Map<string, MotorMedia[]>();
  mediaRows.map(mapMedia).forEach((media) => {
    mediaMap.set(media.motorUuid, [...(mediaMap.get(media.motorUuid) || []), media]);
  });
  return rows.map((row) => {
    const motor = mapMotor(row);
    return { ...motor, media: mediaMap.get(motor.uuid) || [] };
  });
}

export async function saveMotor(input: MotorInput, uuid?: string) {
  const now = nowIso();
  const deviceId = await getDeviceId();
  const calculatedPayment = paymentStatus(input.finalCost, input.estimatedCost, input.advancePaid);
  const customer = await first<{ uuid: string }>("SELECT uuid FROM customers WHERE phone_number = ? LIMIT 1", [input.phoneNumber]);
  const customerUuid = customer?.uuid || createUuid();
  if (!customer) {
    await run(
      `INSERT INTO customers (uuid, name, phone_number, motor_count, balance_due, last_activity, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, ?, ?, 'local', ?, ?)`,
      [customerUuid, input.customerName, input.phoneNumber, todayIso(), deviceId, now, now]
    );
  }

  if (uuid) {
    await run(
      `UPDATE motors SET customer_uuid = ?, customer_name = ?, phone_number = ?, motor_type = ?, problem_description = ?,
        estimated_cost = ?, final_cost = ?, advance_paid = ?, payment_status = ?, status = ?, deadline_date = ?,
        sync_status = 'local', updated_at = ? WHERE uuid = ?`,
      [
        customerUuid,
        input.customerName,
        input.phoneNumber,
        input.motorType,
        input.problemDescription,
        input.estimatedCost,
        input.finalCost,
        input.advancePaid,
        calculatedPayment,
        input.status,
        input.deadlineDate,
        now,
        uuid
      ]
    );
  } else {
    const sequence = (await first<{ count: number }>("SELECT COUNT(*) AS count FROM motors"))?.count || 0;
    const batchRow = await first<{ next: number }>("SELECT COALESCE(MAX(batch_number), 0) + 1 AS next FROM motors");
    const batchNumber = batchRow?.next || 1;
    uuid = createUuid();
    await run(
      `INSERT INTO motors (
        uuid, job_number, batch_number, customer_uuid, customer_name, phone_number, motor_type, problem_description,
        estimated_cost, final_cost, advance_paid, payment_status, status, date_added, deadline_date,
        device_id, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
      [
        uuid,
        createJobNumber(sequence + 1),
        batchNumber,
        customerUuid,
        input.customerName,
        input.phoneNumber,
        input.motorType,
        input.problemDescription,
        input.estimatedCost,
        input.finalCost,
        input.advancePaid,
        calculatedPayment,
        input.status,
        todayIso(),
        input.deadlineDate,
        deviceId,
        now,
        now
      ]
    );
  }

  await refreshCustomerRollup(customerUuid);
  return uuid;
}

export async function updateMotorStatus(uuid: string, status: RepairStatus) {
  await run("UPDATE motors SET status = ?, sync_status = 'local', updated_at = ? WHERE uuid = ?", [status, nowIso(), uuid]);
}

export async function updateMotorPayment(uuid: string, payment: PaymentStatus) {
  const motor = await getMotor(uuid);
  if (!motor) {
    return;
  }
  const amount = repairAmount(motor.finalCost, motor.estimatedCost);
  const advancePaid = payment === "Paid" ? amount : payment === "Unpaid" ? 0 : motor.advancePaid || Math.round(amount / 2);
  await run("UPDATE motors SET payment_status = ?, advance_paid = ?, sync_status = 'local', updated_at = ? WHERE uuid = ?", [
    payment,
    advancePaid,
    nowIso(),
    uuid
  ]);
  await refreshCustomerRollup(motor.customerUuid);
}

export async function deleteMotor(uuid: string) {
  const motor = await getMotor(uuid);
  if (!motor) {
    return [];
  }
  await run("DELETE FROM motor_media WHERE motor_uuid = ?", [uuid]);
  await run("DELETE FROM motors WHERE uuid = ?", [uuid]);
  await refreshCustomerRollup(motor.customerUuid);
  return motor.media.map((item) => item.uri);
}

export async function attachMotorMedia(media: Omit<MotorMedia, "id" | "syncStatus" | "deviceId" | "createdAt" | "updatedAt">[]) {
  const deviceId = await getDeviceId();
  const now = nowIso();
  for (const item of media) {
    await run(
      `INSERT INTO motor_media (uuid, motor_uuid, uri, filename, media_type, checksum, sort_order, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
      [item.uuid, item.motorUuid, item.uri, item.filename, item.mediaType, item.checksum, item.sortOrder, deviceId, now, now]
    );
  }
}

export async function listCustomers(query = "") {
  const search = `%${query.trim()}%`;
  return all<Record<string, unknown>>(
    `SELECT * FROM customers
     WHERE ? = '%%' OR name LIKE ? OR phone_number LIKE ?
     ORDER BY last_activity DESC, name ASC`,
    [search, search, search]
  );
}

export async function listWorkers(): Promise<Worker[]> {
  const rows = await all<Record<string, unknown>>("SELECT * FROM workers ORDER BY active DESC, name ASC");
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    phoneNumber: String(row.phone_number),
    role: String(row.role),
    monthlySalary: Number(row.monthly_salary),
    active: Boolean(row.active),
    deviceId: String(row.device_id),
    syncStatus: "local",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }));
}

export async function saveWorker(input: Pick<Worker, "name" | "phoneNumber" | "role" | "monthlySalary">) {
  const now = nowIso();
  await run(
    `INSERT INTO workers (uuid, name, phone_number, role, monthly_salary, active, device_id, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'local', ?, ?)`,
    [createUuid(), input.name, input.phoneNumber, input.role, input.monthlySalary, await getDeviceId(), now, now]
  );
}

export async function markAttendance(workerUuid: string, status: AttendanceStatus, workDate = todayIso(), note = "") {
  const now = nowIso();
  await run(
    `INSERT INTO worker_attendance (uuid, worker_uuid, work_date, status, note, device_id, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?)
     ON CONFLICT(worker_uuid, work_date) DO UPDATE SET status = excluded.status, note = excluded.note, sync_status = 'local', updated_at = excluded.updated_at`,
    [createUuid(), workerUuid, workDate, status, note, await getDeviceId(), now, now]
  );
}

export async function saveWorkerSalaryPayment(workerUuid: string, amount: number, paymentDate = todayIso(), note = "", paymentType: WorkerSalaryPaymentType = "Paid") {
  const now = nowIso();
  await run(
    `INSERT INTO worker_salary_payments (uuid, worker_uuid, payment_date, amount, payment_type, note, device_id, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
    [createUuid(), workerUuid, paymentDate, amount, normalizeSalaryPaymentType(paymentType), note, await getDeviceId(), now, now]
  );
}

export async function listWorkerSalaryPaymentsForMonth(month = todayIso().slice(0, 7)): Promise<WorkerSalaryPayment[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM worker_salary_payments
     WHERE substr(payment_date, 1, 7) = ?
     ORDER BY payment_date DESC, id DESC`,
    [month]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    workerUuid: String(row.worker_uuid),
    paymentDate: String(row.payment_date),
    amount: Number(row.amount),
    paymentType: normalizeSalaryPaymentType(row.payment_type),
    note: String(row.note),
    deviceId: String(row.device_id),
    syncStatus: "local",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }));
}

export async function listAttendance(workDate = todayIso()): Promise<WorkerAttendanceRow[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT
      wa.id,
      wa.uuid,
      wa.worker_uuid,
      wa.work_date,
      wa.status,
      wa.note,
      wa.device_id,
      wa.sync_status,
      wa.created_at,
      wa.updated_at,
      w.name AS worker_name,
      w.role AS worker_role,
      w.phone_number
     FROM worker_attendance wa
     JOIN workers w ON w.uuid = wa.worker_uuid
     WHERE wa.work_date = ?
     ORDER BY w.name ASC`,
    [workDate]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    workerUuid: String(row.worker_uuid),
    workDate: String(row.work_date),
    status: String(row.status) as AttendanceStatus,
    note: String(row.note),
    deviceId: String(row.device_id),
    syncStatus: "local",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    workerName: String(row.worker_name),
    workerRole: String(row.worker_role),
    phoneNumber: String(row.phone_number)
  }));
}

export async function listAttendanceForMonth(month = todayIso().slice(0, 7)): Promise<WorkerAttendanceRow[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT
      wa.id,
      wa.uuid,
      wa.worker_uuid,
      wa.work_date,
      wa.status,
      wa.note,
      wa.device_id,
      wa.sync_status,
      wa.created_at,
      wa.updated_at,
      w.name AS worker_name,
      w.role AS worker_role,
      w.phone_number
     FROM worker_attendance wa
     JOIN workers w ON w.uuid = wa.worker_uuid
     WHERE substr(wa.work_date, 1, 7) = ?
     ORDER BY wa.work_date DESC, w.name ASC`,
    [month]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    workerUuid: String(row.worker_uuid),
    workDate: String(row.work_date),
    status: String(row.status) as AttendanceStatus,
    note: String(row.note),
    deviceId: String(row.device_id),
    syncStatus: "local",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    workerName: String(row.worker_name),
    workerRole: String(row.worker_role),
    phoneNumber: String(row.phone_number)
  }));
}

export async function getBackupCounts() {
  const motors = await first<{ count: number }>("SELECT COUNT(*) AS count FROM motors");
  const customers = await first<{ count: number }>("SELECT COUNT(*) AS count FROM customers");
  const workers = await first<{ count: number }>("SELECT COUNT(*) AS count FROM workers");
  const attendance = await first<{ count: number }>("SELECT COUNT(*) AS count FROM worker_attendance");
  const salaryPayments = await first<{ count: number }>("SELECT COUNT(*) AS count FROM worker_salary_payments");
  const media = await first<{ count: number }>("SELECT COUNT(*) AS count FROM motor_media");
  return {
    motors: motors?.count || 0,
    customers: customers?.count || 0,
    workers: workers?.count || 0,
    attendance: attendance?.count || 0,
    salaryPayments: salaryPayments?.count || 0,
    media: media?.count || 0
  };
}

export async function getShopSettings(): Promise<ShopSettings> {
  const shopName = await getAppMeta("shop_name");
  const logoUri = await getAppMeta("shop_logo_uri");
  return {
    shopName: shopName || "",
    logoUri: logoUri || ""
  };
}

export async function saveShopSettings(settings: ShopSettings) {
  await setAppMeta("shop_name", settings.shopName.trim());
  await setAppMeta("shop_logo_uri", settings.logoUri);
}

export async function getSecurityPinHash() {
  return getAppMeta("security_pin_hash");
}

export async function saveSecurityPinHash(hash: string) {
  await setAppMeta("security_pin_hash", hash);
}

export async function getLastDeadlineNoticeKey() {
  return getAppMeta("last_deadline_notice_key");
}

export async function saveLastDeadlineNoticeKey(value: string) {
  await setAppMeta("last_deadline_notice_key", value);
}

export async function getStoredLicense(): Promise<StoredLicense | null> {
  const key = await getAppMeta("license_key");
  const payloadJson = await getAppMeta("license_payload_json");
  const activatedAt = await getAppMeta("license_activated_at");
  if (!key || !payloadJson || !activatedAt) {
    return null;
  }
  try {
    return {
      key,
      payload: JSON.parse(payloadJson) as LicensePayload,
      activatedAt
    };
  } catch {
    return null;
  }
}

export async function saveStoredLicense(key: string, payload: LicensePayload, activatedAt: string) {
  await setAppMeta("license_key", key);
  await setAppMeta("license_payload_json", JSON.stringify(payload));
  await setAppMeta("license_activated_at", activatedAt);
}

export async function getBackupData(range?: BackupRange): Promise<BackupData> {
  const motorRows = await all<Record<string, unknown>>(
    range
      ? `SELECT * FROM motors WHERE date_added BETWEEN ? AND ? ORDER BY id ASC`
      : `SELECT * FROM motors ORDER BY id ASC`,
    range ? [range.startDate, range.endDate] : []
  );
  const customerUuids = Array.from(new Set(motorRows.map((row) => String(row.customer_uuid))));
  const motorUuids = motorRows.map((row) => String(row.uuid));
  const customers = customerUuids.length
    ? await all<Record<string, unknown>>(`SELECT * FROM customers WHERE uuid IN (${customerUuids.map(() => "?").join(",")}) ORDER BY id ASC`, customerUuids)
    : range
      ? []
      : await all<Record<string, unknown>>("SELECT * FROM customers ORDER BY id ASC");
  const motorMedia = motorUuids.length
    ? await all<Record<string, unknown>>(`SELECT * FROM motor_media WHERE motor_uuid IN (${motorUuids.map(() => "?").join(",")}) ORDER BY id ASC`, motorUuids)
    : [];
  const workerAttendance = await all<Record<string, unknown>>(
    range
      ? `SELECT * FROM worker_attendance WHERE work_date BETWEEN ? AND ? ORDER BY id ASC`
      : `SELECT * FROM worker_attendance ORDER BY id ASC`,
    range ? [range.startDate, range.endDate] : []
  );
  const workerSalaryPayments = await all<Record<string, unknown>>(
    range
      ? `SELECT * FROM worker_salary_payments WHERE payment_date BETWEEN ? AND ? ORDER BY id ASC`
      : `SELECT * FROM worker_salary_payments ORDER BY id ASC`,
    range ? [range.startDate, range.endDate] : []
  );
  const workerUuids = Array.from(new Set([...workerAttendance.map((row) => String(row.worker_uuid)), ...workerSalaryPayments.map((row) => String(row.worker_uuid))]));
  const workers = workerUuids.length
    ? await all<Record<string, unknown>>(`SELECT * FROM workers WHERE uuid IN (${workerUuids.map(() => "?").join(",")}) ORDER BY id ASC`, workerUuids)
    : range
      ? []
      : await all<Record<string, unknown>>("SELECT * FROM workers ORDER BY id ASC");
  const appMeta = await all<Record<string, unknown>>("SELECT * FROM app_meta WHERE key IN ('shop_name', 'shop_logo_uri') ORDER BY key ASC");
  return {
    customers,
    motors: motorRows,
    motorMedia,
    workers,
    workerAttendance,
    workerSalaryPayments,
    appMeta
  };
}

export async function importBackupData(data: BackupData): Promise<BackupImportStats> {
  const stats: BackupImportStats = {
    customers: 0,
    motors: 0,
    workers: 0,
    attendance: 0,
    salaryPayments: 0,
    media: 0,
    appMeta: 0
  };

  for (const row of data.appMeta || []) {
    const key = String(row.key || "");
    if (key === "shop_name" || key === "shop_logo_uri") {
      await setAppMeta(key, String(row.value || ""));
      stats.appMeta += 1;
    }
  }

  for (const row of data.customers || []) {
    await run(
      `INSERT INTO customers (uuid, name, phone_number, motor_count, balance_due, last_activity, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
        name = excluded.name,
        phone_number = excluded.phone_number,
        last_activity = excluded.last_activity,
        sync_status = 'imported',
        updated_at = excluded.updated_at`,
      [
        String(row.uuid),
        String(row.name || ""),
        String(row.phone_number || ""),
        Number(row.motor_count || 0),
        Number(row.balance_due || 0),
        String(row.last_activity || todayIso()),
        String(row.device_id || (await getDeviceId())),
        String(row.created_at || nowIso()),
        String(row.updated_at || nowIso())
      ]
    );
    stats.customers += 1;
  }

  for (const row of data.motors || []) {
    await run(
      `INSERT INTO motors (
        uuid, job_number, batch_number, customer_uuid, customer_name, phone_number, motor_type, problem_description,
        estimated_cost, final_cost, advance_paid, payment_status, status, date_added, deadline_date,
        device_id, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        customer_uuid = excluded.customer_uuid,
        customer_name = excluded.customer_name,
        phone_number = excluded.phone_number,
        motor_type = excluded.motor_type,
        problem_description = excluded.problem_description,
        estimated_cost = excluded.estimated_cost,
        final_cost = excluded.final_cost,
        advance_paid = excluded.advance_paid,
        payment_status = excluded.payment_status,
        status = excluded.status,
        deadline_date = excluded.deadline_date,
        batch_number = excluded.batch_number,
        sync_status = 'imported',
        updated_at = excluded.updated_at`,
      [
        String(row.uuid),
        String(row.job_number || ""),
        Number(row.batch_number || 0),
        String(row.customer_uuid || ""),
        String(row.customer_name || ""),
        String(row.phone_number || ""),
        String(row.motor_type || ""),
        String(row.problem_description || ""),
        Number(row.estimated_cost || 0),
        Number(row.final_cost || 0),
        Number(row.advance_paid || 0),
        String(row.payment_status || "Unpaid"),
        String(row.status || "Received"),
        String(row.date_added || todayIso()),
        String(row.deadline_date || todayIso()),
        String(row.device_id || (await getDeviceId())),
        String(row.created_at || nowIso()),
        String(row.updated_at || nowIso())
      ]
    );
    stats.motors += 1;
  }

  // Backfill any imported motors missing batch_number
  const motorsWithoutBatch = await all<{ uuid: string }>(
    "SELECT uuid FROM motors WHERE batch_number = 0 OR batch_number IS NULL ORDER BY id"
  );
  for (const motor of motorsWithoutBatch) {
    const maxRow = await first<{ next: number }>(
      "SELECT COALESCE(MAX(batch_number), 0) + 1 AS next FROM motors"
    );
    const nextBatch = maxRow?.next || 1;
    await run("UPDATE motors SET batch_number = ? WHERE uuid = ?", [nextBatch, motor.uuid]);
  }

  for (const row of data.motorMedia || []) {
    await run(
      `INSERT INTO motor_media (uuid, motor_uuid, uri, filename, media_type, checksum, sort_order, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
        uri = excluded.uri,
        filename = excluded.filename,
        media_type = excluded.media_type,
        checksum = excluded.checksum,
        sort_order = excluded.sort_order,
        sync_status = 'imported',
        updated_at = excluded.updated_at`,
      [
        String(row.uuid),
        String(row.motor_uuid || ""),
        String(row.uri || ""),
        String(row.filename || ""),
        String(row.media_type || "image"),
        String(row.checksum || ""),
        Number(row.sort_order || 0),
        String(row.device_id || (await getDeviceId())),
        String(row.created_at || nowIso()),
        String(row.updated_at || nowIso())
      ]
    );
    stats.media += 1;
  }

  for (const row of data.workers || []) {
    await run(
      `INSERT INTO workers (uuid, name, phone_number, role, monthly_salary, active, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
        name = excluded.name,
        phone_number = excluded.phone_number,
        role = excluded.role,
        monthly_salary = excluded.monthly_salary,
        active = excluded.active,
        sync_status = 'imported',
        updated_at = excluded.updated_at`,
      [
        String(row.uuid),
        String(row.name || ""),
        String(row.phone_number || ""),
        String(row.role || ""),
        Number(row.monthly_salary || 0),
        Number(row.active ?? 1),
        String(row.device_id || (await getDeviceId())),
        String(row.created_at || nowIso()),
        String(row.updated_at || nowIso())
      ]
    );
    stats.workers += 1;
  }

  for (const row of data.workerAttendance || []) {
    await run(
      `INSERT INTO worker_attendance (uuid, worker_uuid, work_date, status, note, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?)
       ON CONFLICT(worker_uuid, work_date) DO UPDATE SET
        status = excluded.status,
        note = excluded.note,
        sync_status = 'imported',
        updated_at = excluded.updated_at`,
      [
        String(row.uuid),
        String(row.worker_uuid || ""),
        String(row.work_date || todayIso()),
        String(row.status || "Present"),
        String(row.note || ""),
        String(row.device_id || (await getDeviceId())),
        String(row.created_at || nowIso()),
        String(row.updated_at || nowIso())
      ]
    );
    stats.attendance += 1;
  }

  for (const row of data.workerSalaryPayments || []) {
    await run(
      `INSERT INTO worker_salary_payments (uuid, worker_uuid, payment_date, amount, payment_type, note, device_id, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
        worker_uuid = excluded.worker_uuid,
        payment_date = excluded.payment_date,
        amount = excluded.amount,
        payment_type = excluded.payment_type,
        note = excluded.note,
        sync_status = 'imported',
        updated_at = excluded.updated_at`,
      [
        String(row.uuid),
        String(row.worker_uuid || ""),
        String(row.payment_date || todayIso()),
        Number(row.amount || 0),
        normalizeSalaryPaymentType(row.payment_type),
        String(row.note || ""),
        String(row.device_id || (await getDeviceId())),
        String(row.created_at || nowIso()),
        String(row.updated_at || nowIso())
      ]
    );
    stats.salaryPayments += 1;
  }

  const customerUuids = Array.from(new Set([...(data.customers || []).map((row) => String(row.uuid)), ...(data.motors || []).map((row) => String(row.customer_uuid))]));
  for (const customerUuid of customerUuids.filter(Boolean)) {
    await refreshCustomerRollup(customerUuid);
  }

  return stats;
}

async function getAppMeta(key: string) {
  const row = await first<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [key]);
  return row?.value || "";
}

async function setAppMeta(key: string, value: string) {
  await run(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

function addDaysForQuery(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function refreshCustomerRollup(customerUuid: string) {
  const stats = await first<{ count: number; balance: number; lastActivity: string }>(
    `SELECT COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) > advance_paid
        THEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) - advance_paid ELSE 0 END), 0) AS balance,
      COALESCE(MAX(updated_at), date('now')) AS lastActivity
     FROM motors WHERE customer_uuid = ?`,
    [customerUuid]
  );
  await run("UPDATE customers SET motor_count = ?, balance_due = ?, last_activity = ?, sync_status = 'local', updated_at = ? WHERE uuid = ?", [
    stats?.count || 0,
    stats?.balance || 0,
    stats?.lastActivity || todayIso(),
    nowIso(),
    customerUuid
  ]);
}
