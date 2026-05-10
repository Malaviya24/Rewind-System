const crypto = require("crypto");

const ALLOWED_PLATFORMS = new Set(["android", "pc"]);
const DEFAULT_APP_ID = "rewindin-shop";

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function normalizePrivateKey(value) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.includes("-----BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return Buffer.from(trimmed, "base64").toString("utf8").trim();
}

function getPrivateKey() {
  const privateKey = normalizePrivateKey(process.env.LICENSE_PRIVATE_KEY || process.env.LICENSE_PRIVATE_KEY_BASE64 || "");
  if (!privateKey) {
    return "";
  }
  try {
    return crypto.createPrivateKey(privateKey);
  } catch {
    throw new Error("Server private key is invalid. Check LICENSE_PRIVATE_KEY_BASE64 in Vercel.");
  }
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return (req.headers["x-admin-token"] || "").toString().trim();
}

function assertAdmin(req) {
  const expectedToken = (process.env.LICENSE_ADMIN_TOKEN || "").trim();
  if (!expectedToken) {
    return { ok: false, status: 500, message: "Server is missing LICENSE_ADMIN_TOKEN." };
  }
  const receivedToken = getBearerToken(req);
  const receivedBuffer = Buffer.from(receivedToken);
  const expectedBuffer = Buffer.from(expectedToken);
  if (!receivedToken || receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return { ok: false, status: 401, message: "Admin token is invalid." };
  }
  return { ok: true };
}

function normalizeDeviceId(value) {
  const raw = String(value || "").trim().toUpperCase();
  const extracted = raw.match(/\bRWND(?:-PC)?-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){5}\b/);
  return (extracted ? extracted[0] : raw).replace(/\s+/g, "");
}

function validateInput(body) {
  const appId = String(body.appId || DEFAULT_APP_ID).trim();
  const platform = String(body.platform || "android").trim().toLowerCase();
  const deviceId = normalizeDeviceId(body.deviceId);
  const customerName = String(body.customerName || "").trim();

  if (!appId) {
    return { ok: false, message: "App ID is required." };
  }
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return { ok: false, message: "Platform must be android or pc." };
  }
  if (!deviceId || !/^RWND(?:-PC)?-[A-Z0-9-]{10,80}$/.test(deviceId)) {
    return { ok: false, message: "Device code format is invalid." };
  }
  if (!customerName || customerName.length < 2) {
    return { ok: false, message: "Customer/shop name is required." };
  }
  if (customerName.length > 120) {
    return { ok: false, message: "Customer/shop name is too long." };
  }

  return { ok: true, value: { appId, platform, deviceId, customerName } };
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function generateLicense({ appId, platform, deviceId, customerName }) {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error("Server is missing LICENSE_PRIVATE_KEY or LICENSE_PRIVATE_KEY_BASE64.");
  }

  const payload = {
    appId,
    platform,
    deviceId,
    licenseType: "permanent",
    customerName,
    issuedAt: new Date().toISOString().slice(0, 10),
    features: ["full"]
  };
  const payloadBase64Url = base64UrlJson(payload);
  const signature = crypto.sign("RSA-SHA256", Buffer.from(payloadBase64Url, "utf8"), privateKey).toString("base64url");
  return {
    licenseKey: `RWND.${payloadBase64Url}.${signature}`,
    payload
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Use POST." });
    return;
  }

  const admin = assertAdmin(req);
  if (!admin.ok) {
    sendJson(res, admin.status, { ok: false, error: admin.message });
    return;
  }

  try {
    const body = await readBody(req);
    const input = validateInput(body);
    if (!input.ok) {
      sendJson(res, 400, { ok: false, error: input.message });
      return;
    }
    const result = generateLicense(input.value);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "License could not be generated." });
  }
};
