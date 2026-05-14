import calendar
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    send_file,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.utils import secure_filename


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))


def default_data_dir():
    if getattr(sys, "frozen", False):
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / "MotorRepairManager"
        return Path.home() / "MotorRepairManager"
    return APP_DIR


DATA_DIR = Path(os.environ.get("MOTOR_REPAIR_DATA_DIR") or default_data_dir()).resolve()
DATABASE = DATA_DIR / "database.db"
UPLOAD_FOLDER = DATA_DIR / "uploads"
BACKUP_FOLDER = DATA_DIR / "backups"

ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "webm", "mov", "m4v"}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS
MAX_UPLOAD_SIZE = 128 * 1024 * 1024
REPAIR_STATUSES = ("Received", "Checking", "In Repair", "Waiting for Parts", "Completed", "Delivered")
WORK_DONE_STATUSES = ("Completed", "Delivered")
PAYMENT_STATUSES = ("Unpaid", "Partial", "Paid")
ATTENDANCE_STATUSES = ("Present", "Leave", "Absent")
PHONE_RE = re.compile(r"^[0-9+\-\s()]{7,20}$")
INVOICE_ENDPOINTS = {"invoices", "new_invoice", "edit_invoice", "view_invoice", "delete_invoice"}
APP_ID = "rewindin-shop"
LICENSE_PLATFORM = "pc"
LICENSE_PREFIX = "RWND"
PUBLIC_MODULUS_BASE64URL = "rhgxpftL9JtuAlpiakMprQdNU0SjTdIHMZpsejtw3EHYJ09Za9QXdIMnYUJBkuN4987jRrIpAdah-yusMSPc_2hDe9lREsxP-1u_ddT91Bl79sXsEaIWvq_3aPFqC93reFRC5tAIzKJoQ3gm5JphhtXmIPhQ5dnP14TkNyJvGbTT-DrKkhMwRf7Zd31DMOHbXiTcsQMAmzioicCgDq_8IRGW0U84ufLTxVCWSbRbKPf2bjplB4pQGvlFCufo3XS-OQDoIzzZS2eeNKmi07uW7SYk3u8Y5fJ_XwmJsE5VZHyLiF0lAmEjue6EivKd_XA_udz10Rqh7Yqh3iw38S4HUw"
PUBLIC_EXPONENT_BASE64URL = "AQAB"
SHA256_DIGEST_INFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


app = Flask(
    __name__,
    template_folder=str(RESOURCE_DIR / "templates"),
    static_folder=str(RESOURCE_DIR / "static"),
)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "change-this-local-secret-key"),
    UPLOAD_FOLDER=str(UPLOAD_FOLDER),
    MAX_CONTENT_LENGTH=MAX_UPLOAD_SIZE,
)


def sql_values(values):
    return ", ".join("'" + value.replace("'", "''") + "'" for value in values)


def row_get(row, key, default=None):
    if row is None:
        return default
    if isinstance(row, sqlite3.Row):
        return row[key] if key in row.keys() else default
    if isinstance(row, dict):
        return row.get(key, default)
    return getattr(row, key, default)


def repair_amount(motor):
    final_cost = Decimal(str(row_get(motor, "final_cost", 0) or 0))
    estimated_cost = Decimal(str(row_get(motor, "estimated_cost", 0) or 0))
    return float(final_cost if final_cost > 0 else estimated_cost)


def balance_amount(motor):
    amount = Decimal(str(repair_amount(motor)))
    paid = Decimal(str(row_get(motor, "advance_paid", 0) or 0))
    balance = amount - paid
    return float(balance if balance > 0 else Decimal("0"))


def calculate_payment_status(estimated_cost, final_cost, advance_paid):
    amount = Decimal(str(final_cost or 0))
    if amount <= 0:
        amount = Decimal(str(estimated_cost or 0))
    paid = Decimal(str(advance_paid or 0))
    if amount <= 0 or paid <= 0:
        return "Unpaid"
    if paid >= amount:
        return "Paid"
    return "Partial"


def normalize_payment_status(estimated_cost, final_cost, advance_paid, errors, requested_status="", original_status=""):
    requested_status = (requested_status or "").strip()
    original_status = (original_status or "").strip()
    amount = final_cost if final_cost > 0 else estimated_cost
    calculated_status = calculate_payment_status(estimated_cost, final_cost, advance_paid)

    if requested_status not in PAYMENT_STATUSES or requested_status == original_status:
        return advance_paid, calculated_status

    if requested_status == "Paid":
        if amount <= 0:
            errors.append("Repair amount is required before marking payment as paid.")
            return advance_paid, calculated_status
        return amount, "Paid"

    if requested_status == "Unpaid":
        return 0, "Unpaid"

    if requested_status == "Partial":
        if amount <= 0:
            errors.append("Repair amount is required before marking payment as partial.")
        elif advance_paid <= 0 or advance_paid >= amount:
            errors.append("Partial payment needs an advance paid amount less than the repair amount.")
        return advance_paid, calculate_payment_status(estimated_cost, final_cost, advance_paid)

    return advance_paid, calculated_status


def status_slug(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def format_job_number(date_added, sequence):
    try:
        year = datetime.strptime(str(date_added), "%Y-%m-%d").year
    except (TypeError, ValueError):
        year = date.today().year
    return f"MR-{year}-{int(sequence):04d}"


def next_batch_number(db):
    row = db.execute(
        "SELECT COALESCE(MAX(batch_number), 0) + 1 AS next_bn FROM motors"
    ).fetchone()
    return row["next_bn"]


def next_job_number(db):
    next_id = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM motors").fetchone()[0]
    candidate = format_job_number(date.today().isoformat(), next_id)
    while db.execute("SELECT 1 FROM motors WHERE job_number = ?", (candidate,)).fetchone():
        next_id += 1
        candidate = format_job_number(date.today().isoformat(), next_id)
    return candidate


def format_invoice_number(invoice_date, sequence):
    try:
        year = datetime.strptime(str(invoice_date), "%Y-%m-%d").year
    except (TypeError, ValueError):
        year = date.today().year
    return f"INV-{year}-{int(sequence):04d}"


def next_invoice_number(db):
    next_id = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM invoices").fetchone()[0]
    candidate = format_invoice_number(date.today().isoformat(), next_id)
    while db.execute("SELECT 1 FROM invoices WHERE invoice_number = ?", (candidate,)).fetchone():
        next_id += 1
        candidate = format_invoice_number(date.today().isoformat(), next_id)
    return candidate


def map_old_status(value):
    if value in REPAIR_STATUSES:
        return value
    if value == "Completed":
        return "Completed"
    return "Received"


def create_motors_table(db, table_name="motors"):
    db.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_number TEXT NOT NULL UNIQUE,
            customer_name TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            motor_type TEXT NOT NULL,
            problem_description TEXT NOT NULL,
            image_filename TEXT,
            estimated_cost REAL NOT NULL DEFAULT 0,
            final_cost REAL NOT NULL DEFAULT 0,
            advance_paid REAL NOT NULL DEFAULT 0,
            payment_status TEXT NOT NULL CHECK(payment_status IN ({sql_values(PAYMENT_STATUSES)})),
            status TEXT NOT NULL CHECK(status IN ({sql_values(REPAIR_STATUSES)})),
            date_added TEXT NOT NULL,
            deadline_date TEXT NOT NULL,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def ensure_shop_settings(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS shop_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            shop_name TEXT NOT NULL,
            owner_name TEXT,
            phone_number TEXT,
            address TEXT,
            logo_filename TEXT,
            receipt_note TEXT,
            admin_pin TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    now = datetime.now().isoformat(timespec="seconds")
    db.execute(
        """
        INSERT OR IGNORE INTO shop_settings (
            id, shop_name, owner_name, phone_number, address, logo_filename,
            receipt_note, admin_pin, created_at, updated_at
        )
        VALUES (1, 'Motor Repair Manager', '', '', '', '', 'Thank you for your business.', '1234', ?, ?)
        """,
        (now, now),
    )


def ensure_workers_tables(db):
    db.execute(
        f"""
        CREATE TABLE IF NOT EXISTS workers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone_number TEXT,
            role TEXT,
            monthly_salary REAL NOT NULL DEFAULT 0,
            daily_salary REAL NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    columns = {row[1] for row in db.execute("PRAGMA table_info(workers)").fetchall()}
    if "monthly_salary" not in columns:
        db.execute("ALTER TABLE workers ADD COLUMN monthly_salary REAL NOT NULL DEFAULT 0")
    current_month_days = calendar.monthrange(date.today().year, date.today().month)[1]
    db.execute(
        """
        UPDATE workers
        SET monthly_salary = daily_salary * ?
        WHERE COALESCE(monthly_salary, 0) <= 0 AND COALESCE(daily_salary, 0) > 0
        """,
        (current_month_days,),
    )
    db.execute(
        f"""
        CREATE TABLE IF NOT EXISTS worker_attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_id INTEGER NOT NULL,
            work_date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ({sql_values(ATTENDANCE_STATUSES)})),
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE,
            UNIQUE(worker_id, work_date)
        )
        """
    )


def ensure_motor_media_table(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS motor_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            motor_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(motor_id) REFERENCES motors(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_motor_media_unique_file ON motor_media(motor_id, filename)")
    now = datetime.now().isoformat(timespec="seconds")
    db.execute(
        """
        INSERT OR IGNORE INTO motor_media (motor_id, filename, media_type, sort_order, created_at)
        SELECT id, image_filename, 'image', 0, COALESCE(created_at, ?)
        FROM motors
        WHERE image_filename IS NOT NULL AND image_filename != ''
        """,
        (now,),
    )


def ensure_invoice_tables(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT NOT NULL UNIQUE,
            motor_id INTEGER,
            from_details TEXT,
            bill_to TEXT NOT NULL,
            ship_to TEXT,
            invoice_date TEXT NOT NULL,
            payment_terms TEXT,
            due_date TEXT,
            po_number TEXT,
            notes TEXT,
            terms TEXT,
            tax_rate REAL NOT NULL DEFAULT 0,
            discount_amount REAL NOT NULL DEFAULT 0,
            shipping_amount REAL NOT NULL DEFAULT 0,
            amount_paid REAL NOT NULL DEFAULT 0,
            subtotal REAL NOT NULL DEFAULT 0,
            tax_amount REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            balance_due REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(motor_id) REFERENCES motors(id) ON DELETE SET NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            rate REAL NOT NULL DEFAULT 0,
            amount REAL NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )
        """
    )


def add_column_if_missing(db, table_name, column_name, definition):
    columns = {row[1] for row in db.execute(f"PRAGMA table_info({table_name})").fetchall()}
    if column_name not in columns:
        db.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def ensure_phone_import_tables(db):
    add_column_if_missing(db, "motors", "phone_uuid", "TEXT")
    add_column_if_missing(db, "motors", "source_device_id", "TEXT")
    add_column_if_missing(db, "workers", "phone_uuid", "TEXT")
    add_column_if_missing(db, "workers", "source_device_id", "TEXT")
    add_column_if_missing(db, "worker_attendance", "phone_uuid", "TEXT")
    add_column_if_missing(db, "motor_media", "phone_uuid", "TEXT")

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS phone_customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_uuid TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            motor_count INTEGER NOT NULL DEFAULT 0,
            balance_due REAL NOT NULL DEFAULT 0,
            last_activity TEXT,
            source_device_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS worker_salary_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_uuid TEXT UNIQUE,
            worker_id INTEGER NOT NULL,
            payment_date TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            payment_type TEXT NOT NULL DEFAULT 'Paid',
            note TEXT,
            source_device_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
        )
        """
    )
    add_column_if_missing(db, "worker_salary_payments", "payment_type", "TEXT NOT NULL DEFAULT 'Paid'")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_motors_phone_uuid ON motors(phone_uuid)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_phone_uuid ON workers(phone_uuid)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_phone_uuid ON worker_attendance(phone_uuid)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_media_phone_uuid ON motor_media(phone_uuid)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_customers_uuid ON phone_customers(phone_uuid)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_payments_phone_uuid ON worker_salary_payments(phone_uuid)")


def ensure_app_meta_table(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def ensure_batch_number_column(db):
    columns = {row[1] for row in db.execute("PRAGMA table_info(motors)").fetchall()}
    if "batch_number" not in columns:
        db.execute("ALTER TABLE motors ADD COLUMN batch_number INTEGER")
        db.execute(
            """
            UPDATE motors SET batch_number = (
                SELECT COUNT(*) FROM motors m2 WHERE m2.id <= motors.id
            )
            """
        )
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_motors_batch_number ON motors(batch_number)"
        )


def ensure_indexes(db):
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_job_number ON motors(job_number)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_status ON motors(status)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_payment_status ON motors(payment_status)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_phone ON motors(phone_number)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_date_added ON motors(date_added)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_deadline ON motors(deadline_date)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motors_deleted_at ON motors(deleted_at)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_workers_active ON workers(active)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON worker_attendance(worker_id, work_date)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_attendance_date ON worker_attendance(work_date)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_invoices_motor ON invoices(motor_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_motor_media_motor ON motor_media(motor_id)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_motor_media_unique_file ON motor_media(motor_id, filename)")


def migrate_motors_table(db):
    exists = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'motors'"
    ).fetchone()
    if not exists:
        create_motors_table(db)
        return

    table_sql = db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motors'"
    ).fetchone()[0]
    columns = {row[1] for row in db.execute("PRAGMA table_info(motors)").fetchall()}
    required_columns = {
        "job_number",
        "final_cost",
        "advance_paid",
        "payment_status",
        "deleted_at",
    }
    old_status_check = "Pending" in table_sql and "Waiting for Parts" not in table_sql
    needs_rebuild = old_status_check or not required_columns.issubset(columns)

    if not needs_rebuild:
        return

    rows = db.execute("SELECT * FROM motors ORDER BY id").fetchall()
    db.execute("DROP TABLE IF EXISTS motors_old")
    db.execute("ALTER TABLE motors RENAME TO motors_old")
    create_motors_table(db)

    used_job_numbers = set()
    for row in rows:
        row_keys = set(row.keys())
        row_id = row["id"]
        estimated_cost = float(row["estimated_cost"] or 0)
        final_cost = float(row["final_cost"] or 0) if "final_cost" in row_keys else 0
        advance_paid = float(row["advance_paid"] or 0) if "advance_paid" in row_keys else 0
        status = map_old_status(row["status"])
        payment_status = (
            row["payment_status"]
            if "payment_status" in row_keys and row["payment_status"] in PAYMENT_STATUSES
            else calculate_payment_status(estimated_cost, final_cost, advance_paid)
        )
        candidate_job_number = (
            row["job_number"]
            if "job_number" in row_keys and row["job_number"]
            else format_job_number(row["date_added"], row_id)
        )
        job_number = candidate_job_number
        suffix = 1
        while job_number in used_job_numbers:
            suffix += 1
            job_number = f"{candidate_job_number}-{suffix}"
        used_job_numbers.add(job_number)

        db.execute(
            """
            INSERT INTO motors (
                id, job_number, customer_name, phone_number, motor_type,
                problem_description, image_filename, estimated_cost, final_cost,
                advance_paid, payment_status, status, date_added, deadline_date,
                deleted_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                job_number,
                row["customer_name"],
                row["phone_number"],
                row["motor_type"],
                row["problem_description"],
                row["image_filename"],
                estimated_cost,
                final_cost,
                advance_paid,
                payment_status,
                status,
                row["date_added"],
                row["deadline_date"],
                row["deleted_at"] if "deleted_at" in row_keys else None,
                row["created_at"],
                row["updated_at"],
            ),
        )
    db.execute("DROP TABLE motors_old")


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_FOLDER.mkdir(exist_ok=True)
    BACKUP_FOLDER.mkdir(exist_ok=True)
    with sqlite3.connect(DATABASE) as db:
        db.row_factory = sqlite3.Row
        ensure_shop_settings(db)
        ensure_app_meta_table(db)
        ensure_workers_tables(db)
        ensure_invoice_tables(db)
        migrate_motors_table(db)
        ensure_batch_number_column(db)
        ensure_motor_media_table(db)
        ensure_phone_import_tables(db)
        ensure_indexes(db)
        db.commit()


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


