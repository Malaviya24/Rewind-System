# PC Production Guide

This file covers the production PC software flow for offline activation, backups, date filters, and release checks.

## Run The PC Software

```powershell
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

## First Launch Activation

The PC software opens the Activation screen before Dashboard if no valid license exists.

1. Copy the `PC DEVICE CODE`.
2. Generate a PC license on the developer machine:

```powershell
node tools\license\generate-license.js --device RWND-PC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --customer "ABC Motor Shop" --platform pc
```

3. Paste the full `RWND...` license into the PC software.
4. Click Activate.

The PC software verifies the license fully offline using the public key inside `app.py`.

## Important License Rules

- Private key stays in `license-secrets/license-private.pem`.
- Private key is never copied into the Android app or PC software.
- PC software only contains the public key.
- Android licenses use `platform: android`.
- PC licenses use `platform: pc`.
- Android license will not unlock PC software.
- Old PC license will not unlock another PC because device code will not match.

## Backup / Import Behavior

PC backups include:

- database records
- motors
- invoices
- customers derived from motors
- workers
- attendance
- salary payments imported from Android backups
- shop details
- related uploads/media
- `backup_manifest.json`

PC backups do not include license metadata. This is intentional.

If a backup is restored on another PC, business data can restore, but that PC still needs its own license.

## Date Range Backup

On Settings > Backup & Restore:

- Leave dates empty to export all data.
- Select Start Date and End Date to export a date range.
- End Date cannot be before Start Date.
- Motor records are filtered by `date_added`.
- Worker attendance and salary payment records are filtered by their date fields.

## Date Filters

Dashboard and Motor page support:

- All
- Today
- Single Date
- Month
- Range

All date inputs use native calendar/month pickers. Invalid dates and invalid ranges are blocked or corrected.

## Production Checklist

- Start app with no license and confirm Activation screen appears.
- Generate `platform pc` license and activate.
- Try an Android license and confirm it is rejected.
- Confirm Dashboard opens after activation.
- Restart app and confirm license remains active.
- Check Settings > License.
- Add motor with 10-digit mobile number.
- Add media and open preview.
- Test Dashboard date/month/range filters.
- Test Motor date/month/range filters.
- Export backup with date range.
- Restore backup and confirm license is still required on another PC.
