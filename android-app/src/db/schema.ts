import { getDatabase } from "./database";

export const schemaVersion = 1;

export async function migrate() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      motor_count INTEGER NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      last_activity TEXT NOT NULL,
      device_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS motors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      job_number TEXT NOT NULL UNIQUE,
      customer_uuid TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      motor_type TEXT NOT NULL,
      problem_description TEXT NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      final_cost REAL NOT NULL DEFAULT 0,
      advance_paid REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL,
      status TEXT NOT NULL,
      date_added TEXT NOT NULL,
      deadline_date TEXT NOT NULL,
      device_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_uuid) REFERENCES customers(uuid)
    );

    CREATE TABLE IF NOT EXISTS motor_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      motor_uuid TEXT NOT NULL,
      uri TEXT NOT NULL,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      checksum TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      device_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(motor_uuid) REFERENCES motors(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      role TEXT NOT NULL,
      monthly_salary REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      device_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worker_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      worker_uuid TEXT NOT NULL,
      work_date TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(worker_uuid, work_date),
      FOREIGN KEY(worker_uuid) REFERENCES workers(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS worker_salary_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      worker_uuid TEXT NOT NULL,
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(worker_uuid) REFERENCES workers(uuid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_motors_status ON motors(status);
    CREATE INDEX IF NOT EXISTS idx_motors_payment_status ON motors(payment_status);
    CREATE INDEX IF NOT EXISTS idx_motors_customer_uuid ON motors(customer_uuid);
    CREATE INDEX IF NOT EXISTS idx_motor_media_motor_uuid ON motor_media(motor_uuid);
    CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON worker_attendance(worker_uuid, work_date);
    CREATE INDEX IF NOT EXISTS idx_salary_payments_worker_date ON worker_salary_payments(worker_uuid, payment_date);

    INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '${schemaVersion}');
  `);
}
