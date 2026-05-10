const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..", "..");
const secretsDir = path.join(root, "license-secrets");
const privateKeyPath = path.join(secretsDir, "license-private.pem");
const publicJsonPath = path.join(secretsDir, "license-public.json");

if (!fs.existsSync(secretsDir)) {
  fs.mkdirSync(secretsDir, { recursive: true });
}

if (fs.existsSync(privateKeyPath)) {
  console.error(`Private key already exists: ${privateKeyPath}`);
  console.error("Move it first if you really want to generate a new production key.");
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicExponent: 0x10001,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const publicObject = crypto.createPublicKey(publicKey);
const jwk = publicObject.export({ format: "jwk" });

fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(
  publicJsonPath,
  JSON.stringify(
    {
      algorithm: "RS256",
      modulusBase64Url: jwk.n,
      exponentBase64Url: jwk.e,
      publicKeyPem: publicKey
    },
    null,
    2
  )
);

console.log("Offline license keypair created.");
console.log(`Private key: ${privateKeyPath}`);
console.log(`Public config: ${publicJsonPath}`);
console.log("Keep the private key secret. Do not copy it into Android or PC app source.");
