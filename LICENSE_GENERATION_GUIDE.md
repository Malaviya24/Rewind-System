# License Generation Guide

This guide is for daily production use when a customer sends you a device code.

## What You Need

- Node.js installed on your developer computer.
- The private key file at:

```text
license-secrets/license-private.pem
```

Do not send this private key to anyone. Do not copy it into the Android app or PC software.

## First Time Setup

Run this only once if the private key does not exist:

```powershell
node tools\license\generate-keypair.js
```

This creates:

```text
license-secrets/license-private.pem
license-secrets/license-public.json
```

Keep a backup of `license-private.pem` in a safe place.

## Generate License The Easy Way

Double-click or run this file from the main project folder:

```text
generate-license.bat
```

It will ask:

```text
Enter device code from app:
Enter shop/customer name:
Platform android or pc [android]:
```

For Android phone app, press Enter on the platform question to use `android`.

The script prints a license starting with:

```text
RWND.
```

Copy the full license key and send it to the customer. The customer pastes it into the app Activation screen and taps Activate.

## Generate License By Command

You can also run the direct command:

```powershell
node tools\license\generate-license.js --device RWND-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --customer "ABC Motor Shop" --platform android
```

For future PC software:

```powershell
node tools\license\generate-license.js --device RWND-PC-DEVICE-CODE --customer "ABC Motor Shop" --platform pc
```

## Phone Change

If the customer changes phone:

1. New phone shows a new device code.
2. Old license will not work on the new phone.
3. Generate a new license using the new device code.
4. Customer can restore business data from backup, but the license must be new.

## Common Errors

`Private key not found`

Run `node tools\license\generate-keypair.js` or restore your saved private key to `license-secrets/license-private.pem`.

`License is for a different device`

The device code was typed wrong, or the license was generated for another phone.

`License signature is invalid`

The license key was copied incompletely, changed, or generated with a different private key.
