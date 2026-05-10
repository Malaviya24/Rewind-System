# Share PC Software

Use this when you want to send the PC software to another computer.

## Ready Files

After running the build, share either:

```text
dist\MotorRepairManager.exe
```

or the ZIP:

```text
dist\MotorRepairManager-shareable.zip
```

The EXE has the app icon and can be opened directly.

## Build Again

From the main project folder:

```text
build-windows-software.bat
```

This creates:

```text
dist\MotorRepairManager.exe
dist\MotorRepairManager-shareable.zip
```

If Inno Setup 6 is installed, it can also create:

```text
installer\Output\MotorRepairManagerSetup.exe
```

## Transfer To Another PC

1. Copy `MotorRepairManager.exe` or `MotorRepairManager-shareable.zip` to the new PC.
2. Open `MotorRepairManager.exe`.
3. Browser opens at `http://127.0.0.1:5000`.
4. Activation screen shows the new PC Device Code.
5. Generate a PC license:

```powershell
node tools\license\generate-license.js --device RWND-PC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --customer "Shop Name" --platform pc
```

6. Paste the license into the new PC software.
7. Restore data from Backup & Restore if moving shop data.

## Important

The license is one-device. Copying the EXE to another PC is allowed, but the old PC license will not unlock the new PC. The new PC needs its own `platform pc` license.

Business data is stored here on installed/packaged app runs:

```text
%LOCALAPPDATA%\MotorRepairManager\
```

Use Backup & Restore to move motors, customers, workers, attendance, payments, and media safely.

For Android clean-release behavior, see:

```text
ANDROID_CLEAN_RELEASE.md
```

## Why Old/Test Data May Appear

The EXE does not store business data inside itself. It reads runtime data from:

```text
%LOCALAPPDATA%\MotorRepairManager\
```

If that folder already has an old `database.db`, the app will show that old data. This can happen on your own PC after previous testing.

## Clean First Launch Test

To test the same behavior as a brand-new PC, run:

```powershell
python tools\dev\reset_pc_runtime_data.py
```

This only previews what will be deleted. To actually reset packaged runtime data:

```powershell
python tools\dev\reset_pc_runtime_data.py --yes
```

This deletes only:

```text
%LOCALAPPDATA%\MotorRepairManager\database.db
%LOCALAPPDATA%\MotorRepairManager\uploads\
%LOCALAPPDATA%\MotorRepairManager\backups\
```

It never deletes the project `database.db`, source files, license generator, or private key.

After reset, opening `MotorRepairManager.exe` should show Activation first, then an empty dashboard after activation unless a backup is imported.
