# Rewind License Generator Website

Small Vercel admin website for generating Android and PC offline license keys.

## Security Rule

The private key must be configured only as a Vercel environment variable. Do not paste the private key into frontend code and do not commit it to GitHub.

The browser sends device details to `/api/generate`. The serverless function signs the license with `LICENSE_PRIVATE_KEY` or `LICENSE_PRIVATE_KEY_BASE64` and returns a key like:

```text
RWND.<payloadBase64Url>.<signatureBase64Url>
```

## Required Vercel Environment Variables

Set these in Vercel Project Settings > Environment Variables:

```text
LICENSE_ADMIN_TOKEN=choose-a-long-secret-password
LICENSE_PRIVATE_KEY_BASE64=<base64 of license-secrets/license-private.pem>
```

Use base64 because it is easier to paste safely into Vercel.

PowerShell command to create the value:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content ..\license-secrets\license-private.pem -Raw)))
```

Alternative:

```text
LICENSE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

## Deploy To Vercel

1. Push the repo to GitHub.
2. In Vercel, create a new project.
3. Select this repository.
4. Set the project root directory to:

```text
license-web
```

5. Add the environment variables above.
6. Deploy.

Vercel serves the static website from `public/` and the license signing endpoint from `api/generate.js`.

## How To Generate License

1. Open the deployed Vercel website.
2. Enter the admin token.
3. Select `Android app` or `PC software`.
4. Paste the device code from the activation screen. You may paste only the code or the full shared text, for example `Device Code: RWND-...`.
5. Enter shop/customer name.
6. Click `Generate License`.
7. Copy the generated license into the Android app or PC software.

For UI testing only, use `Create Test Device Code`. Do not use that generated test code for a real customer because it will not match their phone or PC.

If the website says the server private key is invalid, recreate the Vercel `LICENSE_PRIVATE_KEY_BASE64` value from the production private key and redeploy.

## Notes

- Android licenses use `platform: android`.
- PC licenses use `platform: pc`.
- The license is permanent and device locked.
- A PC license will not unlock Android.
- An Android license will not unlock PC.
- If a customer changes phone/PC, generate a new license for the new device code.
