# Offline License System

This project uses a fully offline, one-device permanent license design for the Android app and future PC software.

## How It Works

The developer owns a private RSA key. The Android app contains only the matching public key.

- Developer private key signs a license.
- Android app verifies the license offline with the public key.
- The license contains the device code.
- If the license is copied to another phone, verification fails because the device code is different.

No server is required. The app does not need internet.

## License Format

Licenses use this paste-friendly format:

```text
RWND.<payloadBase64Url>.<signatureBase64Url>
```

The payload is JSON:

```json
{
  "appId": "rewindin-shop",
  "platform": "android",
  "deviceId": "RWND-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX",
  "licenseType": "permanent",
  "customerName": "Shop Name",
  "issuedAt": "2026-05-09",
  "features": ["full"]
}
```

## Private Key vs Public Key

Private key:
- Used only by developer to generate licenses.
- Must not be copied into Android app source.
- Must not be copied into PC software source.
- Must not be shared with customers.

Public key:
- Safe to include in Android app and PC software.
- Only verifies licenses.
- Cannot generate licenses.

## Generate Keypair

Run this once on the developer machine:

```powershell
node tools\license\generate-keypair.js
```

This creates:

```text
license-secrets/license-private.pem
license-secrets/license-public.json
```

`license-secrets/` is ignored by `.gitignore`. Keep a safe backup of `license-private.pem`. If this private key is lost, you cannot generate matching licenses for the app build that contains its public key.

## Generate Android License

Ask the customer to open the app. On the first screen they will see a Device Code.

Easy production method:

```text
generate-license.bat
```

The script asks for the device code, shop/customer name, and platform. Detailed step-by-step instructions are in `LICENSE_GENERATION_GUIDE.md`.

Command-line method:

```powershell
node tools\license\generate-license.js --device RWND-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --customer "ABC Motor Shop" --platform android
```

Send the generated `RWND...` license key to the customer. They paste it into the app and press Activate.

## Generate PC License Later

Use the same private key, but platform `pc`:

```powershell
node tools\license\generate-license.js --device RWND-PC-DEVICE-CODE --customer "ABC Motor Shop" --platform pc
```

The PC software activation and production checklist are documented in `PC_PRODUCTION_GUIDE.md`.

The PC software should contain the same public key and verify:

- `appId` is `rewindin-shop`
- `platform` is `pc`
- `deviceId` matches the PC device code
- signature is valid
- `licenseType` is `permanent`

## Phone Change

When a customer changes phone:

1. New phone creates a new Device Code.
2. Old license will not unlock the new phone.
3. Developer generates a new license for the new Device Code.
4. Customer imports old backup data if needed.

## Backup And Import Behavior

Backups include shop/business data, motors, customers, workers, attendance, salary payments, and media.

License data is not exported in backup. This is intentional.

If a backup from an old phone is imported on a new phone:

- Business data can restore.
- Old license does not unlock the new phone.
- New phone must be activated with a new license.

## Activation Flow

On first launch:

1. App shows Activate App screen.
2. App displays Device Code.
3. Customer sends Device Code to developer.
4. Developer generates offline license.
5. Customer enters license.
6. App verifies signature and device code offline.
7. App unlocks permanently on that phone.

On every later launch:

1. App loads stored license from local metadata.
2. App verifies signature again offline.
3. App verifies device code again.
4. If valid, dashboard opens.
5. If invalid or missing, activation screen appears.

## Troubleshooting

`License format is invalid.`
The key was not pasted completely or does not start with `RWND.`.

`License signature is invalid.`
The key was changed, generated with a different private key, or the app contains a different public key.

`License is for a different device.`
The key belongs to another phone or PC.

`License is not for the Android app.`
The key was generated for platform `pc`.

`License is for a different app.`
The app id inside the license is not `rewindin-shop`.

## Security Limitations

Offline licensing prevents normal license sharing and protects against accidental copying between phones. A highly skilled attacker could still modify the APK and bypass checks. For stronger protection, add server validation, Play Integrity, or native code hardening later.

The current design is the correct practical choice for an offline shop app.