def set_app_meta(key, value, db=None):
    db = db or get_db()
    db.execute(
        """
        INSERT INTO app_meta (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        """,
        (key, value, datetime.now().isoformat(timespec="seconds")),
    )


def get_app_meta(key, default=""):
    row = get_db().execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def base64url_decode(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def base64url_to_int(value):
    return int.from_bytes(base64url_decode(value), "big")


def get_pc_installation_id():
    installation_id = get_app_meta("pc_installation_id")
    if installation_id:
        return installation_id
    installation_id = secrets.token_hex(24)
    set_app_meta("pc_installation_id", installation_id)
    get_db().commit()
    return installation_id


def get_pc_device_code():
    digest = hashlib.sha256(f"{APP_ID}:{LICENSE_PLATFORM}:{get_pc_installation_id()}".encode("utf-8")).hexdigest().upper()
    grouped = "-".join(digest[index:index + 4] for index in range(0, 24, 4))
    return f"RWND-PC-{grouped}"


def verify_rsa_sha256_signature(signed_value, signature):
    try:
        modulus = base64url_to_int(PUBLIC_MODULUS_BASE64URL)
        exponent = base64url_to_int(PUBLIC_EXPONENT_BASE64URL)
    except (ValueError, binascii.Error):
        return False

    modulus_length = (modulus.bit_length() + 7) // 8
    if len(signature) != modulus_length:
        return False

    signature_int = int.from_bytes(signature, "big")
    decoded = pow(signature_int, exponent, modulus).to_bytes(modulus_length, "big")
    expected_digest_info = SHA256_DIGEST_INFO_PREFIX + hashlib.sha256(signed_value.encode("utf-8")).digest()
    if not decoded.startswith(b"\x00\x01"):
        return False
    separator_index = decoded.find(b"\x00", 2)
    if separator_index < 10:
        return False
    if decoded[2:separator_index].count(0xFF) != separator_index - 2:
        return False
    return hmac.compare_digest(decoded[separator_index + 1:], expected_digest_info)


def verify_license_key(raw_key):
    cleaned = re.sub(r"\s+", "", raw_key or "")
    if not cleaned:
        return {"valid": False, "reason": "License is required.", "payload": None}

    parts = cleaned.split(".")
    if len(parts) != 3 or parts[0] != LICENSE_PREFIX:
        return {"valid": False, "reason": "License format is invalid.", "payload": None}

    payload_b64, signature_b64 = parts[1], parts[2]
    try:
        payload = json.loads(base64url_decode(payload_b64).decode("utf-8"))
        signature = base64url_decode(signature_b64)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, binascii.Error):
        return {"valid": False, "reason": "License format is invalid.", "payload": None}

    if not verify_rsa_sha256_signature(payload_b64, signature):
        return {"valid": False, "reason": "License signature is invalid.", "payload": payload}
    if payload.get("appId") != APP_ID:
        return {"valid": False, "reason": "License is for a different app.", "payload": payload}
    if payload.get("platform") != LICENSE_PLATFORM:
        return {"valid": False, "reason": "License is not for the PC software.", "payload": payload}
    if payload.get("deviceId") != get_pc_device_code():
        return {"valid": False, "reason": "License is for a different device.", "payload": payload}
    if payload.get("licenseType") != "permanent":
        return {"valid": False, "reason": "License type is not supported.", "payload": payload}
    return {"valid": True, "reason": "", "payload": payload, "key": cleaned}


def get_license_status():
    raw_key = get_app_meta("license_key")
    status = verify_license_key(raw_key) if raw_key else {"valid": False, "reason": "License is required.", "payload": None}
    status["device_code"] = get_pc_device_code()
    status["activated_at"] = get_app_meta("license_activated_at")
    return status


def save_license(raw_key, payload):
    set_app_meta("license_key", raw_key)
    set_app_meta("license_payload_json", json.dumps(payload, separators=(",", ":")))
    set_app_meta("license_activated_at", datetime.now().isoformat(timespec="seconds"))
    get_db().commit()


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


@app.before_request
def protect_forms():
    session.setdefault("_csrf_token", uuid.uuid4().hex)
    if request.method == "POST":
        submitted = request.form.get("_csrf_token", "")
        expected = session.get("_csrf_token", "")
        if not hmac.compare_digest(submitted, expected):
            abort(400, "Invalid form token.")


@app.before_request
def require_valid_license():
    public_endpoints = {"static", "activate", "uploaded_file"}
    if request.endpoint in public_endpoints:
        return None
    if request.endpoint is None:
        return None
    if request.endpoint in INVOICE_ENDPOINTS:
        abort(404)
    status = get_license_status()
    g.license_status = status
    if not status["valid"]:
        return redirect(url_for("activate"))
    return None


@app.context_processor
def inject_template_helpers():
    def asset_url(filename):
        asset_path = RESOURCE_DIR / "static" / filename
        try:
            version = int(asset_path.stat().st_mtime)
        except OSError:
            version = 1
        return url_for("static", filename=filename, v=version)

    return {
        "csrf_token": session.get("_csrf_token", ""),
        "asset_url": asset_url,
        "current_shop_settings": dict(get_shop_settings()),
        "repair_statuses": REPAIR_STATUSES,
        "payment_statuses": PAYMENT_STATUSES,
        "attendance_statuses": ATTENDANCE_STATUSES,
        "done_statuses": WORK_DONE_STATUSES,
        "repair_amount": repair_amount,
        "balance_amount": balance_amount,
        "whatsapp_url": whatsapp_url,
        "license_status": getattr(g, "license_status", None),
    }


@app.template_filter("money")
def money(value):
    try:
        amount = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        amount = Decimal("0.00")
    return f"Rs. {amount:,.2f}"


@app.template_filter("display_date")
def display_date(value):
    try:
        parsed = datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return value
    return parsed.strftime("%d %b %Y")


@app.template_filter("status_slug")
def status_slug_filter(value):
    return status_slug(value)


def clean_text(value, label, errors, max_length=255, required=True):
    value = (value or "").strip()
    if required and not value:
        errors.append(f"{label} is required.")
    if value and len(value) > max_length:
        errors.append(f"{label} must be {max_length} characters or less.")
    return value


def parse_money(value, label, errors, required=False):
    value = (value or "").strip()
    if not value:
        if required:
            errors.append(f"{label} is required.")
        return 0
    try:
        amount = Decimal(value)
    except InvalidOperation:
        errors.append(f"{label} must be a valid number.")
        return 0
    if amount < 0:
        errors.append(f"{label} cannot be negative.")
    if amount > Decimal("10000000"):
        errors.append(f"{label} is too large.")
    return float(amount.quantize(Decimal("0.01")))


def parse_deadline(value, errors):
    value = (value or "").strip()
    if not value:
        errors.append("Deadline date is required.")
        return ""
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError:
        errors.append("Deadline date must be a valid date.")
        return value


def parse_optional_date(value, label, errors):
    value = (value or "").strip()
    if not value:
        return ""
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError:
        errors.append(f"{label} must be a valid date.")
        return value


def validate_phone(value, errors):
    value = (value or "").strip()
    if not value:
        errors.append("Phone number is required.")
        return ""
    if not re.fullmatch(r"\d{10}", value):
        errors.append("Phone number must contain exactly 10 digits.")
        return value
    return value


def validate_optional_phone(value, label, errors):
    value = (value or "").strip()
    if not value:
        return ""
    if not re.fullmatch(r"\d{10}", value):
        errors.append(f"{label} must contain exactly 10 digits.")
        return value
    return value


def phone_digits(value):
    return re.sub(r"\D", "", value or "")


def phone_digits_match(submitted, registered):
    submitted_digits = phone_digits(submitted)
    registered_digits = phone_digits(registered)
    if len(submitted_digits) != 10 or len(registered_digits) != 10:
        return False
    return submitted_digits == registered_digits


def file_extension(filename):
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()


def allowed_extension(filename, allowed_extensions=ALLOWED_EXTENSIONS):
    return file_extension(filename) in allowed_extensions


def has_valid_image_signature(file_storage):
    header = file_storage.stream.read(32)
    file_storage.stream.seek(0)
    return has_valid_image_bytes(header)


def has_valid_image_bytes(header):
    if header.startswith(b"\xff\xd8\xff"):
        return True
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if header.startswith((b"GIF87a", b"GIF89a")):
        return True
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return True
    return False


def has_valid_video_signature(file_storage):
    header = file_storage.stream.read(64)
    file_storage.stream.seek(0)
    extension = file_extension(file_storage.filename)
    if extension == "webm":
        return header.startswith(b"\x1a\x45\xdf\xa3")
    if extension in {"mp4", "m4v", "mov"}:
        return b"ftyp" in header[4:20]
    return False


def validate_upload(file_storage, errors):
    if not file_storage or not file_storage.filename:
        return None
    if not allowed_extension(file_storage.filename, ALLOWED_IMAGE_EXTENSIONS):
        errors.append("Upload must be an image file: PNG, JPG, JPEG, GIF, or WEBP.")
        return None
    if not has_valid_image_signature(file_storage):
        errors.append("Uploaded file is not a valid image.")
        return None
    return file_storage


def validate_motor_media_upload(file_storage, errors):
    if not file_storage or not file_storage.filename:
        return None
    extension = file_extension(file_storage.filename)
    if extension in ALLOWED_IMAGE_EXTENSIONS:
        if not has_valid_image_signature(file_storage):
            errors.append(f"{file_storage.filename} is not a valid image.")
            return None
        return {"file": file_storage, "media_type": "image"}
    if extension in ALLOWED_VIDEO_EXTENSIONS:
        if not has_valid_video_signature(file_storage):
            errors.append(f"{file_storage.filename} is not a valid video.")
            return None
        return {"file": file_storage, "media_type": "video"}
    errors.append("Motor media must be images or videos: PNG, JPG, JPEG, GIF, WEBP, MP4, WEBM, MOV, or M4V.")
    return None


def validate_motor_media_uploads(file_storages, errors):
    media_files = []
    for file_storage in file_storages:
        media = validate_motor_media_upload(file_storage, errors)
        if media:
            media_files.append(media)
    return media_files


def save_upload(file_storage):
    original_name = secure_filename(file_storage.filename)
    extension = original_name.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{extension}"
    file_storage.save(UPLOAD_FOLDER / filename)
    return filename


def save_logo_data_url(data_url, errors):
    data_url = (data_url or "").strip()
    if not data_url:
        return None
    match = re.fullmatch(r"data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)", data_url)
    if not match:
        errors.append("Cropped logo data is not a valid image.")
        return None
    extension = "jpg" if match.group(1) == "jpeg" else match.group(1)
    try:
        image_bytes = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        errors.append("Cropped logo data could not be decoded.")
        return None
    if len(image_bytes) > MAX_UPLOAD_SIZE:
        errors.append("Cropped logo is too large.")
        return None
    if not has_valid_image_bytes(image_bytes[:32]):
        errors.append("Cropped logo is not a valid image.")
        return None
    filename = f"{uuid.uuid4().hex}.{extension}"
    (UPLOAD_FOLDER / filename).write_bytes(image_bytes)
    return filename


def delete_upload(filename):
    if not filename:
        return
    upload_path = (UPLOAD_FOLDER / filename).resolve()
    uploads_root = UPLOAD_FOLDER.resolve()
    if uploads_root not in upload_path.parents:
        return
    if upload_path.exists():
        upload_path.unlink()


def get_motor_media(motor_id):
    return [
        dict(row)
        for row in get_db()
        .execute(
            """
            SELECT id, motor_id, filename, media_type, sort_order, created_at
            FROM motor_media
            WHERE motor_id = ?
            ORDER BY sort_order ASC, id ASC
            """,
            (motor_id,),
        )
        .fetchall()
    ]


def get_motor_media_map(motor_ids):
    if not motor_ids:
        return {}
    placeholders = ", ".join("?" for _ in motor_ids)
    rows = get_db().execute(
        f"""
        SELECT id, motor_id, filename, media_type, sort_order, created_at
        FROM motor_media
        WHERE motor_id IN ({placeholders})
        ORDER BY sort_order ASC, id ASC
        """,
        motor_ids,
    ).fetchall()
    media_map = {motor_id: [] for motor_id in motor_ids}
    for row in rows:
        media_map.setdefault(row["motor_id"], []).append(dict(row))
    return media_map


def attach_media_to_motors(motors):
    motor_ids = [motor["id"] for motor in motors]
    media_map = get_motor_media_map(motor_ids)
    for motor in motors:
        media = media_map.get(motor["id"], [])
        if not media and motor.get("image_filename"):
            media = [
                {
                    "id": None,
                    "motor_id": motor["id"],
                    "filename": motor["image_filename"],
                    "media_type": "image",
                    "sort_order": 0,
                    "created_at": motor.get("created_at"),
                }
            ]
        motor["media"] = media
        motor["primary_media"] = media[0] if media else None
    return motors


