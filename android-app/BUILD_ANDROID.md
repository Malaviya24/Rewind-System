# Android Test And APK Build

## Current Test Method: Expo Go

The app is running locally with Expo Metro on:

```text
exp://10.235.19.221:8081
```

To test on phone:

1. Connect the phone and PC to the same Wi-Fi/network.
2. Install **Expo Go** from Play Store.
3. Open Expo Go and enter:

```text
exp://10.235.19.221:8081
```

If that IP does not work, run `ipconfig` on the PC and use the active Wi-Fi IPv4 address:

```text
exp://YOUR-PC-IP:8081
```

## Local APK Build Requirement

This project now has a local Android toolchain in `.android-build-tools`, but
normal PowerShell sessions still do not expose it on `PATH`:

- `java` is not found unless `JAVA_HOME` is set
- `adb` is not found unless the local Android SDK platform-tools folder is on `PATH`
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` are not set globally

Set the local toolchain for the current PowerShell session before building:

```powershell
cd android-app
$env:JAVA_HOME = "$PWD\.android-build-tools\jdk-17.0.19+10"
$env:ANDROID_HOME = "$PWD\.android-build-tools\android-sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
```

Then build:

```powershell
npx.cmd expo prebuild --platform android
cd android
.\gradlew.bat assembleDebug
```

APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

For sharing to a phone without keeping the Expo server open, build a release APK:

```powershell
cd android
.\gradlew.bat assembleRelease
```

Release APK output:

```text
android/app/build/outputs/apk/release/app-release.apk
```

## Validation Commands

```powershell
cd android-app
npm.cmd install
npm.cmd run typecheck
npx.cmd expo export --platform android --output-dir dist
npm.cmd run start -- --lan
```
