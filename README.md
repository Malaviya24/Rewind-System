# Motor Repair Manager

A local Flask and SQLite web app for managing motor repair jobs, customer details, images, statuses, earnings, and reminders.

## Requirements

- Python 3.10+
- Flask

Install the dependency:

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Open the app on the computer:

```text
http://127.0.0.1:5000
```

Open it from a mobile phone on the same Wi-Fi network:

```text
http://YOUR_COMPUTER_IP:5000
```

On Windows, find the computer IP with:

```powershell
ipconfig
```

The database is stored in `database.db`, and uploaded images are stored in `uploads/`.

## Build Downloadable Windows Software

See:

```text
installer/BUILD_WINDOWS.md
```

Easy build:

```text
build-windows-software.bat
```

The packaged app uses `launcher.py`, opens the browser automatically, and stores real user data in:

```text
%LOCALAPPDATA%\MotorRepairManager\
```
