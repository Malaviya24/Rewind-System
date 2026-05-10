# Motor Repair Manager Android

Offline-first Android app for the existing Flask/SQLite Motor Repair Manager.

## Architecture

- Fully local SQLite database on the phone.
- Local media storage for motor photos and videos.
- No server, internet, or cloud sync required.
- Backup export creates a ZIP containing:
  - `database.db`
  - `uploads/`
  - `backup_manifest.json`
- PC remains the master storage and can later import/merge phone backups.

## Run

```powershell
cd android-app
npm.cmd install
npm.cmd run start -- --lan
```

Use `npm.cmd` on this Windows machine because PowerShell script execution can block `npm.ps1`.
This project also includes a local `.npmrc` mirror because the default npm registry was dropping downloads on this PC.

For a production APK/AAB, use an Expo development build or EAS Build after testing the offline workflow.

## Current Implementation

- Expo app scaffold in `src/App.tsx`.
- Offline SQLite schema in `src/db/schema.ts`.
- Sample seed data for motors and workers.
- Motor list, motor detail, add/edit motor, customers, workers, settings, and backup screens.
- Local photo/video attachment service.
- ZIP backup export service with manifest, database, and uploads.
 
See `BUILD_ANDROID.md` for Expo Go testing and APK build requirements.

## Validation Note

JSON configs have been checked locally. Dependency install was not completed because registry downloads timed out in this environment, so run `npm.cmd install` before `npm run typecheck`.

## Important Merge Rules For PC Import

- Every record has a stable `uuid`.
- New phone UUIDs should insert into PC.
- Existing UUIDs should compare `updated_at`.
- Media should copy by checksum/filename if missing.
- PC data should never be replaced blindly by a phone backup.
