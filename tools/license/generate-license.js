const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..", "..");
const defaultPrivateKeyPath = path.join(root, "license-secrets", "license-private.pem");

function usage() {
  console.log(`Usage:
node tools/license/generate-license.js --device RWND-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --customer "Shop Name" --platform android

Options:
  --device      Required device code from the app activation screen
  --customer    Required customer/shop name
  --platform    android or pc (default android)
  --app         App id (default rewindin-shop)
  --private     Private key PEM path (default license-secrets/license-private.pem)
`);
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const deviceId = arg("device").trim();
const customerName = arg("customer").trim();
const platform = arg("platform", "android").trim();
const appId = arg("app", "rewindin-shop").trim();
const privateKeyPath = path.resolve(arg("private", defaultPrivateKeyPath));

if (!deviceId || !customerName) {
  usage();
  process.exit(1);
}

if (!["android", "pc"].includes(platform)) {
  throw new Error("Platform must be android or pc.");
}

if (!fs.existsSync(privateKeyPath)) {
  throw new Error(`Private key not found: ${privateKeyPath}`);
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

const payloadBase64Url = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const privateKey = fs.readFileSync(privateKeyPath, "utf8");
const signature = crypto.sign("RSA-SHA256", Buffer.from(payloadBase64Url, "utf8"), privateKey).toString("base64url");

console.log(`RWND.${payloadBase64Url}.${signature}`);
