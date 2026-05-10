@echo off
setlocal
cd /d "%~dp0"

echo.
echo Motor Repair Manager - Windows Software Build
echo --------------------------------------------
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python is not available in PATH.
  pause
  exit /b 1
)

python tools\build\create_icon.py
if errorlevel 1 (
  echo ERROR: Could not create app icon.
  pause
  exit /b 1
)

echo Checking package safety...
if exist "dist\MotorRepairManager-shareable.zip" del /q "dist\MotorRepairManager-shareable.zip"

python -m PyInstaller --version >nul 2>nul
if errorlevel 1 (
  echo PyInstaller is not installed.
  echo Installing PyInstaller now...
  python -m pip install pyinstaller
  if errorlevel 1 (
    echo ERROR: PyInstaller install failed.
    pause
    exit /b 1
  )
)

echo.
echo Building shareable EXE...
python -m PyInstaller --noconfirm MotorRepairManager.spec
if errorlevel 1 (
  echo ERROR: EXE build failed.
  pause
  exit /b 1
)

echo.
echo Done.
echo Shareable EXE:
echo   dist\MotorRepairManager.exe
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'dist\MotorRepairManager.exe' -DestinationPath 'dist\MotorRepairManager-shareable.zip' -Force"
if not errorlevel 1 (
  echo Shareable ZIP:
  echo   dist\MotorRepairManager-shareable.zip
  echo.
)

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"

if not "%ISCC%"=="" (
  echo Building Windows installer...
  "%ISCC%" installer\MotorRepairManager.iss
  if not errorlevel 1 (
    echo Installer:
    echo   installer\Output\MotorRepairManagerSetup.exe
  )
) else (
  echo Inno Setup not found, installer EXE skipped.
  echo Install Inno Setup 6 later, then compile:
  echo   installer\MotorRepairManager.iss
)

echo.
pause
