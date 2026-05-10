# Build Windows Installer

Use this when the app is ready to share as normal downloadable Windows software.

## Easy Build

From the main project folder, run:

```text
build-windows-software.bat
```

This creates the app icon, installs PyInstaller if missing, and builds:

```text
dist\MotorRepairManager.exe
```

You can copy this EXE to another PC and run it.

If Inno Setup 6 is installed, the same script also creates:

```text
installer\Output\MotorRepairManagerSetup.exe
```

## Install Build Tools Manually

```powershell
python -m pip install pyinstaller
```

Install Inno Setup 6 from:

```text
https://jrsoftware.org/isinfo.php
```

## Manual EXE Build

Run from the project folder:

```powershell
python tools\build\create_icon.py
python -m PyInstaller --noconfirm MotorRepairManager.spec
```

The EXE will be created here:

```text
dist\MotorRepairManager.exe
```

## Manual Installer Build

Open `installer\MotorRepairManager.iss` in Inno Setup and click **Compile**.

The installer will be created in:

```text
installer\Output\
```

## Runtime Data Location

Installed users store data here:

```text
%LOCALAPPDATA%\MotorRepairManager\
```

That folder contains:

```text
database.db
uploads\
backups\
```

This keeps customer data safe when the app is updated.

## Transfer To Another PC

Use one of these:

- Copy `dist\MotorRepairManager.exe` to the other PC.
- Or install `installer\Output\MotorRepairManagerSetup.exe`.

The new PC will show a new PC Device Code and needs a new `platform pc` license. Restore business data using Backup & Restore.

## Clean Data Rule

The packaged EXE does not bundle:

- `database.db`
- `uploads\`
- `backups\`
- `license-secrets\`
- test media or old backup files

Runtime data is created on the user PC here:

```text
%LOCALAPPDATA%\MotorRepairManager\
```

If old/test data appears on your own testing PC, that folder already has a previous runtime database. Preview a safe reset:

```powershell
python tools\dev\reset_pc_runtime_data.py
```

Actually reset packaged runtime data:

```powershell
python tools\dev\reset_pc_runtime_data.py --yes
```

This does not delete the project `database.db`.