def save_motor_media_records(db, motor_id, media_files):
    if not media_files:
        return []
    next_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM motor_media WHERE motor_id = ?",
        (motor_id,),
    ).fetchone()[0]
    now = datetime.now().isoformat(timespec="seconds")
    saved_media = []
    for offset, media in enumerate(media_files):
        filename = save_upload(media["file"])
        db.execute(
            """
            INSERT INTO motor_media (motor_id, filename, media_type, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (motor_id, filename, media["media_type"], next_order + offset, now),
        )
        saved_media.append({"filename": filename, "media_type": media["media_type"]})
    return saved_media


def primary_motor_image_filename(db, motor_id):
    row = db.execute(
        """
        SELECT filename
        FROM motor_media
        WHERE motor_id = ? AND media_type = 'image'
        ORDER BY sort_order ASC, id ASC
        LIMIT 1
        """,
        (motor_id,),
    ).fetchone()
    return row["filename"] if row else None


def collect_motor_form():
    errors = []
    estimated_cost = parse_money(request.form.get("estimated_cost"), "Estimated cost", errors, required=True)
    final_cost = parse_money(request.form.get("final_cost"), "Final cost", errors)
    advance_paid = parse_money(request.form.get("advance_paid"), "Advance paid", errors)
    amount = final_cost if final_cost > 0 else estimated_cost
    if amount > 0 and advance_paid > amount:
        errors.append("Advance paid cannot be greater than the repair amount.")
    advance_paid, payment_status = normalize_payment_status(
        estimated_cost,
        final_cost,
        advance_paid,
        errors,
        request.form.get("payment_status"),
        request.form.get("original_payment_status"),
    )

    data = {
        "customer_name": clean_text(request.form.get("customer_name"), "Customer name", errors),
        "phone_number": validate_phone(request.form.get("phone_number"), errors),
        "motor_type": clean_text(request.form.get("motor_type"), "Motor type", errors),
        "problem_description": clean_text(
            request.form.get("problem_description"),
            "Problem description",
            errors,
            max_length=1500,
        ),
        "estimated_cost": estimated_cost,
        "final_cost": final_cost,
        "advance_paid": advance_paid,
        "payment_status": payment_status,
        "status": (request.form.get("status") or "").strip(),
        "deadline_date": parse_deadline(request.form.get("deadline_date"), errors),
    }
    if data["status"] not in REPAIR_STATUSES:
        errors.append("Status must be a valid repair stage.")
    media_uploads = list(request.files.getlist("media")) + list(request.files.getlist("media[]"))
    legacy_image = request.files.get("image")
    if legacy_image and legacy_image.filename:
        media_uploads.append(legacy_image)
    media_files = validate_motor_media_uploads(media_uploads, errors)
    return data, media_files, errors


def calculate_invoice_totals(items, tax_rate, discount_amount, shipping_amount, amount_paid):
    subtotal = sum(Decimal(str(item["amount"])) for item in items)
    tax = (subtotal * Decimal(str(tax_rate or 0)) / Decimal("100")).quantize(Decimal("0.01"))
    discount = Decimal(str(discount_amount or 0))
    shipping = Decimal(str(shipping_amount or 0))
    paid = Decimal(str(amount_paid or 0))
    total = subtotal + tax + shipping - discount
    if total < 0:
        total = Decimal("0.00")
    balance = total - paid
    if balance < 0:
        balance = Decimal("0.00")
    return {
        "subtotal": float(subtotal.quantize(Decimal("0.01"))),
        "tax_amount": float(tax),
        "total": float(total.quantize(Decimal("0.01"))),
        "balance_due": float(balance.quantize(Decimal("0.01"))),
    }


def collect_invoice_form(existing_invoice=None):
    errors = []
    db = get_db()
    invoice_number = clean_text(request.form.get("invoice_number"), "Invoice number", errors, max_length=60)
    invoice_id = row_get(existing_invoice, "id")
    duplicate_params = [invoice_number]
    duplicate_query = "SELECT 1 FROM invoices WHERE invoice_number = ?"
    if invoice_id:
        duplicate_query += " AND id != ?"
        duplicate_params.append(invoice_id)
    if invoice_number and db.execute(duplicate_query, duplicate_params).fetchone():
        errors.append("Invoice number already exists.")

    motor_id = (request.form.get("motor_id") or "").strip()
    motor_id_value = int(motor_id) if motor_id.isdigit() else None
    if motor_id and motor_id_value is None:
        errors.append("Imported motor job is invalid.")

    descriptions = request.form.getlist("item_description[]")
    quantities = request.form.getlist("item_quantity[]")
    rates = request.form.getlist("item_rate[]")
    items = []
    for index, description in enumerate(descriptions):
        description = clean_text(description, "Item description", errors, max_length=700, required=False)
        if not description:
            continue
        quantity = parse_money(quantities[index] if index < len(quantities) else "1", "Item quantity", errors, required=True)
        rate = parse_money(rates[index] if index < len(rates) else "0", "Item rate", errors, required=True)
        if quantity <= 0:
            errors.append("Item quantity must be greater than zero.")
        amount = float((Decimal(str(quantity)) * Decimal(str(rate))).quantize(Decimal("0.01")))
        items.append(
            {
                "description": description,
                "quantity": quantity,
                "rate": rate,
                "amount": amount,
                "sort_order": len(items),
            }
        )
    if not items:
        errors.append("Add at least one invoice item.")

    invoice_date = parse_optional_date(request.form.get("invoice_date"), "Invoice date", errors)
    if not invoice_date:
        errors.append("Invoice date is required.")

    tax_rate = parse_money(request.form.get("tax_rate"), "Tax", errors)
    discount_amount = parse_money(request.form.get("discount_amount"), "Discount", errors)
    shipping_amount = parse_money(request.form.get("shipping_amount"), "Shipping", errors)
    amount_paid = parse_money(request.form.get("amount_paid"), "Amount paid", errors)

    totals = calculate_invoice_totals(items, tax_rate, discount_amount, shipping_amount, amount_paid)
    data = {
        "invoice_number": invoice_number,
        "motor_id": motor_id_value,
        "from_details": clean_text(request.form.get("from_details"), "From details", errors, max_length=1200, required=False),
        "bill_to": clean_text(request.form.get("bill_to"), "Bill to", errors, max_length=1200),
        "ship_to": clean_text(request.form.get("ship_to"), "Ship to", errors, max_length=1200, required=False),
        "invoice_date": invoice_date,
        "payment_terms": clean_text(request.form.get("payment_terms"), "Payment terms", errors, max_length=255, required=False),
        "due_date": parse_optional_date(request.form.get("due_date"), "Due date", errors),
        "po_number": clean_text(request.form.get("po_number"), "PO number", errors, max_length=120, required=False),
        "notes": clean_text(request.form.get("notes"), "Notes", errors, max_length=1200, required=False),
        "terms": clean_text(request.form.get("terms"), "Terms", errors, max_length=1200, required=False),
        "tax_rate": tax_rate,
        "discount_amount": discount_amount,
        "shipping_amount": shipping_amount,
        "amount_paid": amount_paid,
        **totals,
    }
    return data, items, errors


def invoice_from_motor_defaults(motor=None):
    settings = get_shop_settings()
    db = get_db()
    today = date.today()
    invoice_number = next_invoice_number(db)
    from_details = "\n".join(
        item
        for item in [
            settings["shop_name"],
            settings["owner_name"],
            settings["phone_number"],
            settings["address"],
        ]
        if item
    )
    invoice = {
        "invoice_number": invoice_number,
        "motor_id": "",
        "from_details": from_details,
        "bill_to": "",
        "ship_to": "",
        "invoice_date": today.isoformat(),
        "payment_terms": "Due on receipt",
        "due_date": today.isoformat(),
        "po_number": "",
        "notes": "",
        "terms": settings["receipt_note"] or "Thank you for your business.",
        "tax_rate": 0,
        "discount_amount": 0,
        "shipping_amount": 0,
        "amount_paid": 0,
        "subtotal": 0,
        "tax_amount": 0,
        "total": 0,
        "balance_due": 0,
    }
    items = [{"description": "", "quantity": 1, "rate": 0, "amount": 0, "sort_order": 0}]
    if motor:
        amount = repair_amount(motor)
        invoice.update(
            {
                "motor_id": motor["id"],
                "bill_to": f"{motor['customer_name']}\n{motor['phone_number']}",
                "ship_to": f"{motor['customer_name']}\n{motor['phone_number']}",
                "due_date": motor["deadline_date"],
                "po_number": motor["job_number"],
                "notes": f"Imported from motor job {motor['job_number']}.",
                "amount_paid": motor["advance_paid"],
            }
        )
        items = [
            {
                "description": f"{motor['motor_type']} repair - {motor['problem_description']}",
                "quantity": 1,
                "rate": amount,
                "amount": amount,
                "sort_order": 0,
            }
        ]
        totals = calculate_invoice_totals(items, invoice["tax_rate"], invoice["discount_amount"], invoice["shipping_amount"], invoice["amount_paid"])
        invoice.update(totals)
    return invoice, items


def get_invoice_or_404(invoice_id):
    invoice = get_db().execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if invoice is None:
        abort(404)
    return invoice


def get_invoice_items(invoice_id):
    return get_db().execute(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC",
        (invoice_id,),
    ).fetchall()


def get_motor_or_404(motor_id, include_deleted=False):
    query = "SELECT * FROM motors WHERE id = ?"
    params = [motor_id]
    if not include_deleted:
        query += " AND deleted_at IS NULL"
    motor = get_db().execute(query, params).fetchone()
    if motor is None:
        abort(404)
    return motor


def get_shop_settings():
    return get_db().execute("SELECT * FROM shop_settings WHERE id = 1").fetchone()


def whatsapp_url(motor):
    phone = re.sub(r"\D", "", row_get(motor, "phone_number", ""))
    if len(phone) == 10:
        phone = f"91{phone}"
    if not phone:
        return "#"

    job_number = row_get(motor, "job_number", "")
    customer_name = row_get(motor, "customer_name", "")
    status = row_get(motor, "status", "")
    deadline = display_date(row_get(motor, "deadline_date", ""))
    amount = money(repair_amount(motor))

    if status == "Completed":
        message = f"Hello {customer_name}, your motor repair job {job_number} is completed. Amount: {amount}. Please collect it from our shop."
    elif status == "Delivered":
        message = f"Hello {customer_name}, thank you. Your motor repair job {job_number} has been delivered."
    else:
        message = f"Hello {customer_name}, your motor repair job {job_number} status is {status}. Deadline: {deadline}."
    return f"https://wa.me/{phone}?text={quote(message)}"


def report_redirect():
    attendance_month = request.form.get("attendance_month") or request.args.get("month") or date.today().strftime("%Y-%m")
    return redirect(url_for("workers", month=attendance_month))


def build_worker_month_context(attendance_month=None):
    today_date = date.today()
    attendance_month = (attendance_month or today_date.strftime("%Y-%m")).strip()
    try:
        month_anchor = datetime.strptime(attendance_month, "%Y-%m").date()
    except ValueError:
        flash("Attendance month must be valid.", "error")
        month_anchor = today_date.replace(day=1)
        attendance_month = month_anchor.strftime("%Y-%m")

    month_start = month_anchor.replace(day=1)
    month_end = month_anchor.replace(day=calendar.monthrange(month_anchor.year, month_anchor.month)[1])
    month_days = [
        month_start + timedelta(days=offset)
        for offset in range((month_end - month_start).days + 1)
    ]
    prev_month = (month_start - timedelta(days=1)).replace(day=1).strftime("%Y-%m")
    next_month = (month_end + timedelta(days=1)).replace(day=1).strftime("%Y-%m")
    today = today_date.isoformat()
    month_leading_blanks = (month_start.weekday() + 1) % 7

    db = get_db()
    worker_rows = [
        dict(row)
        for row in db.execute(
            """
            SELECT
                w.id,
                w.name,
                w.phone_number,
                w.role,
                w.monthly_salary,
                w.daily_salary,
                w.active,
                w.created_at,
                w.updated_at,
                today_att.status AS today_status,
                today_att.note AS today_note,
                COALESCE(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END), 0) AS present_days,
                COALESCE(SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END), 0) AS leave_days,
                COALESCE(SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END), 0) AS absent_days
            FROM workers w
            LEFT JOIN worker_attendance a
                ON a.worker_id = w.id AND a.work_date BETWEEN ? AND ?
            LEFT JOIN worker_attendance today_att
                ON today_att.worker_id = w.id AND today_att.work_date = ?
            GROUP BY w.id
            ORDER BY w.active DESC, w.name ASC
            """,
            (month_start.isoformat(), month_end.isoformat(), today),
        ).fetchall()
    ]
    attendance_records = db.execute(
        """
        SELECT worker_id, work_date, status, note
        FROM worker_attendance
        WHERE work_date BETWEEN ? AND ?
        """,
        (month_start.isoformat(), month_end.isoformat()),
    ).fetchall()
    attendance_map = {}
    latest_activity_map = {}
    for record in attendance_records:
        attendance_map[(record["worker_id"], record["work_date"])] = {
            "status": record["status"],
            "note": record["note"] or "",
        }
        latest_activity = latest_activity_map.get(record["worker_id"])
        if latest_activity is None or record["work_date"] > latest_activity["date"]:
            latest_activity_map[record["worker_id"]] = {
                "date": record["work_date"],
                "status": record["status"],
            }

    worker_ids = [row["id"] for row in worker_rows]
    salary_payment_map = {worker_id: {"total": 0, "records": []} for worker_id in worker_ids}
    if worker_ids:
        placeholders = ", ".join("?" for _ in worker_ids)
        payment_rows = [
            dict(row)
            for row in db.execute(
                f"""
                SELECT id, worker_id, payment_date, amount, payment_type, note
                FROM worker_salary_payments
                WHERE worker_id IN ({placeholders})
                    AND payment_date BETWEEN ? AND ?
                ORDER BY payment_date DESC, id DESC
                """,
                (*worker_ids, month_start.isoformat(), month_end.isoformat()),
            ).fetchall()
        ]
        for payment in payment_rows:
            bucket = salary_payment_map.setdefault(payment["worker_id"], {"total": 0, "records": []})
            bucket["total"] += float(payment["amount"] or 0)
            bucket["records"].append(payment)

    if month_start <= today_date <= month_end:
        attendance_scope_days = (today_date - month_start).days + 1
    else:
        attendance_scope_days = len(month_days)

    attendance_scope_days = max(attendance_scope_days, 1)
    month_day_count = len(month_days)

    for row in worker_rows:
        present_days = int(row["present_days"] or 0)
        leave_days = int(row["leave_days"] or 0)
        absent_days = int(row["absent_days"] or 0)
        marked_days = present_days + leave_days + absent_days
        attendance_progress = min(100, round(marked_days / attendance_scope_days * 100))
        workload_ratio = present_days / attendance_scope_days
        monthly_salary = float(row["monthly_salary"] or 0)
        if monthly_salary <= 0:
            monthly_salary = float(row["daily_salary"] or 0) * month_day_count
        daily_salary = monthly_salary / month_day_count if month_day_count else 0
        row["monthly_salary"] = monthly_salary
        row["daily_salary"] = daily_salary
        row["salary_earned"] = present_days * daily_salary
        row["salary_deducted"] = (leave_days + absent_days) * daily_salary
        row["salary_paid"] = salary_payment_map.get(row["id"], {}).get("total", 0)
        row["salary_balance"] = row["salary_earned"] - row["salary_paid"]
        if row["salary_balance"] < 0:
            row["salary_balance_label"] = "Advance extra"
            row["salary_balance_slug"] = "advance-extra"
        elif row["salary_balance"] > 0:
            row["salary_balance_label"] = "To pay"
            row["salary_balance_slug"] = "to-pay"
        else:
            row["salary_balance_label"] = "Settled"
            row["salary_balance_slug"] = "settled"
        row["salary_payments"] = salary_payment_map.get(row["id"], {}).get("records", [])[:3]
        row["today_salary"] = daily_salary if row["today_status"] == "Present" else 0

        if not row["active"]:
            availability = "Offline"
            workload_label = "Inactive"
            row_alert = "Inactive"
        elif row["today_status"] == "Leave":
            availability = "On Leave"
            workload_label = "Paused"
            row_alert = "Leave today"
        elif row["today_status"] == "Absent":
            availability = "Offline"
            workload_label = "Needs review"
            row_alert = "Absent today"
        elif workload_ratio >= 0.85:
            availability = "Busy"
            workload_label = "High"
            row_alert = "High workload"
        elif workload_ratio >= 0.45:
            availability = "Available"
            workload_label = "Steady"
            row_alert = ""
        else:
            availability = "Available"
            workload_label = "Light"
            row_alert = ""

        latest_activity = latest_activity_map.get(row["id"])
        if latest_activity:
            last_activity_label = f"{latest_activity['status']} on {display_date(latest_activity['date'])}"
            last_activity_date = latest_activity["date"]
        else:
            last_activity_label = "No attendance yet"
            last_activity_date = ""

        row["marked_days"] = marked_days
        row["attendance_scope_days"] = attendance_scope_days
        row["attendance_progress"] = attendance_progress
        row["availability"] = availability
        row["availability_slug"] = status_slug(availability)
        row["workload_label"] = workload_label
        row["workload_slug"] = status_slug(workload_label)
        row["row_alert"] = row_alert
        row["row_alert_slug"] = status_slug(row_alert or "normal")
        row["last_activity_label"] = last_activity_label
        row["last_activity_date"] = last_activity_date
        row["days"] = [
            {
                "date": day.isoformat(),
                "day": day.day,
                "weekday": day.strftime("%a"),
                "is_today": day.isoformat() == today,
                "record": attendance_map.get((row["id"], day.isoformat()), {"status": "", "note": ""}),
            }
            for day in month_days
        ]

    worker_summary = {
        "total_workers": len(worker_rows),
        "active_workers": sum(1 for row in worker_rows if row["active"]),
        "present_today": sum(1 for row in worker_rows if row["today_status"] == "Present"),
        "leave_today": sum(1 for row in worker_rows if row["today_status"] == "Leave"),
        "absent_today": sum(1 for row in worker_rows if row["today_status"] == "Absent"),
        "busy_workers": sum(1 for row in worker_rows if row["availability"] == "Busy"),
        "marked_days_total": sum(row["marked_days"] for row in worker_rows),
        "attendance_scope_days": attendance_scope_days,
        "today_salary_total": sum(float(row["today_salary"] or 0) for row in worker_rows),
        "period_salary_total": sum(float(row["salary_earned"] or 0) for row in worker_rows),
        "period_deduction_total": sum(float(row["salary_deducted"] or 0) for row in worker_rows),
        "period_paid_total": sum(float(row["salary_paid"] or 0) for row in worker_rows),
        "period_balance_total": sum(float(row["salary_balance"] or 0) for row in worker_rows),
    }
    return {
        "attendance_month": attendance_month,
        "attendance_month_label": month_start.strftime("%B %Y"),
        "prev_month": prev_month,
        "next_month": next_month,
        "month_days": month_days,
        "month_leading_blanks": month_leading_blanks,
        "today": today,
        "worker_rows": worker_rows,
        "worker_summary": worker_summary,
    }


@app.route("/activate", methods=("GET", "POST"))
def activate():
    status = get_license_status()
    if status["valid"]:
        return redirect(url_for("dashboard"))

    license_key = ""
    if request.method == "POST":
        license_key = request.form.get("license_key", "")
        status = verify_license_key(license_key)
        status["device_code"] = get_pc_device_code()
        if status["valid"]:
            save_license(status["key"], status["payload"])
            flash("PC software activated successfully.", "success")
            return redirect(url_for("dashboard"))
        flash(status["reason"], "error")

    return render_template(
        "activation.html",
        device_code=get_pc_device_code(),
        license_key=license_key,
        status=status,
    )


def motor_period_filter_from_request():
    period = (request.args.get("period") or "all").strip().lower()
    today_value = date.today()
    selected_date = (request.args.get("date") or today_value.isoformat()).strip()
    selected_month = (request.args.get("month") or today_value.strftime("%Y-%m")).strip()
    selected_start = (request.args.get("start_date") or today_value.isoformat()).strip()
    selected_end = (request.args.get("end_date") or today_value.isoformat()).strip()
    context = {
        "period": "all",
        "date": selected_date,
        "month": selected_month,
        "start_date": selected_start,
        "end_date": selected_end,
        "label": "All dates",
        "where": "",
        "params": [],
    }

    if period == "today":
        context.update(
            {
                "period": "today",
                "date": today_value.isoformat(),
                "label": f"Today: {display_date(today_value.isoformat())}",
                "where": "date_added = ?",
                "params": [today_value.isoformat()],
            }
        )
    elif period == "day":
        try:
            parsed_date = datetime.strptime(selected_date, "%Y-%m-%d").date()
        except ValueError:
            parsed_date = today_value
            selected_date = parsed_date.isoformat()
        context.update(
            {
                "period": "day",
                "date": selected_date,
                "label": f"Date: {display_date(selected_date)}",
                "where": "date_added = ?",
                "params": [parsed_date.isoformat()],
            }
        )
    elif period == "month":
        try:
            month_start = datetime.strptime(selected_month, "%Y-%m").date()
        except ValueError:
            selected_month = today_value.strftime("%Y-%m")
            month_start = today_value.replace(day=1)
        month_end = month_start.replace(day=calendar.monthrange(month_start.year, month_start.month)[1])
        context.update(
            {
                "period": "month",
                "month": selected_month,
                "label": month_start.strftime("Month: %B %Y"),
                "where": "date_added BETWEEN ? AND ?",
                "params": [month_start.isoformat(), month_end.isoformat()],
            }
        )
    elif period == "range":
        try:
            start_date = datetime.strptime(selected_start, "%Y-%m-%d").date()
        except ValueError:
            start_date = today_value
            selected_start = start_date.isoformat()
        try:
            end_date = datetime.strptime(selected_end, "%Y-%m-%d").date()
        except ValueError:
            end_date = start_date
            selected_end = end_date.isoformat()
        if end_date < start_date:
            end_date = start_date
            selected_end = selected_start
        context.update(
            {
                "period": "range",
                "start_date": selected_start,
                "end_date": selected_end,
                "label": f"Range: {display_date(selected_start)} - {display_date(selected_end)}",
                "where": "date_added BETWEEN ? AND ?",
                "params": [selected_start, selected_end],
            }
        )

    return context


@app.route("/")
@app.route("/dashboard")
def dashboard():
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    period_filter = motor_period_filter_from_request()
    filters = ["deleted_at IS NULL"]
    params = []
    if period_filter["where"]:
        filters.append(period_filter["where"])
        params.extend(period_filter["params"])
    where_clause = f"WHERE {' AND '.join(filters)}"
    stats = get_db().execute(
        f"""
        SELECT
            COUNT(*) AS total_motors,
            SUM(CASE WHEN date_added = ? THEN 1 ELSE 0 END) AS motors_today,
            SUM(CASE WHEN status NOT IN ({sql_values(WORK_DONE_STATUSES)}) THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status IN ({sql_values(WORK_DONE_STATUSES)}) THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN status NOT IN ({sql_values(WORK_DONE_STATUSES)}) AND deadline_date < ? THEN 1 ELSE 0 END) AS overdue_count,
            COALESCE(SUM(CASE WHEN status IN ({sql_values(WORK_DONE_STATUSES)}) AND date_added = ? THEN CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END ELSE 0 END), 0) AS earnings_today,
            COALESCE(SUM(CASE WHEN status IN ({sql_values(WORK_DONE_STATUSES)}) THEN CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END ELSE 0 END), 0) AS total_earnings,
            COALESCE(SUM(advance_paid), 0) AS collected_total,
            COALESCE(SUM(CASE WHEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) > advance_paid THEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) - advance_paid ELSE 0 END), 0) AS pending_balance,
            COUNT(DISTINCT phone_number) AS customer_count
        FROM motors
        {where_clause}
        """,
        (today, today, today, *params),
    ).fetchone()
    recent_motors = get_db().execute(
        f"SELECT * FROM motors {where_clause} ORDER BY id DESC LIMIT 6",
        params,
    ).fetchall()
    overdue_motors = [dict(row) for row in get_db().execute(
        f"""
        SELECT * FROM motors
        {where_clause}
            AND status NOT IN ({sql_values(WORK_DONE_STATUSES)})
            AND deadline_date < ?
        ORDER BY deadline_date ASC, id ASC
        LIMIT 6
        """,
        (*params, today),
    ).fetchall()]
    pending_payment_motors = [dict(row) for row in get_db().execute(
        f"""
        SELECT * FROM motors
        {where_clause}
            AND payment_status != 'Paid'
            AND (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) > advance_paid
        ORDER BY deadline_date ASC, id ASC
        LIMIT 6
        """,
        params,
    ).fetchall()]
    attention_motors = [dict(row) for row in get_db().execute(
        f"""
        SELECT * FROM motors
        {where_clause}
            AND status NOT IN ({sql_values(WORK_DONE_STATUSES)})
            AND (deadline_date <= ? OR payment_status != 'Paid')
        ORDER BY deadline_date ASC, id ASC
        LIMIT 8
        """,
        (*params, tomorrow),
    ).fetchall()]
    attach_media_to_motors(overdue_motors)
    attach_media_to_motors(pending_payment_motors)
    attach_media_to_motors(attention_motors)
    recent_motors = [dict(row) for row in recent_motors]
    attach_media_to_motors(recent_motors)
    return render_template(
        "dashboard.html",
        stats=stats,
        shop_settings=dict(get_shop_settings()),
        recent_motors=recent_motors,
        overdue_motors=overdue_motors,
        pending_payment_motors=pending_payment_motors,
        attention_motors=attention_motors,
        period_filter=period_filter,
        today=today,
        tomorrow=tomorrow,
    )


@app.route("/motors")
def motors():
    today = date.today().isoformat()
    active_filter = (request.args.get("filter") or "all").lower()
    search = (request.args.get("q") or "").strip()
    filters = ["deleted_at IS NULL"]
    params = []
    period_filter = motor_period_filter_from_request()
    summary = dict(
        get_db()
        .execute(
            f"""
            SELECT
                COUNT(*) AS total_motors,
                SUM(CASE WHEN date_added = ? THEN 1 ELSE 0 END) AS motors_today,
                SUM(CASE WHEN status NOT IN ({sql_values(WORK_DONE_STATUSES)}) THEN 1 ELSE 0 END) AS open_repairs,
                SUM(CASE WHEN status IN ({sql_values(WORK_DONE_STATUSES)}) THEN 1 ELSE 0 END) AS completed_repairs,
                SUM(CASE WHEN status NOT IN ({sql_values(WORK_DONE_STATUSES)}) AND deadline_date < ? THEN 1 ELSE 0 END) AS overdue_repairs,
                SUM(CASE WHEN payment_status != 'Paid' THEN 1 ELSE 0 END) AS unpaid_jobs,
                COALESCE(SUM(CASE WHEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) > advance_paid THEN (CASE WHEN final_cost > 0 THEN final_cost ELSE estimated_cost END) - advance_paid ELSE 0 END), 0) AS pending_balance,
                COALESCE(SUM(advance_paid), 0) AS collected_total
            FROM motors
            WHERE deleted_at IS NULL
            """,
            (today, today),
        )
        .fetchone()
    )

    if active_filter == "today":
        filters.append("date_added = ?")
        params.append(today)
    elif active_filter == "pending":
        filters.append(f"status NOT IN ({sql_values(WORK_DONE_STATUSES)})")
    elif active_filter == "completed":
        filters.append(f"status IN ({sql_values(WORK_DONE_STATUSES)})")
    elif active_filter == "overdue":
        filters.append(f"status NOT IN ({sql_values(WORK_DONE_STATUSES)}) AND deadline_date < ?")
        params.append(today)
    elif active_filter == "unpaid":
        filters.append("payment_status != 'Paid'")
    else:
        active_filter = "all"

    if period_filter["where"]:
        filters.append(period_filter["where"])
        params.extend(period_filter["params"])

    if search:
        filters.append("(job_number LIKE ? OR customer_name LIKE ? OR phone_number LIKE ? OR motor_type LIKE ? OR CAST(batch_number AS TEXT) LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%", f"{search}%"])

    where_clause = f"WHERE {' AND '.join(filters)}"
    query = f"""
        SELECT * FROM motors
        {where_clause}
        ORDER BY
            CASE WHEN status NOT IN ({sql_values(WORK_DONE_STATUSES)}) AND deadline_date < ? THEN 0 ELSE 1 END,
            deadline_date ASC,
            id DESC
    """
    rows = [dict(row) for row in get_db().execute(query, (*params, today)).fetchall()]
    attach_media_to_motors(rows)
    summary["filtered_count"] = len(rows)
    summary["media_files"] = sum(len(motor.get("media", [])) for motor in rows)
    return render_template(
        "motors.html",
        motors=rows,
        motor_summary=summary,
        period_filter=period_filter,
        active_filter=active_filter,
        search=search,
        today=today,
    )


@app.route("/motors/add", methods=("GET", "POST"))
def add_motor():
    if request.method == "POST":
        data, media_files, errors = collect_motor_form()
        if errors:
            for error in errors:
                flash(error, "error")
            data["media"] = []
            return render_template("motor_form.html", motor=data, mode="add")

        now = datetime.now().isoformat(timespec="seconds")
        db = get_db()
        batch_number = next_batch_number(db)
        cursor = db.execute(
            """
            INSERT INTO motors (
                job_number, batch_number, customer_name, phone_number, motor_type, problem_description,
                image_filename, estimated_cost, final_cost, advance_paid, payment_status,
                status, date_added, deadline_date, deleted_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """,
            (
                next_job_number(db),
                batch_number,
                data["customer_name"],
                data["phone_number"],
                data["motor_type"],
                data["problem_description"],
                None,
                data["estimated_cost"],
                data["final_cost"],
                data["advance_paid"],
                data["payment_status"],
                data["status"],
                date.today().isoformat(),
                data["deadline_date"],
                now,
                now,
            ),
        )
        motor_id = cursor.lastrowid
        save_motor_media_records(db, motor_id, media_files)
        db.execute(
            "UPDATE motors SET image_filename = ? WHERE id = ?",
            (primary_motor_image_filename(db, motor_id), motor_id),
        )
        db.commit()
        flash("Motor entry added successfully.", "success")
        return redirect(url_for("motors"))

    motor = {
        "customer_name": "",
        "phone_number": "",
        "motor_type": "",
        "problem_description": "",
        "estimated_cost": "",
        "final_cost": "",
        "advance_paid": "",
        "payment_status": "Unpaid",
        "status": "Received",
        "deadline_date": "",
        "image_filename": "",
        "media": [],
    }
    return render_template("motor_form.html", motor=motor, mode="add")


@app.route("/motors/<int:motor_id>/edit", methods=("GET", "POST"))
def edit_motor(motor_id):
    existing = dict(get_motor_or_404(motor_id))
    existing["media"] = get_motor_media(motor_id)
    if request.method == "POST":
        data, media_files, errors = collect_motor_form()
        if errors:
            for error in errors:
                flash(error, "error")
            edited_motor = {**existing, **data}
            edited_motor["media"] = get_motor_media(motor_id)
            return render_template("motor_form.html", motor=edited_motor, mode="edit")

        delete_media_ids = []
        for media_id in request.form.getlist("delete_media"):
            try:
                delete_media_ids.append(int(media_id))
            except ValueError:
                continue
        deleted_media = []
        if delete_media_ids:
            placeholders = ", ".join("?" for _ in delete_media_ids)
            deleted_media = [
                dict(row)
                for row in get_db()
                .execute(
                    f"SELECT id, filename FROM motor_media WHERE motor_id = ? AND id IN ({placeholders})",
                    (motor_id, *delete_media_ids),
                )
                .fetchall()
            ]
            get_db().execute(
                f"DELETE FROM motor_media WHERE motor_id = ? AND id IN ({placeholders})",
                (motor_id, *delete_media_ids),
            )

        save_motor_media_records(get_db(), motor_id, media_files)
        primary_image = primary_motor_image_filename(get_db(), motor_id)

        get_db().execute(
            """
            UPDATE motors
            SET customer_name = ?,
                phone_number = ?,
                motor_type = ?,
                problem_description = ?,
                image_filename = ?,
                estimated_cost = ?,
                final_cost = ?,
                advance_paid = ?,
                payment_status = ?,
                status = ?,
                deadline_date = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                data["customer_name"],
                data["phone_number"],
                data["motor_type"],
                data["problem_description"],
                primary_image,
                data["estimated_cost"],
                data["final_cost"],
                data["advance_paid"],
                data["payment_status"],
                data["status"],
                data["deadline_date"],
                datetime.now().isoformat(timespec="seconds"),
                motor_id,
            ),
        )
        get_db().commit()
        for media in deleted_media:
            delete_upload(media["filename"])
        flash("Motor entry updated successfully.", "success")
        return redirect(url_for("motors"))

    return render_template("motor_form.html", motor=existing, mode="edit")


