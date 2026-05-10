import * as Crypto from "expo-crypto";
import { toByteArray } from "base64-js";
import { getStoredLicense, saveStoredLicense } from "@/db/repositories";
import { LicensePayload, StoredLicense } from "@/models/types";
import { getDeviceId } from "@/services/device";
import { nowIso } from "@/utils/dates";

const APP_ID = "rewindin-shop";
const PLATFORM = "android";
const LICENSE_PREFIX = "RWND";
const PUBLIC_MODULUS_BASE64URL =
  "rhgxpftL9JtuAlpiakMprQdNU0SjTdIHMZpsejtw3EHYJ09Za9QXdIMnYUJBkuN4987jRrIpAdah-yusMSPc_2hDe9lREsxP-1u_ddT91Bl79sXsEaIWvq_3aPFqC93reFRC5tAIzKJoQ3gm5JphhtXmIPhQ5dnP14TkNyJvGbTT-DrKkhMwRf7Zd31DMOHbXiTcsQMAmzioicCgDq_8IRGW0U84ufLTxVCWSbRbKPf2bjplB4pQGvlFCufo3XS-OQDoIzzZS2eeNKmi07uW7SYk3u8Y5fJ_XwmJsE5VZHyLiF0lAmEjue6EivKd_XA_udz10Rqh7Yqh3iw38S4HUw";
const PUBLIC_EXPONENT_BASE64URL = "AQAB";
const SHA256_DIGEST_INFO_PREFIX = "3031300d060960864801650304020105000420";

export type LicenseStatus =
  | { valid: true; deviceCode: string; license: StoredLicense }
  | { valid: false; deviceCode: string; reason: string; license?: StoredLicense | null };

export async function getLicenseDeviceCode() {
  const deviceId = await getDeviceId();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, deviceId);
  return `RWND-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 24)}`.toUpperCase();
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const deviceCode = await getLicenseDeviceCode();
  const stored = await getStoredLicense();
  if (!stored) {
    return { valid: false, deviceCode, reason: "License is required.", license: null };
  }
  const result = await verifyLicenseKey(stored.key, deviceCode);
  if (!result.valid) {
    return { valid: false, deviceCode, reason: result.reason, license: stored };
  }
  return { valid: true, deviceCode, license: stored };
}

export async function activateLicenseKey(rawKey: string) {
  const deviceCode = await getLicenseDeviceCode();
  const result = await verifyLicenseKey(rawKey, deviceCode);
  if (!result.valid) {
    throw new Error(result.reason);
  }
  const normalized = normalizeLicenseKey(rawKey);
  await saveStoredLicense(normalized, result.payload, nowIso());
  return getLicenseStatus();
}

async function verifyLicenseKey(rawKey: string, deviceCode: string): Promise<{ valid: true; payload: LicensePayload } | { valid: false; reason: string }> {
  try {
    const normalized = normalizeLicenseKey(rawKey);
    const parts = normalized.split(".");
    if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
      return { valid: false, reason: "License format is invalid." };
    }

    const payloadBase64Url = parts[1];
    const signature = base64UrlToBytes(parts[2]);
    const payload = JSON.parse(utf8FromBytes(base64UrlToBytes(payloadBase64Url))) as LicensePayload;
    const signatureOk = await verifyRs256(payloadBase64Url, signature);
    if (!signatureOk) {
      return { valid: false, reason: "License signature is invalid." };
    }
    if (payload.appId !== APP_ID) {
      return { valid: false, reason: "License is for a different app." };
    }
    if (payload.platform !== PLATFORM) {
      return { valid: false, reason: "License is not for the Android app." };
    }
    if (payload.deviceId !== deviceCode) {
      return { valid: false, reason: "License is for a different device." };
    }
    if (payload.licenseType !== "permanent") {
      return { valid: false, reason: "License type is not supported." };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "License could not be read. Check the key and try again." };
  }
}

async function verifyRs256(message: string, signature: Uint8Array) {
  const modulusBytes = base64UrlToBytes(PUBLIC_MODULUS_BASE64URL);
  const modulus = bytesToBigInt(modulusBytes);
  const exponent = bytesToBigInt(base64UrlToBytes(PUBLIC_EXPONENT_BASE64URL));
  const keyLength = modulusBytes.length;
  if (signature.length !== keyLength) {
    return false;
  }
  const decrypted = bigIntToBytes(modPow(bytesToBigInt(signature), exponent, modulus), keyLength);
  const digestHex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, message);
  const digestInfo = hexToBytes(`${SHA256_DIGEST_INFO_PREFIX}${digestHex}`);
  const paddingLength = keyLength - digestInfo.length - 3;
  if (paddingLength < 8) {
    return false;
  }
  const expected = new Uint8Array(keyLength);
  expected[0] = 0x00;
  expected[1] = 0x01;
  expected.fill(0xff, 2, 2 + paddingLength);
  expected[2 + paddingLength] = 0x00;
  expected.set(digestInfo, 3 + paddingLength);
  return equalBytes(decrypted, expected);
}

function normalizeLicenseKey(value: string) {
  return value.replace(/\s/g, "").trim();
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return toByteArray(base64);
}

function utf8FromBytes(bytes: Uint8Array) {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 1) {
    encoded += `%${bytes[index].toString(16).padStart(2, "0")}`;
  }
  return decodeURIComponent(encoded);
}

function bytesToBigInt(bytes: Uint8Array) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

function bigIntToBytes(value: bigint, length: number) {
  const bytes = new Uint8Array(length);
  let next = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return bytes;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint) {
  let result = 1n;
  let nextBase = base % modulus;
  let nextExponent = exponent;
  while (nextExponent > 0n) {
    if (nextExponent & 1n) {
      result = (result * nextBase) % modulus;
    }
    nextExponent >>= 1n;
    nextBase = (nextBase * nextBase) % modulus;
  }
  return result;
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function equalBytes(first: Uint8Array, second: Uint8Array) {
  if (first.length !== second.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < first.length; index += 1) {
    diff |= first[index] ^ second[index];
  }
  return diff === 0;
}
