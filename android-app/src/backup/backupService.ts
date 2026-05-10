import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { toByteArray, fromByteArray } from "base64-js";
import { BackupData, BackupManifest, BackupRange } from "@/models/types";
import { getBackupCounts, getBackupData, getShopSettings, importBackupData } from "@/db/repositories";
import { schemaVersion } from "@/db/schema";
import { getDeviceId } from "@/services/device";
import { nowIso } from "@/utils/dates";

const databasePath = `${FileSystem.documentDirectory}SQLite/motor_repair_phone.db`;
const uploadRoot = `${FileSystem.documentDirectory}uploads/`;
const exportRoot = `${FileSystem.documentDirectory}exports/`;
const supportedBackupTypes = new Set(["phone_export", "phone_export_range", "pc_export", "pc_export_range"]);

export async function createPhoneBackupZip(range?: BackupRange) {
  await ensureExportFolder();
  const data = await getBackupData(range);
  const manifest = await buildManifest(data, range);
  const files: Record<string, Uint8Array> = {
    "backup_manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "backup_data.json": strToU8(JSON.stringify(data, null, 2))
  };

  const dbInfo = !range ? await FileSystem.getInfoAsync(databasePath) : null;
  if (dbInfo?.exists) {
    files["database.db"] = await readFileAsBytes(databasePath);
  }

  await appendSelectedUploadFiles(data, files);

  const zipBytes = zipSync(files, { level: 6 });
  const rangeLabel = range ? `${range.startDate}-to-${range.endDate}` : manifest.createdAt.slice(0, 10);
  const backupName = `phone-backup-${rangeLabel}-${Date.now()}.zip`;
  const backupUri = `${exportRoot}${backupName}`;
  await FileSystem.writeAsStringAsync(backupUri, fromByteArray(zipBytes), {
    encoding: FileSystem.EncodingType.Base64
  });
  return { uri: backupUri, manifest };
}

export async function sharePhoneBackup(range?: BackupRange) {
  const backup = await createPhoneBackupZip(range);
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(backup.uri, {
      mimeType: "application/zip",
      dialogTitle: "Export Motor Repair phone backup"
    });
  }
  return backup;
}

export async function importLatestBackupFromPickedFolder() {
  const saf = FileSystem.StorageAccessFramework;
  const permission = await saf.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Choose the folder that contains your backup ZIP.");
  }
  const entries = await saf.readDirectoryAsync(permission.directoryUri);
  const zipUris = entries
    .filter((uri) => decodeURIComponent(uri).toLowerCase().includes(".zip"))
    .sort()
    .reverse();
  if (!zipUris.length) {
    throw new Error("No ZIP backup found in the selected folder.");
  }
  return importPhoneBackupZip(zipUris[0]);
}

export async function importPhoneBackupZip(zipUri: string) {
  const base64 = await FileSystem.readAsStringAsync(zipUri, {
    encoding: FileSystem.EncodingType.Base64
  });
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(toByteArray(base64));
  } catch {
    throw new Error("Backup ZIP could not be opened.");
  }
  validateZipPaths(unzipped);
  const manifestBytes = unzipped["backup_manifest.json"];
  const dataBytes = unzipped["backup_data.json"];
  if (!manifestBytes) {
    throw new Error("Invalid backup: backup_manifest.json is missing.");
  }
  if (!dataBytes) {
    if (unzipped["database.db"]) {
      throw new Error("Invalid backup: backup_data.json is missing. If this is an old PC backup, create a new backup from updated PC software.");
    }
    throw new Error("Invalid backup: backup_data.json is missing.");
  }
  let manifest: BackupManifest;
  let data: BackupData;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest;
    data = JSON.parse(strFromU8(dataBytes)) as BackupData;
  } catch {
    throw new Error("Backup ZIP contains damaged backup data.");
  }
  validateManifest(manifest);
  if (!hasImportableRecords(data)) {
    throw new Error("Backup is valid but contains no records to import.");
  }
  await restoreUploadFiles(unzipped, data);
  const stats = await importBackupData(data);
  return { manifest, stats };
}