@app.route("/motors/<int:motor_id>/payment", methods=("POST",))
def update_motor_payment(motor_id):
    motor = dict(get_motor_or_404(motor_id))
    requested_status = (request.form.get("payment_status") or "").strip()
    if requested_status not in PAYMENT_STATUSES:
        flash("Choose a valid payment status.", "error")
        return redirect(request.referrer or url_for("motors"))

    amount = repair_amount(motor)
    current_paid = Decimal(str(motor.get("advance_paid") or 0))
    if requested_status == "Paid":
        paid_amount = float(amount)
    elif requested_status == "Unpaid":
        paid_amount = 0
    else:
        if amount <= 0 or current_paid <= 0 or current_paid >= Decimal(str(amount)):
            flash("Set a valid advance paid amount in Edit before marking payment partial.", "error")
            return redirect(request.referrer or url_for("motors"))
        paid_amount = float(current_paid)
    get_db().execute(
        """
        UPDATE motors
        SET advance_paid = ?,
            payment_status = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (paid_amount, requested_status, datetime.now().isoformat(timespec="seconds"), motor_id),
    )
    get_db().commit()
    flash(f"{motor['job_number']} marked {requested_status.lower()}.", "success")
    return redirect(request.referrer or url_for("motors"))


@app.route("/motors/<int:motor_id>/status", methods=("POST",))
def update_motor_status(motor_id):
    motor = dict(get_motor_or_404(motor_id))
    requested_status = (request.form.get("status") or "").strip()
    if requested_status not in REPAIR_STATUSES:
        flash("Choose a valid repair status.", "error")
        return redirect(request.referrer or url_for("motors"))

    if requested_status == motor["status"]:
        flash(f"{motor['job_number']} is already {requested_status.lower()}.", "success")
        return redirect(request.referrer or url_for("motors"))

    get_db().execute(
        """
        UPDATE motors
        SET status = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (requested_status, datetime.now().isoformat(timespec="seconds"), motor_id),
    )
    get_db().commit()
    flash(f"{motor['job_number']} moved to {requested_status.lower()}.", "success")
    return redirect(request.referrer or url_for("motors"))


