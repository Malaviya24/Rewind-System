@echo off
setlocal
cd /d "%~dp0"

echo.
echo Rewindin Offline License Generator
echo ----------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not available in PATH.
  echo Install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "license-secrets\license-private.pem" (
  echo ERROR: Private key not found:
  echo   license-secrets\license-private.pem
  echo.
  echo First run:
  echo   node tools\license\generate-keypair.js
  echo.
  echo Keep the private key safe. Do not send it to customers.
  echo.
  pause
  exit /b 1
)

set "DEVICE_CODE="
set "CUSTOMER_NAME="
set "PLATFORM=android"

set /p DEVICE_CODE=Enter device code from app: 
if "%DEVICE_CODE%"=="" (
  echo ERROR: Device code is required.
  echo.
  pause
  exit /b 1
)

set /p CUSTOMER_NAME=Enter shop/customer name: 
if "%CUSTOMER_NAME%"=="" (
  echo ERROR: Shop/customer name is required.
  echo.
  pause
  exit /b 1
)

set /p PLATFORM=Platform android or pc [android]: 
if "%PLATFORM%"=="" set "PLATFORM=android"

echo.
echo Generating %PLATFORM% license...
echo.
node tools\license\generate-license.js --device "%DEVICE_CODE%" --customer "%CUSTOMER_NAME%" --platform "%PLATFORM%"

echo.
echo Copy the full RWND license key above and send it to the customer.
echo.
pause