async function buildManifest(data: BackupData, range?: BackupRange): Promise<BackupManifest> {
  return {
    app: "Motor Repair Manager Android",
    appId: "rewindin-shop",
    platform: "android",
    backupType: range ? "phone_export_range" : "phone_export",
    appVersion: "0.1.0",
    schemaVersion,
    deviceId: await getDeviceId(),
    createdAt: nowIso(),
    dateRange: range,
    shop: await getShopSettings(),
    licenseIncluded: false,
    counts: {
      motors: data.motors.length,
      customers: data.customers.length,
      workers: data.workers.length,
      attendance: data.workerAttendance.length,
      salaryPayments: data.workerSalaryPayments.length,
      media: data.motorMedia.length
    }
  };
}

function validateManifest(manifest: BackupManifest) {
  const appName = String(manifest.app || "");
  const appId = String(manifest.appId || "");
  if (!appName.includes("Motor Repair Manager") && appId !== "rewindin-shop") {
    throw new Error("This ZIP is not a Motor Repair Manager backup.");
  }
  if (!supportedBackupTypes.has(String(manifest.backupType))) {
    throw new Error("Unsupported backup type.");
  }
}

function hasImportableRecords(data: BackupData) {
  return (
    (data.customers || []).length +
      (data.motors || []).length +
      (data.motorMedia || []).length +
      (data.workers || []).length +
      (data.workerAttendance || []).length +
      (data.workerSalaryPayments || []).length +
      (data.appMeta || []).length >
    0
  );
}

function validateZipPaths(unzipped: Record<string, Uint8Array>) {
  for (const path of Object.keys(unzipped)) {
    const normalized = path.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || normalized.includes("/..")) {
      throw new Error("Backup ZIP contains unsafe file paths.");
    }
  }
}

async function appendSelectedUploadFiles(data: BackupData, files: Record<string, Uint8Array>) {
  const mediaFilenames = new Set(data.motorMedia.map((row) => String(row.filename || "")).filter(Boolean));
  for (const filename of mediaFilenames) {
    const uri = `${uploadRoot}motors/${filename}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      files[`uploads/motors/${filename}`] = await readFileAsBytes(uri);
    }
  }
  const shopLogo = String(data.appMeta.find((row) => row.key === "shop_logo_uri")?.value || "");
  if (shopLogo) {
    const filename = shopLogo.split("/").pop();
    if (filename) {
      const info = await FileSystem.getInfoAsync(shopLogo);
      if (info.exists) {
        files[`uploads/shop/${filename}`] = await readFileAsBytes(shopLogo);
      }
    }
  }
}

async function restoreUploadFiles(unzipped: Record<string, Uint8Array>, data: BackupData) {
  for (const [path, bytes] of Object.entries(unzipped)) {
    if (!path.startsWith("uploads/")) {
      continue;
    }
    const destination = `${FileSystem.documentDirectory}${path}`;
    await ensureParentFolder(destination);
    await FileSystem.writeAsStringAsync(destination, fromByteArray(bytes), {
      encoding: FileSystem.EncodingType.Base64
    });
  }
  data.motorMedia = data.motorMedia.map((row) => {
    const filename = String(row.filename || "");
    return filename ? { ...row, uri: `${uploadRoot}motors/${filename}` } : row;
  });
  data.appMeta = data.appMeta.map((row) => {
    if (row.key !== "shop_logo_uri" || !row.value) {
      return row;
    }
    const filename = String(row.value).split("/").pop();
    return filename ? { ...row, value: `${uploadRoot}shop/${filename}` } : row;
  });
}

async function ensureParentFolder(uri: string) {
  const parent = uri.slice(0, uri.lastIndexOf("/") + 1);
  const info = await FileSystem.getInfoAsync(parent);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(parent, { intermediates: true });
  }
}

async function appendUploadFiles(directoryUri: string, zipPath: string, files: Record<string, Uint8Array>) {
  const info = await FileSystem.getInfoAsync(directoryUri);
  if (!info.exists) {
    return;
  }
  const entries = await FileSystem.readDirectoryAsync(directoryUri);
  for (const entry of entries) {
    const childUri = `${directoryUri}${entry}`;
    const childInfo = await FileSystem.getInfoAsync(childUri);
    if (childInfo.isDirectory) {
      await appendUploadFiles(`${childUri}/`, `${zipPath}/${entry}`, files);
    } else if (childInfo.exists) {
      files[`${zipPath}/${entry}`] = await readFileAsBytes(childUri);
    }
  }
}

async function readFileAsBytes(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  return toByteArray(base64);
}

async function ensureExportFolder() {
  const info = await FileSystem.getInfoAsync(exportRoot);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(exportRoot, { intermediates: true });
  }
}