@app.route("/motors/<int:motor_id>/receipt")
def receipt(motor_id):
    motor = get_motor_or_404(motor_id)
    return render_template("receipt.html", motor=motor, settings=get_shop_settings(), today=date.today().isoformat())


@app.route("/motors/<int:motor_id>/delete", methods=("POST",))
def delete_motor(motor_id):
    motor = get_motor_or_404(motor_id)
    settings = get_shop_settings()
    delete_pin = (request.form.get("delete_pin") or "").strip()
    if not hmac.compare_digest(delete_pin, settings["admin_pin"]):
        flash("Admin PIN is required to delete a motor entry.", "error")
        return redirect(url_for("motors"))

    media_files = get_motor_media(motor_id)
    get_db().execute("DELETE FROM motor_media WHERE motor_id = ?", (motor_id,))
    get_db().execute("DELETE FROM motors WHERE id = ?", (motor_id,))
    get_db().commit()
    delete_upload(motor["image_filename"])
    for media in media_files:
        if media["filename"] != motor["image_filename"]:
            delete_upload(media["filename"])
    flash("Motor entry deleted.", "success")
    return redirect(url_for("motors"))


def save_invoice_items(db, invoice_id, items):
    db.execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
    for item in items:
        db.execute(
            """
            INSERT INTO invoice_items (invoice_id, description, quantity, rate, amount, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                invoice_id,
                item["description"],
                item["quantity"],
                item["rate"],
                item["amount"],
                item["sort_order"],
            ),
        )


@app.route("/invoices")
def invoices():
    search = (request.args.get("q") or "").strip()
    filters = []
    params = []
    if search:
        filters.append("(i.invoice_number LIKE ? OR i.bill_to LIKE ? OR i.po_number LIKE ? OR m.job_number LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%"])
    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    rows = get_db().execute(
        f"""
        SELECT i.*, m.job_number AS motor_job_number
        FROM invoices i
        LEFT JOIN motors m ON m.id = i.motor_id
        {where_clause}
        ORDER BY i.invoice_date DESC, i.id DESC
        """,
        params,
    ).fetchall()
    stats = get_db().execute(
        """
        SELECT
            COUNT(*) AS total_invoices,
            COALESCE(SUM(total), 0) AS invoice_total,
            COALESCE(SUM(amount_paid), 0) AS paid_total,
            COALESCE(SUM(balance_due), 0) AS balance_total
        FROM invoices
        """
    ).fetchone()
    motors_for_import = get_db().execute(
        """
        SELECT id, job_number, customer_name, motor_type
        FROM motors
        WHERE deleted_at IS NULL
        ORDER BY id DESC
        LIMIT 80
        """
    ).fetchall()
    return render_template("invoices.html", invoices=rows, stats=stats, search=search, motors_for_import=motors_for_import)


@app.route("/invoices/new", methods=("GET", "POST"))
def new_invoice():
    db = get_db()
    motor = None
    motor_id = (request.args.get("motor_id") or request.form.get("motor_id") or "").strip()
    if motor_id:
        if not motor_id.isdigit():
            abort(404)
        motor = get_motor_or_404(int(motor_id))

    if request.method == "POST":
        data, items, errors = collect_invoice_form()
        if errors:
            for error in errors:
                flash(error, "error")
            return render_template("invoice_form.html", invoice=data, items=items, mode="add", settings=get_shop_settings())

        now = datetime.now().isoformat(timespec="seconds")
        cursor = db.execute(
            """
            INSERT INTO invoices (
                invoice_number, motor_id, from_details, bill_to, ship_to, invoice_date,
                payment_terms, due_date, po_number, notes, terms, tax_rate,
                discount_amount, shipping_amount, amount_paid, subtotal, tax_amount,
                total, balance_due, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["invoice_number"],
                data["motor_id"],
                data["from_details"],
                data["bill_to"],
                data["ship_to"],
                data["invoice_date"],
                data["payment_terms"],
                data["due_date"],
                data["po_number"],
                data["notes"],
                data["terms"],
                data["tax_rate"],
                data["discount_amount"],
                data["shipping_amount"],
                data["amount_paid"],
                data["subtotal"],
                data["tax_amount"],
                data["total"],
                data["balance_due"],
                now,
                now,
            ),
        )
        save_invoice_items(db, cursor.lastrowid, items)
        db.commit()
        flash("Invoice created successfully.", "success")
        return redirect(url_for("view_invoice", invoice_id=cursor.lastrowid))

    invoice, items = invoice_from_motor_defaults(motor)
    return render_template("invoice_form.html", invoice=invoice, items=items, mode="add", settings=get_shop_settings())


