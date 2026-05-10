# Rewind System

Production offline shop management system for motor repair businesses. The project includes:

- Windows PC software built with Python Flask and SQLite.
- Android offline app built with React Native / Expo and SQLite.
- License generator website for creating one-device offline license keys.
- Backup, restore, media, worker attendance, payroll, PIN, and offline license tooling.

## Download

Use GitHub Releases for customer-ready files:

| Product | Download |
| --- | --- |
| Windows PC Software | [MotorRepairManager-shareable.zip](https://github.com/Malaviya24/Rewind-System/releases/latest/download/MotorRepairManager-shareable.zip) |
| Android App APK | [Rewind-System-Android.apk](https://github.com/Malaviya24/Rewind-System/releases/latest/download/Rewind-System-Android.apk) |

If these links show `Not Found`, create or update the latest GitHub Release and upload the files from:

```text
dist/MotorRepairManager-shareable.zip
android-app/android/app/build/outputs/apk/release/app-release.apk
```

## Project Structure

```text
.
├── app.py                         # PC Flask software
├── launcher.py                    # Packaged EXE launcher
├── templates/                     # PC app HTML screens
├── static/                        # PC app CSS/JS/assets
├── android-app/                   # React Native / Expo Android app
├── license-web/                   # Vercel license generator website
├── tools/                         # License and developer utilities
├── installer/                     # Windows packaging docs/scripts
├── build-windows-software.bat     # PC software build shortcut
├── generate-license.bat           # Local offline license generator shortcut
├── LICENSE_GENERATION_GUIDE.md    # License generation guide
├── OFFLINE_LICENSE.md             # Offline license architecture
├── SHARE_PC_SOFTWARE.md           # PC transfer and clean runtime guide
└── ANDROID_CLEAN_RELEASE.md       # Android clean release guide
```

## Runtime Data Safety

Production builds must not include local test data. These folders/files are intentionally ignored by Git:

```text
database.db
uploads/
backups/
license-secrets/
build/
dist/
android-app/node_modules/
android-app/android/app/build/
```

PC packaged runtime data is stored on the user's computer at:

```text
%LOCALAPPDATA%\MotorRepairManager\
```

Android runtime data is stored inside the app sandbox on the phone.

## Run PC Software Locally

```powershell
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

## Build Windows Software

```powershell
build-windows-software.bat
```

Output:

```text
dist/MotorRepairManager.exe
dist/MotorRepairManager-shareable.zip
```

## Build Android APK

```powershell
cd android-app
npm install
npm run typecheck
cd android
.\gradlew.bat assembleRelease
```

Output:

```text
android-app/android/app/build/outputs/apk/release/app-release.apk
```

## License Generator Website

The admin website lives in:

```text
license-web/
```

Deploy `license-web` as the Vercel project root and set:

```text
LICENSE_ADMIN_TOKEN=your-secret-admin-password
LICENSE_PRIVATE_KEY_BASE64=<base64 private key>
```

See [LICENSE_GENERATION_GUIDE.md](LICENSE_GENERATION_GUIDE.md) for full usage.

## Backup And Transfer

- Use Backup & Restore to move shop data between phones or PCs.
- License keys are one-device and are not transferred by backup.
- A new phone or PC needs a new license generated from its own device code.

## Production Checklist

Before sharing a release:

1. Build the PC ZIP.
2. Build the Android release APK.
3. Test activation with a real device code.
4. Test backup export/import.
5. Upload both files to GitHub Releases.
6. Confirm the download links above work.
