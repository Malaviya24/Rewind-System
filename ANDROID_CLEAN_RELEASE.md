# Android Clean Release

The production APK must not create demo/test data on a new phone.

## What Was Fixed

The old Android app boot flow called `seedIfEmpty()` during database startup. That inserted demo motors/customers/workers such as:

- Dhruv Patel
- Aarav Shah
- Meera Repairs
- Jack

That seed path has been removed for production.

## New Phone Behavior

On a new phone or clean install:

1. App opens Activation screen.
2. After valid license activation, Dashboard is empty.
3. No motors, customers, workers, attendance, payments, or media appear unless the admin imports a backup or adds records.

## Important For Phones Already Tested

If a phone already installed the old APK, Android keeps its local SQLite database after normal update.

To test clean behavior on that phone:

```text
Settings > Apps > Motor Repair Manager > Storage > Clear data
```

or uninstall the app, then install the new APK again.

This only affects that phone's local app data. It does not change the APK.

## Production Rule

Do not add demo seed data to the production boot flow. Test/demo data should only be added manually during QA or by importing a test backup.