@app.route("/invoices/<int:invoice_id>/edit", methods=("GET", "POST"))
def edit_invoice(invoice_id):
    db = get_db()
    existing = dict(get_invoice_or_404(invoice_id))
    if request.method == "POST":
        data, items, errors = collect_invoice_form(existing)
        if errors:
            for error in errors:
                flash(error, "error")
            edited_invoice = {**existing, **data}
            return render_template("invoice_form.html", invoice=edited_invoice, items=items, mode="edit", settings=get_shop_settings())

        db.execute(
            """
            UPDATE invoices
            SET invoice_number = ?,
                motor_id = ?,
                from_details = ?,
                bill_to = ?,
                ship_to = ?,
                invoice_date = ?,
                payment_terms = ?,
                due_date = ?,
                po_number = ?,
                notes = ?,
                terms = ?,
                tax_rate = ?,
                discount_amount = ?,
                shipping_amount = ?,
                amount_paid = ?,
                subtotal = ?,
                tax_amount = ?,
                total = ?,
                balance_due = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                data["invoice_number"],
                data["motor_id"],
                data["from_details"],
                data["bill_to"],
                data["ship_to"],
                data["invoice_date"],
                data["payment_terms"],
                data["due_date"],
                data["po_number"],
                data["notes"],
                data["terms"],
                data["tax_rate"],
                data["discount_amount"],
                data["shipping_amount"],
                data["amount_paid"],
                data["subtotal"],
                data["tax_amount"],
                data["total"],
                data["balance_due"],
                datetime.now().isoformat(timespec="seconds"),
                invoice_id,
            ),
        )
        save_invoice_items(db, invoice_id, items)
        db.commit()
        flash("Invoice updated successfully.", "success")
        return redirect(url_for("view_invoice", invoice_id=invoice_id))

    return render_template("invoice_form.html", invoice=existing, items=get_invoice_items(invoice_id), mode="edit", settings=get_shop_settings())


@app.route("/invoices/<int:invoice_id>")
def view_invoice(invoice_id):
    invoice = get_invoice_or_404(invoice_id)
    return render_template("invoice_view.html", invoice=invoice, items=get_invoice_items(invoice_id), settings=get_shop_settings())


@app.route("/invoices/<int:invoice_id>/delete", methods=("POST",))
def delete_invoice(invoice_id):
    invoice = get_invoice_or_404(invoice_id)
    settings = get_shop_settings()
    delete_pin = (request.form.get("delete_pin") or "").strip()
    if not hmac.compare_digest(delete_pin, settings["admin_pin"]):
        flash("Admin PIN is required to delete an invoice.", "error")
        return redirect(url_for("invoices"))
    get_db().execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
    get_db().execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
    get_db().commit()
    flash(f"Invoice {invoice['invoice_number']} deleted.", "success")
    return redirect(url_for("invoices"))


@app.route("/customers")
def customers():
    today = date.today().isoformat()
    search = (request.args.get("q") or "").strip()
    selected_phone = (request.args.get("phone") or "").strip()
    status_filter = (request.args.get("status") or "all").strip()
    payment_filter = (request.args.get("payment") or "all").strip()
    filters = ["m.deleted_at IS NULL"]
    params = []
    if search:
        filters.append("(m.customer_name LIKE ? OR m.phone_number LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])

    match_filters = ["m2.deleted_at IS NULL", "m2.phone_number = m.phone_number"]
    match_params = []
    if status_filter == "open":
        match_filters.append(f"m2.status NOT IN ({sql_values(WORK_DONE_STATUSES)})")
    elif status_filter == "done":
        match_filters.append(f"m2.status IN ({sql_values(WORK_DONE_STATUSES)})")
    elif status_filter == "overdue":
        match_filters.append(f"m2.status NOT IN ({sql_values(WORK_DONE_STATUSES)}) AND m2.deadline_date < ?")
        match_params.append(today)
    elif status_filter in REPAIR_STATUSES:
        match_filters.append("m2.status = ?")
        match_params.append(status_filter)
    else:
        status_filter = "all"

    if payment_filter == "pending":
        match_filters.append(
            "(m2.payment_status != 'Paid' OR (CASE WHEN m2.final_cost > 0 THEN m2.final_cost ELSE m2.estimated_cost END) > m2.advance_paid)"
        )
    elif payment_filter in PAYMENT_STATUSES:
        match_filters.append("m2.payment_status = ?")
        match_params.append(payment_filter)
    elif payment_filter == "unpaid":
        payment_filter = "pending"
        match_filters.append(
            "(m2.payment_status != 'Paid' OR (CASE WHEN m2.final_cost > 0 THEN m2.final_cost ELSE m2.estimated_cost END) > m2.advance_paid)"
        )
    else:
        payment_filter = "all"

    if status_filter != "all" or payment_filter != "all":
        filters.append(f"EXISTS (SELECT 1 FROM motors m2 WHERE {' AND '.join(match_filters)})")
        params.extend(match_params)

    where_clause = f"WHERE {' AND '.join(filters)}"

    customer_rows = [
        dict(row)
        for row in get_db()
        .execute(
        f"""
        SELECT
            m.phone_number,
            MAX(m.customer_name) AS customer_name,
            COUNT(*) AS total_jobs,
            SUM(CASE WHEN m.status NOT IN ({sql_values(WORK_DONE_STATUSES)}) THEN 1 ELSE 0 END) AS open_jobs,
            SUM(CASE WHEN m.status IN ({sql_values(WORK_DONE_STATUSES)}) THEN 1 ELSE 0 END) AS completed_jobs,
            SUM(CASE WHEN m.status NOT IN ({sql_values(WORK_DONE_STATUSES)}) AND m.deadline_date < ? THEN 1 ELSE 0 END) AS overdue_jobs,
            SUM(CASE WHEN m.payment_status = 'Paid' THEN 1 ELSE 0 END) AS paid_jobs,
            SUM(CASE WHEN m.payment_status = 'Partial' THEN 1 ELSE 0 END) AS partial_jobs,
            SUM(CASE WHEN m.payment_status = 'Unpaid' THEN 1 ELSE 0 END) AS unpaid_jobs,
            MAX(m.date_added) AS last_repair_date,
            COALESCE(SUM(CASE WHEN m.final_cost > 0 THEN m.final_cost ELSE m.estimated_cost END), 0) AS total_value,
            COALESCE(SUM(m.advance_paid), 0) AS total_paid,
            COALESCE(SUM(CASE WHEN (CASE WHEN m.final_cost > 0 THEN m.final_cost ELSE m.estimated_cost END) > m.advance_paid THEN (CASE WHEN m.final_cost > 0 THEN m.final_cost ELSE m.estimated_cost END) - m.advance_paid ELSE 0 END), 0) AS balance_due
        FROM motors m
        {where_clause}
        GROUP BY m.phone_number
        ORDER BY last_repair_date DESC, customer_name ASC
        """,
        (today, *params),
        )
        .fetchall()
    ]
    customer_summary = {
        "total_customers": len(customer_rows),
        "total_jobs": sum(int(row["total_jobs"] or 0) for row in customer_rows),
        "total_value": sum(float(row["total_value"] or 0) for row in customer_rows),
        "total_paid": sum(float(row["total_paid"] or 0) for row in customer_rows),
        "balance_due": sum(float(row["balance_due"] or 0) for row in customer_rows),
    }
    selected_customer = next((row for row in customer_rows if row["phone_number"] == selected_phone), None)

    return render_template(
        "customers.html",
        customers=customer_rows,
        customer_summary=customer_summary,
        selected_customer=selected_customer,
        search=search,
        selected_phone=selected_phone,
        status_filter=status_filter,
        payment_filter=payment_filter,
        result_count=len(customer_rows),
    )


@app.route("/workers")
def workers():
    context = build_worker_month_context(request.args.get("month"))
    return render_template("workers.html", **context)


@app.route("/workers/add", methods=("POST",))
def add_worker():
    errors = []
    name = clean_text(request.form.get("name"), "Worker name", errors)
    phone_number = validate_optional_phone(request.form.get("phone_number"), "Worker phone", errors)
    role = clean_text(request.form.get("role"), "Worker role", errors, max_length=120, required=False)
    attendance_month = (request.form.get("attendance_month") or date.today().strftime("%Y-%m")).strip()
    try:
        month_anchor = datetime.strptime(attendance_month, "%Y-%m").date()
    except ValueError:
        month_anchor = date.today().replace(day=1)
    month_days = calendar.monthrange(month_anchor.year, month_anchor.month)[1]
    monthly_salary_value = (request.form.get("monthly_salary") or "").strip()
    if monthly_salary_value:
        monthly_salary = parse_money(monthly_salary_value, "Monthly salary", errors, required=True)
    else:
        legacy_daily_salary = parse_money(request.form.get("daily_salary"), "Daily salary", errors, required=True)
        monthly_salary = legacy_daily_salary * month_days
    daily_salary = monthly_salary / month_days if month_days else 0

    if errors:
        for error in errors:
            flash(error, "error")
        return report_redirect()

    now = datetime.now().isoformat(timespec="seconds")
    get_db().execute(
        """
        INSERT INTO workers (name, phone_number, role, monthly_salary, daily_salary, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (name, phone_number, role, monthly_salary, daily_salary, now, now),
    )
    get_db().commit()
    flash("Worker added successfully.", "success")
    return report_redirect()


@app.route("/workers/<int:worker_id>/attendance", methods=("POST",))
def mark_worker_attendance(worker_id):
    worker = get_db().execute("SELECT * FROM workers WHERE id = ?", (worker_id,)).fetchone()
    if worker is None:
        abort(404)

    errors = []
    work_date = (request.form.get("work_date") or date.today().isoformat()).strip()
    status = (request.form.get("status") or "").strip()
    note = clean_text(request.form.get("note"), "Attendance note", errors, max_length=255, required=False)

    try:
        datetime.strptime(work_date, "%Y-%m-%d")
    except ValueError:
        errors.append("Attendance date must be valid.")
    if status in ("", "Unmarked"):
        status = "Unmarked"
    elif status not in ATTENDANCE_STATUSES:
        errors.append("Attendance status must be Present, Leave, or Absent.")

    if errors:
        for error in errors:
            flash(error, "error")
        return report_redirect()

    if status == "Unmarked":
        get_db().execute(
            "DELETE FROM worker_attendance WHERE worker_id = ? AND work_date = ?",
            (worker_id, work_date),
        )
    else:
        now = datetime.now().isoformat(timespec="seconds")
        get_db().execute(
            """
            INSERT INTO worker_attendance (worker_id, work_date, status, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(worker_id, work_date)
            DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at
            """,
            (worker_id, work_date, status, note, now, now),
        )
    get_db().commit()
    flash(f"{worker['name']} marked {status} for {display_date(work_date)}.", "success")
    return report_redirect()


@app.route("/workers/<int:worker_id>/salary-payment", methods=("POST",))
def add_worker_salary_payment(worker_id):
    worker = get_db().execute("SELECT * FROM workers WHERE id = ?", (worker_id,)).fetchone()
    if worker is None:
        abort(404)

    errors = []
    attendance_month = (request.form.get("attendance_month") or date.today().strftime("%Y-%m")).strip()
    payment_date = parse_optional_date(request.form.get("payment_date"), "Payment date", errors)
    if not payment_date:
        errors.append("Payment date is required.")
    amount = parse_money(request.form.get("amount"), "Payment amount", errors, required=True)
    if amount <= 0:
        errors.append("Payment amount must be greater than zero.")
    payment_type = (request.form.get("payment_type") or "Paid").strip()
    if payment_type not in {"Paid", "Advance"}:
        errors.append("Choose a valid worker payment type.")
    note = clean_text(request.form.get("note"), "Payment note", errors, max_length=255, required=False)

    if errors:
        for error in errors:
            flash(error, "error")
        return redirect(url_for("workers", month=attendance_month, _anchor=f"attendance-worker-{worker_id}"))

    now = datetime.now().isoformat(timespec="seconds")
    get_db().execute(
        """
        INSERT INTO worker_salary_payments (worker_id, payment_date, amount, payment_type, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (worker_id, payment_date, amount, payment_type, note, now, now),
    )
    get_db().commit()
    flash(f"{payment_type} saved for {worker['name']}.", "success")
    return redirect(url_for("workers", month=attendance_month, _anchor=f"attendance-worker-{worker_id}"))


@app.route("/workers/<int:worker_id>/toggle", methods=("POST",))
def toggle_worker(worker_id):
    worker = get_db().execute("SELECT * FROM workers WHERE id = ?", (worker_id,)).fetchone()
    if worker is None:
        abort(404)
    new_active = 0 if worker["active"] else 1
    get_db().execute(
        "UPDATE workers SET active = ?, updated_at = ? WHERE id = ?",
        (new_active, datetime.now().isoformat(timespec="seconds"), worker_id),
    )
    get_db().commit()
    flash(f"{worker['name']} is now {'active' if new_active else 'inactive'}.", "success")
    return report_redirect()


@app.route("/settings", methods=("GET", "POST"))
def settings():
    settings_row = dict(get_shop_settings())
    if request.method == "POST":
        errors = []
        data = {
            "shop_name": clean_text(request.form.get("shop_name"), "Shop name", errors),
            "owner_name": clean_text(request.form.get("owner_name"), "Owner name", errors, required=False),
            "phone_number": validate_optional_phone(request.form.get("phone_number"), "Shop phone", errors),
            "address": clean_text(request.form.get("address"), "Address", errors, max_length=800, required=False),
            "receipt_note": clean_text(request.form.get("receipt_note"), "Receipt note", errors, max_length=500, required=False),
        }

        cropped_logo_data = (request.form.get("cropped_logo") or "").strip()
        logo = None if cropped_logo_data else validate_upload(request.files.get("logo"), errors)
        if errors:
            for error in errors:
                flash(error, "error")
            return render_template("settings.html", settings={**settings_row, **data}, license=get_license_status())

        old_logo = settings_row.get("logo_filename")
        new_logo = old_logo
        if cropped_logo_data:
            new_logo = save_logo_data_url(cropped_logo_data, errors)
        elif logo:
            new_logo = save_upload(logo)

        if errors:
            for error in errors:
                flash(error, "error")
            if new_logo and new_logo != old_logo:
                delete_upload(new_logo)
            return render_template("settings.html", settings={**settings_row, **data}, license=get_license_status())

        get_db().execute(
            """
            UPDATE shop_settings
            SET shop_name = ?, owner_name = ?, phone_number = ?, address = ?,
                logo_filename = ?, receipt_note = ?, updated_at = ?
            WHERE id = 1
            """,
            (
                data["shop_name"],
                data["owner_name"],
                data["phone_number"],
                data["address"],
                new_logo,
                data["receipt_note"],
                datetime.now().isoformat(timespec="seconds"),
            ),
        )
        get_db().commit()
        if logo and old_logo and old_logo != new_logo:
            delete_upload(old_logo)
        flash("Shop settings saved.", "success")
        return redirect(url_for("settings"))

    return render_template("settings.html", settings=settings_row, license=get_license_status())


@app.route("/settings/reset-pin", methods=("POST",))
def reset_admin_pin():
    settings_row = dict(get_shop_settings())
    errors = []
    stored_pin = (settings_row.get("admin_pin") or "").strip()
    current_pin = (request.form.get("current_pin") or "").strip()
    new_pin = (request.form.get("new_pin") or "").strip()
    confirm_pin = (request.form.get("confirm_pin") or "").strip()

    if stored_pin and not hmac.compare_digest(current_pin, stored_pin):
        errors.append("Current admin PIN is incorrect.")

    if not re.fullmatch(r"\d{4,12}", new_pin):
        errors.append("New admin PIN must be 4 to 12 digits.")
    if new_pin != confirm_pin:
        errors.append("PIN confirmation does not match.")

    if errors:
        for error in errors:
            flash(error, "error")
        return redirect(url_for("settings"))

    get_db().execute(
        "UPDATE shop_settings SET admin_pin = ?, updated_at = ? WHERE id = 1",
        (new_pin, datetime.now().isoformat(timespec="seconds")),
    )
    get_db().commit()
    flash("Admin PIN reset successfully.", "success")
    return redirect(url_for("settings"))


def backup_upload_filenames(db):
    filenames = set()
    for row in db.execute("SELECT image_filename FROM motors WHERE image_filename IS NOT NULL AND image_filename != ''").fetchall():
        filenames.add(row["image_filename"])
    for row in db.execute("SELECT filename FROM motor_media").fetchall():
        filenames.add(row["filename"])
    for row in db.execute("SELECT logo_filename FROM shop_settings WHERE logo_filename IS NOT NULL AND logo_filename != ''").fetchall():
        filenames.add(row["logo_filename"])
    return filenames


def pc_uuid(prefix, value):
    return f"pc-{prefix}-{value}"


def build_backup_data_json(db):
    motors = [dict(row) for row in db.execute("SELECT * FROM motors WHERE deleted_at IS NULL ORDER BY id ASC").fetchall()]
    workers = [dict(row) for row in db.execute("SELECT * FROM workers ORDER BY id ASC").fetchall()]
    customer_map = {}
    backup_motors = []
    backup_media = []
    backup_workers = []
    backup_attendance = []
    backup_salary_payments = []
    now = datetime.now().isoformat(timespec="seconds")

    for motor in motors:
        customer_uuid = pc_uuid("customer", phone_digits(motor.get("phone_number")) or motor["phone_number"] or motor["id"])
        customer = customer_map.setdefault(
            customer_uuid,
            {
                "uuid": customer_uuid,
                "name": motor["customer_name"],
                "phone_number": motor["phone_number"],
                "motor_count": 0,
                "balance_due": 0,
                "last_activity": motor["date_added"],
                "device_id": "pc",
                "created_at": motor["created_at"],
                "updated_at": motor["updated_at"],
            },
        )
        customer["motor_count"] += 1
        customer["balance_due"] += float(balance_amount(motor))
        if motor["date_added"] > customer["last_activity"]:
            customer["last_activity"] = motor["date_added"]

        motor_uuid = motor.get("phone_uuid") or pc_uuid("motor", motor["id"])
        backup_motors.append(
            {
                "uuid": motor_uuid,
                "job_number": motor["job_number"],
                "batch_number": motor.get("batch_number"),
                "customer_uuid": customer_uuid,
                "customer_name": motor["customer_name"],
                "phone_number": motor["phone_number"],
                "motor_type": motor["motor_type"],
                "problem_description": motor["problem_description"],
                "estimated_cost": motor["estimated_cost"],
                "final_cost": motor["final_cost"],
                "advance_paid": motor["advance_paid"],
                "payment_status": motor["payment_status"],
                "status": motor["status"],
                "date_added": motor["date_added"],
                "deadline_date": motor["deadline_date"],
                "device_id": motor.get("source_device_id") or "pc",
                "created_at": motor["created_at"],
                "updated_at": motor["updated_at"],
            }
        )

        media_rows = [dict(row) for row in db.execute("SELECT * FROM motor_media WHERE motor_id = ? ORDER BY sort_order, id", (motor["id"],)).fetchall()]
        for media in media_rows:
            backup_media.append(
                {
                    "uuid": media.get("phone_uuid") or pc_uuid("media", media["id"]),
                    "motor_uuid": motor_uuid,
                    "uri": f"uploads/motors/{media['filename']}",
                    "filename": media["filename"],
                    "media_type": media["media_type"],
                    "checksum": "",
                    "sort_order": media["sort_order"],
                    "device_id": "pc",
                    "created_at": media["created_at"],
                    "updated_at": media["created_at"],
                }
            )

    worker_uuid_by_id = {}
    for worker in workers:
        worker_uuid = worker.get("phone_uuid") or pc_uuid("worker", worker["id"])
        worker_uuid_by_id[worker["id"]] = worker_uuid
        backup_workers.append(
            {
                "uuid": worker_uuid,
                "name": worker["name"],
                "phone_number": worker["phone_number"],
                "role": worker["role"],
                "monthly_salary": worker["monthly_salary"],
                "active": worker["active"],
                "device_id": worker.get("source_device_id") or "pc",
                "created_at": worker["created_at"],
                "updated_at": worker["updated_at"],
            }
        )

    if table_exists(db, "worker_attendance"):
        for row in db.execute("SELECT * FROM worker_attendance ORDER BY id ASC").fetchall():
            row = dict(row)
            worker_uuid = worker_uuid_by_id.get(row["worker_id"])
            if not worker_uuid:
                continue
            backup_attendance.append(
                {
                    "uuid": row.get("phone_uuid") or pc_uuid("attendance", row["id"]),
                    "worker_uuid": worker_uuid,
                    "work_date": row["work_date"],
                    "status": row["status"],
                    "note": row["note"] or "",
                    "device_id": "pc",
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            )

    if table_exists(db, "worker_salary_payments"):
        for row in db.execute("SELECT * FROM worker_salary_payments ORDER BY id ASC").fetchall():
            row = dict(row)
            worker_uuid = worker_uuid_by_id.get(row["worker_id"])
            if not worker_uuid:
                continue
            backup_salary_payments.append(
                {
                    "uuid": row.get("phone_uuid") or pc_uuid("salary-payment", row["id"]),
                    "worker_uuid": worker_uuid,
                    "payment_date": row["payment_date"],
                    "amount": row["amount"],
                    "payment_type": row.get("payment_type") or "Paid",
                    "note": row["note"] or "",
                    "device_id": "pc",
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            )

    settings_row = dict(db.execute("SELECT * FROM shop_settings WHERE id = 1").fetchone())
    app_meta = [
        {"key": "shop_name", "value": settings_row.get("shop_name") or "Motor Repair Manager", "updated_at": settings_row.get("updated_at") or now},
    ]
    if settings_row.get("logo_filename"):
        app_meta.append({"key": "shop_logo_uri", "value": f"uploads/shop/{settings_row['logo_filename']}", "updated_at": settings_row.get("updated_at") or now})

    return {
        "customers": list(customer_map.values()),
        "motors": backup_motors,
        "motorMedia": backup_media,
        "workers": backup_workers,
        "workerAttendance": backup_attendance,
        "workerSalaryPayments": backup_salary_payments,
        "appMeta": app_meta,
    }


def apply_backup_date_range(temp_db, start_date="", end_date=""):
    start_date = (start_date or "").strip()
    end_date = (end_date or "").strip()
    temp_db.execute("DELETE FROM app_meta WHERE key LIKE 'license_%'")
    if not start_date and not end_date:
        return {"start_date": "", "end_date": "", "filtered": False}

    today_value = date.today().isoformat()
    try:
        parsed_start = datetime.strptime(start_date or end_date or today_value, "%Y-%m-%d").date()
    except ValueError:
        parsed_start = date.today()
    try:
        parsed_end = datetime.strptime(end_date or start_date or today_value, "%Y-%m-%d").date()
    except ValueError:
        parsed_end = parsed_start
    if parsed_end < parsed_start:
        parsed_end = parsed_start

    start_value = parsed_start.isoformat()
    end_value = parsed_end.isoformat()
    temp_db.execute("DELETE FROM motors WHERE date_added NOT BETWEEN ? AND ?", (start_value, end_value))
    temp_db.execute("DELETE FROM motor_media WHERE motor_id NOT IN (SELECT id FROM motors)")
    if table_exists(temp_db, "invoices"):
        temp_db.execute(
            """
            DELETE FROM invoices
            WHERE (motor_id IS NOT NULL AND motor_id NOT IN (SELECT id FROM motors))
                OR invoice_date NOT BETWEEN ? AND ?
            """,
            (start_value, end_value),
        )
    if table_exists(temp_db, "invoice_items"):
        temp_db.execute("DELETE FROM invoice_items WHERE invoice_id NOT IN (SELECT id FROM invoices)")
    if table_exists(temp_db, "worker_attendance"):
        temp_db.execute("DELETE FROM worker_attendance WHERE work_date NOT BETWEEN ? AND ?", (start_value, end_value))
    if table_exists(temp_db, "worker_salary_payments"):
        temp_db.execute("DELETE FROM worker_salary_payments WHERE payment_date NOT BETWEEN ? AND ?", (start_value, end_value))
    return {"start_date": start_value, "end_date": end_value, "filtered": True}


def create_backup_archive(start_date="", end_date=""):
    BACKUP_FOLDER.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    backup_path = BACKUP_FOLDER / f"motor-repair-backup-{timestamp}.zip"
    temp_db = BACKUP_FOLDER / f"database-{timestamp}.db"
    source = None
    destination = None
    try:
        source = sqlite3.connect(DATABASE)
        destination = sqlite3.connect(temp_db)
        source.backup(destination)
        destination.close()
        source.close()
        destination = None
        source = None
        filtered_db = sqlite3.connect(temp_db)
        try:
            filtered_db.row_factory = sqlite3.Row
            range_meta = apply_backup_date_range(filtered_db, start_date, end_date)
            upload_filenames = backup_upload_filenames(filtered_db)
            backup_data = build_backup_data_json(filtered_db)
            settings_row = dict(filtered_db.execute("SELECT * FROM shop_settings WHERE id = 1").fetchone())
            logo_filename = settings_row.get("logo_filename")
            filtered_db.commit()
        finally:
            filtered_db.close()
        with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(temp_db, "database.db")
            manifest = {
                "app": "Motor Repair Manager PC",
                "backupType": "pc_export",
                "appId": APP_ID,
                "platform": LICENSE_PLATFORM,
                "createdAt": datetime.now().isoformat(timespec="seconds"),
                "dateRange": range_meta,
                "licenseIncluded": False,
                "counts": {
                    "motors": len(backup_data["motors"]),
                    "customers": len(backup_data["customers"]),
                    "workers": len(backup_data["workers"]),
                    "attendance": len(backup_data["workerAttendance"]),
                    "salaryPayments": len(backup_data["workerSalaryPayments"]),
                    "media": len(backup_data["motorMedia"]),
                },
            }
            archive.writestr("backup_manifest.json", json.dumps(manifest, indent=2))
            archive.writestr("backup_data.json", json.dumps(backup_data, indent=2))
            archive.writestr("metadata.txt", f"Created: {manifest['createdAt']}\nLicense included: no\n")
            if UPLOAD_FOLDER.exists():
                for filename in upload_filenames:
                    upload = UPLOAD_FOLDER / filename
                    if upload.exists() and upload.is_file():
                        archive.write(upload, f"uploads/{upload.relative_to(UPLOAD_FOLDER).as_posix()}")
                        archive.write(upload, f"uploads/motors/{upload.name}")
                if logo_filename:
                    logo_file = UPLOAD_FOLDER / logo_filename
                    if logo_file.exists() and logo_file.is_file():
                        archive.write(logo_file, f"uploads/shop/{logo_file.name}")
    finally:
        if destination is not None:
            destination.close()
        if source is not None:
            source.close()
        if temp_db.exists():
            for attempt in range(5):
                try:
                    temp_db.unlink()
                    break
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.15)
    return backup_path


@app.route("/backup")
def backup():
    backups = sorted(BACKUP_FOLDER.glob("motor-repair-backup-*.zip"), reverse=True)
    return render_template("backup.html", backups=backups[:10])


@app.route("/backup/download", methods=("POST",))
def download_backup():
    errors = []
    start_date = parse_optional_date(request.form.get("start_date"), "Start date", errors)
    end_date = parse_optional_date(request.form.get("end_date"), "End date", errors)
    if start_date and end_date and end_date < start_date:
        errors.append("End date cannot be before start date.")
    if errors:
        for error in errors:
            flash(error, "error")
        return redirect(url_for("backup"))
    backup_path = create_backup_archive(start_date, end_date)
    return send_file(backup_path, as_attachment=True, download_name=backup_path.name)


def validate_zip_members(zip_file):
    for member in zip_file.namelist():
        member_path = Path(member)
        if member_path.is_absolute() or ".." in member_path.parts:
            return False
    names = set(zip_file.namelist())
    has_pc_database = "database.db" in names
    has_json_backup = "backup_manifest.json" in names and "backup_data.json" in names
    return has_pc_database or has_json_backup


def clear_uploads_folder():
    UPLOAD_FOLDER.mkdir(exist_ok=True)
    uploads_root = UPLOAD_FOLDER.resolve()
    for item in UPLOAD_FOLDER.iterdir():
        resolved = item.resolve()
        if resolved == uploads_root or uploads_root not in resolved.parents:
            continue
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()
    (UPLOAD_FOLDER / ".gitkeep").write_text("\n", encoding="utf-8")


def table_exists(db, table_name):
    return db.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone() is not None


def unique_job_number(db, preferred):
    base = (preferred or "").strip() or next_job_number(db)
    candidate = base
    suffix = 2
    while db.execute("SELECT 1 FROM motors WHERE job_number = ?", (candidate,)).fetchone():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def unique_upload_filename(filename):
    safe_name = secure_filename(filename or "") or f"{uuid.uuid4().hex}.bin"
    candidate = safe_name
    stem = Path(safe_name).stem
    suffix = Path(safe_name).suffix
    counter = 2
    while (UPLOAD_FOLDER / candidate).exists():
        candidate = f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def find_phone_upload(temp_path, filename):
    if not filename:
        return None
    uploads_root = temp_path / "uploads"
    candidates = [
        uploads_root / "motors" / filename,
        uploads_root / filename,
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    matches = list(uploads_root.rglob(filename)) if uploads_root.exists() else []
    return matches[0] if matches else None


def backup_stats_total(stats):
    return sum(int(value or 0) for value in stats.values())


def import_phone_backup_json(temp_path, manifest, data):
    source_device_id = (manifest or {}).get("deviceId", "") or (manifest or {}).get("device_id", "") or "phone"
    stats = {
        "customers": 0,
        "motors": 0,
        "media": 0,
        "workers": 0,
        "attendance": 0,
        "salary_payments": 0,
    }
    db = get_db()
    ensure_phone_import_tables(db)
    motor_id_by_uuid = {}
    worker_id_by_uuid = {}

    for row in data.get("appMeta", []) or []:
        key = str(row.get("key") or "")
        value = str(row.get("value") or "")
        if key == "shop_name" and value:
            db.execute(
                "UPDATE shop_settings SET shop_name = ?, updated_at = ? WHERE id = 1",
                (value, datetime.now().isoformat(timespec="seconds")),
            )
        elif key == "shop_logo_uri" and value:
            logo_source = find_phone_upload(temp_path, Path(value).name)
            if logo_source:
                filename = unique_upload_filename(Path(value).name)
                shutil.copy2(logo_source, UPLOAD_FOLDER / filename)
                db.execute(
                    "UPDATE shop_settings SET logo_filename = ?, updated_at = ? WHERE id = 1",
                    (filename, datetime.now().isoformat(timespec="seconds")),
                )

    for row in data.get("customers", []) or []:
        uuid_value = str(row.get("uuid") or "")
        if not uuid_value:
            continue
        now = str(row.get("updated_at") or datetime.now().isoformat(timespec="seconds"))
        db.execute(
            """
            INSERT INTO phone_customers (
                phone_uuid, name, phone_number, motor_count, balance_due,
                last_activity, source_device_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(phone_uuid) DO UPDATE SET
                name = excluded.name,
                phone_number = excluded.phone_number,
                motor_count = excluded.motor_count,
                balance_due = excluded.balance_due,
                last_activity = excluded.last_activity,
                source_device_id = excluded.source_device_id,
                updated_at = excluded.updated_at
            """,
            (
                uuid_value,
                str(row.get("name") or ""),
                str(row.get("phone_number") or ""),
                int(row.get("motor_count") or 0),
                float(row.get("balance_due") or 0),
                str(row.get("last_activity") or date.today().isoformat()),
                source_device_id,
                str(row.get("created_at") or now),
                now,
            ),
        )
        stats["customers"] += 1

    for row in data.get("motors", []) or []:
        uuid_value = str(row.get("uuid") or "")
        if not uuid_value:
            continue
        status = str(row.get("status") or "Received")
        if status not in REPAIR_STATUSES:
            status = map_old_status(status)
        payment_status = str(row.get("payment_status") or "Unpaid")
        if payment_status not in PAYMENT_STATUSES:
            payment_status = calculate_payment_status(row.get("estimated_cost"), row.get("final_cost"), row.get("advance_paid"))
        now = str(row.get("updated_at") or datetime.now().isoformat(timespec="seconds"))
        existing = db.execute("SELECT id FROM motors WHERE phone_uuid = ?", (uuid_value,)).fetchone()
        if existing:
            motor_id = existing["id"]
            db.execute(
                """
                UPDATE motors
                SET customer_name = ?, phone_number = ?, motor_type = ?, problem_description = ?,
                    estimated_cost = ?, final_cost = ?, advance_paid = ?, payment_status = ?,
                    status = ?, date_added = ?, deadline_date = ?, source_device_id = ?, updated_at = ?,
                    batch_number = COALESCE(?, batch_number)
                WHERE id = ?
                """,
                (
                    str(row.get("customer_name") or ""),
                    str(row.get("phone_number") or ""),
                    str(row.get("motor_type") or ""),
                    str(row.get("problem_description") or ""),
                    float(row.get("estimated_cost") or 0),
                    float(row.get("final_cost") or 0),
                    float(row.get("advance_paid") or 0),
                    payment_status,
                    status,
                    str(row.get("date_added") or date.today().isoformat())[:10],
                    str(row.get("deadline_date") or date.today().isoformat())[:10],
                    source_device_id,
                    now,
                    int(row.get("batch_number")) if row.get("batch_number") else None,
                    motor_id,
                ),
            )
        else:
            imported_batch = int(row.get("batch_number")) if row.get("batch_number") else None
            batch_number = imported_batch if imported_batch else next_batch_number(db)
            cursor = db.execute(
                """
                INSERT INTO motors (
                    job_number, customer_name, phone_number, motor_type, problem_description,
                    image_filename, estimated_cost, final_cost, advance_paid, payment_status,
                    status, date_added, deadline_date, deleted_at, created_at, updated_at,
                    phone_uuid, source_device_id, batch_number
                )
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
                """,
                (
                    unique_job_number(db, str(row.get("job_number") or "")),
                    str(row.get("customer_name") or ""),
                    str(row.get("phone_number") or ""),
                    str(row.get("motor_type") or ""),
                    str(row.get("problem_description") or ""),
                    float(row.get("estimated_cost") or 0),
                    float(row.get("final_cost") or 0),
                    float(row.get("advance_paid") or 0),
                    payment_status,
                    status,
                    str(row.get("date_added") or date.today().isoformat())[:10],
                    str(row.get("deadline_date") or date.today().isoformat())[:10],
                    str(row.get("created_at") or now),
                    now,
                    uuid_value,
                    source_device_id,
                    batch_number,
                ),
            )
            motor_id = cursor.lastrowid
        motor_id_by_uuid[uuid_value] = motor_id
        stats["motors"] += 1

    for row in data.get("workers", []) or []:
        uuid_value = str(row.get("uuid") or "")
        if not uuid_value:
            continue
        now = str(row.get("updated_at") or datetime.now().isoformat(timespec="seconds"))
        monthly_salary = float(row.get("monthly_salary") or 0)
        daily_salary = monthly_salary / max(calendar.monthrange(date.today().year, date.today().month)[1], 1)
        existing = db.execute("SELECT id FROM workers WHERE phone_uuid = ?", (uuid_value,)).fetchone()
        if existing:
            worker_id = existing["id"]
            db.execute(
                """
                UPDATE workers
                SET name = ?, phone_number = ?, role = ?, monthly_salary = ?, daily_salary = ?,
                    active = ?, source_device_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    str(row.get("name") or ""),
                    str(row.get("phone_number") or ""),
                    str(row.get("role") or ""),
                    monthly_salary,
                    daily_salary,
                    int(row.get("active") if row.get("active") is not None else 1),
                    source_device_id,
                    now,
                    worker_id,
                ),
            )
        else:
            cursor = db.execute(
                """
                INSERT INTO workers (
                    name, phone_number, role, monthly_salary, daily_salary, active,
                    created_at, updated_at, phone_uuid, source_device_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(row.get("name") or ""),
                    str(row.get("phone_number") or ""),
                    str(row.get("role") or ""),
                    monthly_salary,
                    daily_salary,
                    int(row.get("active") if row.get("active") is not None else 1),
                    str(row.get("created_at") or now),
                    now,
                    uuid_value,
                    source_device_id,
                ),
            )
            worker_id = cursor.lastrowid
        worker_id_by_uuid[uuid_value] = worker_id
        stats["workers"] += 1

    for row in data.get("workerAttendance", []) or []:
        worker_id = worker_id_by_uuid.get(str(row.get("worker_uuid") or ""))
        if not worker_id:
            continue
        uuid_value = str(row.get("uuid") or pc_uuid("attendance-import", uuid.uuid4().hex))
        now = str(row.get("updated_at") or datetime.now().isoformat(timespec="seconds"))
        status = str(row.get("status") or "Present")
        if status not in ATTENDANCE_STATUSES:
            status = "Present"
        db.execute(
            """
            INSERT INTO worker_attendance (
                worker_id, work_date, status, note, created_at, updated_at, phone_uuid
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(worker_id, work_date) DO UPDATE SET
                status = excluded.status,
                note = excluded.note,
                updated_at = excluded.updated_at,
                phone_uuid = excluded.phone_uuid
            """,
            (
                worker_id,
                str(row.get("work_date") or date.today().isoformat())[:10],
                status,
                str(row.get("note") or ""),
                str(row.get("created_at") or now),
                now,
                uuid_value,
            ),
        )
        stats["attendance"] += 1

    for row in data.get("workerSalaryPayments", []) or []:
        worker_id = worker_id_by_uuid.get(str(row.get("worker_uuid") or ""))
        if not worker_id:
            continue
        uuid_value = str(row.get("uuid") or pc_uuid("salary-payment-import", uuid.uuid4().hex))
        payment_type = str(row.get("payment_type") or "Paid")
        if payment_type not in {"Paid", "Advance"}:
            payment_type = "Paid"
        now = str(row.get("updated_at") or datetime.now().isoformat(timespec="seconds"))
        db.execute(
            """
            INSERT INTO worker_salary_payments (
                phone_uuid, worker_id, payment_date, amount, payment_type, note,
                source_device_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(phone_uuid) DO UPDATE SET
                worker_id = excluded.worker_id,
                payment_date = excluded.payment_date,
                amount = excluded.amount,
                payment_type = excluded.payment_type,
                note = excluded.note,
                source_device_id = excluded.source_device_id,
                updated_at = excluded.updated_at
            """,
            (
                uuid_value,
                worker_id,
                str(row.get("payment_date") or date.today().isoformat())[:10],
                float(row.get("amount") or 0),
                payment_type,
                str(row.get("note") or ""),
                source_device_id,
                str(row.get("created_at") or now),
                now,
            ),
        )
        stats["salary_payments"] += 1

    for row in data.get("motorMedia", []) or []:
        motor_id = motor_id_by_uuid.get(str(row.get("motor_uuid") or ""))
        if not motor_id:
            continue
        uuid_value = str(row.get("uuid") or "")
        if uuid_value and db.execute("SELECT id FROM motor_media WHERE phone_uuid = ?", (uuid_value,)).fetchone():
            continue
        filename_value = Path(str(row.get("filename") or "")).name
        source_file = find_phone_upload(temp_path, filename_value)
        if not source_file:
            continue
        filename = unique_upload_filename(filename_value)
        shutil.copy2(source_file, UPLOAD_FOLDER / filename)
        media_type = str(row.get("media_type") or "image")
        if media_type not in {"image", "video"}:
            media_type = "image"
        db.execute(
            """
            INSERT INTO motor_media (motor_id, filename, media_type, sort_order, created_at, phone_uuid)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                motor_id,
                filename,
                media_type,
                int(row.get("sort_order") or 0),
                str(row.get("created_at") or datetime.now().isoformat(timespec="seconds")),
                uuid_value or pc_uuid("media-import", uuid.uuid4().hex),
            ),
        )
        stats["media"] += 1

    for motor_id in set(motor_id_by_uuid.values()):
        db.execute(
            "UPDATE motors SET image_filename = ? WHERE id = ?",
            (primary_motor_image_filename(db, motor_id), motor_id),
        )
    db.commit()
    return stats


def import_phone_backup(temp_path, manifest):
    restored_db = temp_path / "database.db"
    source_device_id = (manifest or {}).get("deviceId", "")
    stats = {
        "customers": 0,
        "motors": 0,
        "media": 0,
        "workers": 0,
        "attendance": 0,
        "salary_payments": 0,
    }
    db = get_db()
    ensure_phone_import_tables(db)
    phone_db = sqlite3.connect(restored_db)
    phone_db.row_factory = sqlite3.Row
    motor_id_by_uuid = {}
    worker_id_by_uuid = {}

    try:
        if table_exists(phone_db, "customers"):
            for row in phone_db.execute("SELECT * FROM customers").fetchall():
                now = row["updated_at"] or datetime.now().isoformat(timespec="seconds")
                db.execute(
                    """
                    INSERT INTO phone_customers (
                        phone_uuid, name, phone_number, motor_count, balance_due,
                        last_activity, source_device_id, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(phone_uuid) DO UPDATE SET
                        name = excluded.name,
                        phone_number = excluded.phone_number,
                        motor_count = excluded.motor_count,
                        balance_due = excluded.balance_due,
                        last_activity = excluded.last_activity,
                        source_device_id = excluded.source_device_id,
                        updated_at = excluded.updated_at
                    """,
                    (
                        row["uuid"],
                        row["name"],
                        row["phone_number"],
                        row["motor_count"],
                        row["balance_due"],
                        row["last_activity"],
                        source_device_id,
                        row["created_at"] or now,
                        now,
                    ),
                )
                stats["customers"] += 1

        if table_exists(phone_db, "motors"):
            phone_motor_columns = {col[1] for col in phone_db.execute("PRAGMA table_info(motors)").fetchall()}
            has_batch_number = "batch_number" in phone_motor_columns
            for row in phone_db.execute("SELECT * FROM motors ORDER BY id").fetchall():
                status = row["status"] if row["status"] in REPAIR_STATUSES else map_old_status(row["status"])
                payment_status = row["payment_status"] if row["payment_status"] in PAYMENT_STATUSES else calculate_payment_status(row["estimated_cost"], row["final_cost"], row["advance_paid"])
                imported_batch = int(row["batch_number"]) if has_batch_number and row["batch_number"] else None
                existing = db.execute("SELECT id FROM motors WHERE phone_uuid = ?", (row["uuid"],)).fetchone()
                now = row["updated_at"] or datetime.now().isoformat(timespec="seconds")
                if existing:
                    motor_id = existing["id"]
                    db.execute(
                        """
                        UPDATE motors
                        SET customer_name = ?, phone_number = ?, motor_type = ?, problem_description = ?,
                            estimated_cost = ?, final_cost = ?, advance_paid = ?, payment_status = ?,
                            status = ?, date_added = ?, deadline_date = ?, source_device_id = ?, updated_at = ?,
                            batch_number = COALESCE(?, batch_number)
                        WHERE id = ?
                        """,
                        (
                            row["customer_name"],
                            row["phone_number"],
                            row["motor_type"],
                            row["problem_description"],
                            row["estimated_cost"],
                            row["final_cost"],
                            row["advance_paid"],
                            payment_status,
                            status,
                            (row["date_added"] or now)[:10],
                            row["deadline_date"],
                            source_device_id,
                            now,
                            imported_batch,
                            motor_id,
                        ),
                    )
                else:
                    batch_number = imported_batch if imported_batch else next_batch_number(db)
                    cursor = db.execute(
                        """
                        INSERT INTO motors (
                            job_number, customer_name, phone_number, motor_type, problem_description,
                            image_filename, estimated_cost, final_cost, advance_paid, payment_status,
                            status, date_added, deadline_date, deleted_at, created_at, updated_at,
                            phone_uuid, source_device_id, batch_number
                        )
                        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
                        """,
                        (
                            unique_job_number(db, row["job_number"]),
                            row["customer_name"],
                            row["phone_number"],
                            row["motor_type"],
                            row["problem_description"],
                            row["estimated_cost"],
                            row["final_cost"],
                            row["advance_paid"],
                            payment_status,
                            status,
                            (row["date_added"] or now)[:10],
                            row["deadline_date"],
                            row["created_at"] or now,
                            now,
                            row["uuid"],
                            source_device_id,
                            batch_number,
                        ),
                    )
                    motor_id = cursor.lastrowid
                motor_id_by_uuid[row["uuid"]] = motor_id
                stats["motors"] += 1

        if table_exists(phone_db, "workers"):
            for row in phone_db.execute("SELECT * FROM workers ORDER BY id").fetchall():
                existing = db.execute("SELECT id FROM workers WHERE phone_uuid = ?", (row["uuid"],)).fetchone()
                now = row["updated_at"] or datetime.now().isoformat(timespec="seconds")
                monthly_salary = float(row["monthly_salary"] or 0)
                daily_salary = monthly_salary / max(calendar.monthrange(date.today().year, date.today().month)[1], 1)
                if existing:
                    worker_id = existing["id"]
                    db.execute(
                        """
                        UPDATE workers
                        SET name = ?, phone_number = ?, role = ?, monthly_salary = ?, daily_salary = ?,
                            active = ?, source_device_id = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (row["name"], row["phone_number"], row["role"], monthly_salary, daily_salary, row["active"], source_device_id, now, worker_id),
                    )
                else:
                    cursor = db.execute(
                        """
                        INSERT INTO workers (
                            name, phone_number, role, monthly_salary, daily_salary, active,
                            created_at, updated_at, phone_uuid, source_device_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (row["name"], row["phone_number"], row["role"], monthly_salary, daily_salary, row["active"], row["created_at"] or now, now, row["uuid"], source_device_id),
                    )
                    worker_id = cursor.lastrowid
                worker_id_by_uuid[row["uuid"]] = worker_id
                stats["workers"] += 1

        if table_exists(phone_db, "worker_attendance"):
            for row in phone_db.execute("SELECT * FROM worker_attendance").fetchall():
                worker_id = worker_id_by_uuid.get(row["worker_uuid"])
                if not worker_id:
                    continue
                now = row["updated_at"] or datetime.now().isoformat(timespec="seconds")
                db.execute(
                    """
                    INSERT INTO worker_attendance (
                        worker_id, work_date, status, note, created_at, updated_at, phone_uuid
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(worker_id, work_date) DO UPDATE SET
                        status = excluded.status,
                        note = excluded.note,
                        updated_at = excluded.updated_at,
                        phone_uuid = excluded.phone_uuid
                    """,
                    (worker_id, row["work_date"], row["status"], row["note"], row["created_at"] or now, now, row["uuid"]),
                )
                stats["attendance"] += 1

        if table_exists(phone_db, "worker_salary_payments"):
            salary_payment_columns = {
                column[1] for column in phone_db.execute("PRAGMA table_info(worker_salary_payments)").fetchall()
            }
            for row in phone_db.execute("SELECT * FROM worker_salary_payments").fetchall():
                worker_id = worker_id_by_uuid.get(row["worker_uuid"])
                if not worker_id:
                    continue
                payment_type = row["payment_type"] if "payment_type" in salary_payment_columns else "Paid"
                if payment_type not in {"Paid", "Advance"}:
                    payment_type = "Paid"
                now = row["updated_at"] or datetime.now().isoformat(timespec="seconds")
                db.execute(
                    """
                    INSERT INTO worker_salary_payments (
                        phone_uuid, worker_id, payment_date, amount, payment_type, note,
                        source_device_id, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(phone_uuid) DO UPDATE SET
                        worker_id = excluded.worker_id,
                        payment_date = excluded.payment_date,
                        amount = excluded.amount,
                        payment_type = excluded.payment_type,
                        note = excluded.note,
                        source_device_id = excluded.source_device_id,
                        updated_at = excluded.updated_at
                    """,
                    (
                        row["uuid"],
                        worker_id,
                        row["payment_date"],
                        row["amount"],
                        payment_type,
                        row["note"],
                        source_device_id,
                        row["created_at"] or now,
                        now,
                    ),
                )
                stats["salary_payments"] += 1

        if table_exists(phone_db, "motor_media"):
            for row in phone_db.execute("SELECT * FROM motor_media ORDER BY sort_order, id").fetchall():
                motor_id = motor_id_by_uuid.get(row["motor_uuid"])
                if not motor_id:
                    continue
                existing = db.execute("SELECT id FROM motor_media WHERE phone_uuid = ?", (row["uuid"],)).fetchone()
                if existing:
                    continue
                source_file = find_phone_upload(temp_path, row["filename"])
                if not source_file:
                    continue
                filename = unique_upload_filename(row["filename"])
                shutil.copy2(source_file, UPLOAD_FOLDER / filename)
                db.execute(
                    """
                    INSERT INTO motor_media (motor_id, filename, media_type, sort_order, created_at, phone_uuid)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (motor_id, filename, row["media_type"], row["sort_order"], row["created_at"] or datetime.now().isoformat(timespec="seconds"), row["uuid"]),
                )
                stats["media"] += 1

        for motor_id in set(motor_id_by_uuid.values()):
            db.execute(
                "UPDATE motors SET image_filename = ? WHERE id = ?",
                (primary_motor_image_filename(db, motor_id), motor_id),
            )
        db.commit()
        return stats
    finally:
        phone_db.close()


@app.route("/backup/restore", methods=("POST",))
def restore_backup():
    backup_file = request.files.get("backup_file")
    if not backup_file or not backup_file.filename:
        flash("Choose a backup ZIP file to restore.", "error")
        return redirect(url_for("backup"))
    if not backup_file.filename.lower().endswith(".zip"):
        flash("Backup file must be a ZIP file.", "error")
        return redirect(url_for("backup"))

    try:
        with zipfile.ZipFile(backup_file.stream) as archive:
            if not validate_zip_members(archive):
                flash("Invalid backup ZIP. It must contain database.db or both backup_manifest.json and backup_data.json.", "error")
                return redirect(url_for("backup"))

            create_backup_archive()
            if "db" in g:
                close_db()
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                archive.extractall(temp_path)
                manifest_path = temp_path / "backup_manifest.json"
                data_path = temp_path / "backup_data.json"
                manifest = {}
                if manifest_path.exists():
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                backup_type = manifest.get("backupType")
                if data_path.exists() and backup_type in {"phone_export", "phone_export_range"}:
                    data = json.loads(data_path.read_text(encoding="utf-8"))
                    stats = import_phone_backup_json(temp_path, manifest, data)
                    if backup_stats_total(stats) == 0:
                        flash("Phone backup is valid, but it has no importable records.", "error")
                        return redirect(url_for("backup"))
                    flash(
                        "Phone backup imported: "
                        f"{stats['motors']} motors, {stats['customers']} customers, "
                        f"{stats['workers']} workers, {stats['attendance']} attendance records, "
                        f"{stats['salary_payments']} salary payments, {stats['media']} media files.",
                        "success",
                    )
                    return redirect(url_for("backup"))

                restored_db = temp_path / "database.db"
                if not restored_db.exists():
                    flash("Backup ZIP is missing database.db. For phone backups, backup_data.json is also required.", "error")
                    return redirect(url_for("backup"))
                with sqlite3.connect(restored_db) as check_db:
                    check_db.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()

                if backup_type in {"phone_export", "phone_export_range"}:
                    stats = import_phone_backup(temp_path, manifest)
                    if backup_stats_total(stats) == 0:
                        flash("Phone backup is valid, but it has no importable records.", "error")
                        return redirect(url_for("backup"))
                    flash(
                        "Phone backup imported: "
                        f"{stats['motors']} motors, {stats['customers']} customers, "
                        f"{stats['workers']} workers, {stats['attendance']} attendance records, "
                        f"{stats['salary_payments']} salary payments, {stats['media']} media files.",
                        "success",
                    )
                    return redirect(url_for("backup"))

                shutil.copy2(restored_db, DATABASE)
                clear_uploads_folder()
                restored_uploads = temp_path / "uploads"
                if restored_uploads.exists():
                    for upload in restored_uploads.rglob("*"):
                        if upload.is_file():
                            destination = UPLOAD_FOLDER / upload.relative_to(restored_uploads)
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(upload, destination)
        init_db()
        flash("Backup restored successfully.", "success")
    except json.JSONDecodeError:
        flash("Backup restore failed. backup_manifest.json or backup_data.json is not valid JSON.", "error")
    except (sqlite3.Error, zipfile.BadZipFile, OSError):
        flash("Backup restore failed. The file may be damaged or not created by this app.", "error")
    return redirect(url_for("backup"))


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.errorhandler(413)
def file_too_large(error):
    flash("Upload is too large. Maximum total upload size is 128 MB.", "error")
    return redirect(request.referrer or url_for("add_motor"))


init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
