import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { MotorMedia } from "@/models/types";
import { createUuid } from "@/utils/ids";

const mediaRoot = `${FileSystem.documentDirectory}uploads/motors/`;
const shopMediaRoot = `${FileSystem.documentDirectory}uploads/shop/`;

export async function ensureMediaFolders() {
  const info = await FileSystem.getInfoAsync(mediaRoot);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(mediaRoot, { intermediates: true });
  }
}

export async function ensureShopMediaFolder() {
  const info = await FileSystem.getInfoAsync(shopMediaRoot);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(shopMediaRoot, { intermediates: true });
  }
}

export async function pickMotorMedia(motorUuid: string, currentCount: number) {
  await ensureMediaFolders();
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Media permission is required to attach motor files.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    quality: 1,
    orderedSelection: true
  });
  if (result.canceled) {
    return [];
  }
  return savePickedAssets(motorUuid, result.assets, currentCount);
}

export async function captureMotorPhoto(motorUuid: string, currentCount: number) {
  await ensureMediaFolders();
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Camera permission is required to capture motor photos.");
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images", "videos"],
    quality: 1
  });
  if (result.canceled) {
    return [];
  }
  return savePickedAssets(motorUuid, result.assets, currentCount);
}

export async function pickShopLogo() {
  await ensureShopMediaFolder();
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Media permission is required to select a shop logo.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1
  });
  if (result.canceled || !result.assets[0]) {
    return "";
  }
  const asset = result.assets[0];
  const extension = extensionFromUri(asset.uri, "jpg");
  const destination = `${shopMediaRoot}shop-logo-${createUuid()}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destination });
  return destination;
}

export async function deleteLocalFiles(uris: string[]) {
  for (const uri of uris) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch {
      // File cleanup is best-effort; the database delete has already removed the record.
    }
  }
}

async function savePickedAssets(
  motorUuid: string,
  assets: ImagePicker.ImagePickerAsset[],
  currentCount: number
): Promise<Omit<MotorMedia, "id" | "syncStatus" | "deviceId" | "createdAt" | "updatedAt">[]> {
  const saved: Omit<MotorMedia, "id" | "syncStatus" | "deviceId" | "createdAt" | "updatedAt">[] = [];
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const extension = extensionFromUri(asset.uri, asset.type === "video" ? "mp4" : "jpg");
    const uuid = createUuid();
    const filename = `${motorUuid}-${uuid}.${extension}`;
    const destination = `${mediaRoot}${filename}`;
    await FileSystem.copyAsync({ from: asset.uri, to: destination });
    const fileBase64 = await FileSystem.readAsStringAsync(destination, {
      encoding: FileSystem.EncodingType.Base64
    });
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fileBase64);
    saved.push({
      uuid,
      motorUuid,
      uri: destination,
      filename,
      mediaType: asset.type === "video" ? "video" : "image",
      checksum,
      sortOrder: currentCount + index
    });
  }
  return saved;
}

function extensionFromUri(uri: string, fallback: string) {
  const clean = uri.split("?")[0] || "";
  const extension = clean.includes(".") ? clean.split(".").pop()?.toLowerCase() : "";
  return extension && extension.length <= 5 ? extension : fallback;
}
