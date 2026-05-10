# Motor Repair Manager Feature Roadmap

## Product Direction

Motor Repair Manager should become simple downloadable offline software for small motor repair shops. The shop owner should install it once, open it from a desktop shortcut, and start managing repair jobs without needing internet, paid services, or technical setup.

The first commercial-style version should focus on reliability, easy daily use, customer history, receipts, payments, backups, and a clean local installer.

## Recommended Version 1.0 Features

## Current Implementation Status

- Done: Customer history
- Done: Job number
- Done: Job card / receipt print
- Done: Professional invoice generator with motor job import
- Done: Payment tracking
- Done: Better repair status
- Done: Backup and restore pages
- Done: Shop settings
- Done: Separate Workers payroll module with month-wise attendance calendar and salary reports
- Done: WhatsApp message button
- Done: Delete protection with admin PIN
- Started: Windows installer support with `launcher.py`, PyInstaller guide, and Inno Setup script

### 1. Customer History

Allow the shop owner to search by customer phone number and view all previous repairs from that customer.

Why it matters:
- Helps repeat customers faster.
- Shows past motor problems and costs.
- Makes the shop look more professional.

Suggested fields:
- Customer name
- Phone number
- Total jobs
- Last repair date
- Previous motor types
- Previous costs and status

### 2. Job Number

Every repair entry should get a unique job number.

Example:

```text
MR-2026-0001
MR-2026-0002
MR-2026-0003
```

Why it matters:
- Easy tracking.
- Useful for receipts.
- Customers can reference a job number when calling.

### 3. Job Card / Receipt Print

Add a printable repair receipt or job card for each motor.

Receipt should include:
- Shop name
- Shop phone
- Shop address
- Job number
- Customer name
- Customer phone
- Motor type
- Problem description
- Estimated cost
- Advance paid
- Balance amount
- Deadline date
- Status
- Date added

Why it matters:
- Customers get proof of repair submission.
- Shop owner can keep printed records.
- Makes the app feel like real business software.

### 4. Payment Tracking

Improve the current cost field into proper payment tracking.

Fields to add:
- Estimated cost
- Final cost
- Advance paid
- Balance amount
- Payment status

Payment statuses:
- Unpaid
- Partial
- Paid

Why it matters:
- Shop owner can track pending money.
- Reduces confusion during delivery.
- Better earnings reports.

### 5. Better Repair Status

Replace the simple Pending / Completed system with detailed repair stages.

Recommended statuses:
- Received
- Checking
- In Repair
- Waiting for Parts
- Completed
- Delivered

Why it matters:
- Shows the real repair workflow.
- Helps workers know what stage each motor is in.
- Prevents completed motors from being confused with delivered motors.

### 6. Backup and Restore

Add one-click backup and restore for offline safety.

Backup should include:
- `database.db`
- `uploads/` folder
- Shop settings

Suggested backup format:

```text
motor-repair-backup-YYYY-MM-DD.zip
```

Why it matters:
- Offline software must protect data.
- Helps when changing computers.
- Reduces risk from computer crash or accidental deletion.

### 7. Shop Settings

Add a settings page where the owner can configure shop details.

Fields:
- Shop name
- Owner name
- Phone number
- Address
- Logo image
- Default receipt note

Why it matters:
- Printed receipts become personalized.
- Same software can be used by many different shops.
- Makes the app ready to distribute.

### 8. Dashboard Summaries

Add useful dashboard summaries for the shop owner.

Summaries:
- Today earnings
- Weekly earnings
- Monthly earnings
- Pending balance
- Pending repairs
- Completed repairs
- Delivered motors
- Overdue repairs

Filters:
- Date range
- Status
- Payment status

Why it matters:
- Owner can understand daily business.
- Helps track unpaid work.
- Keeps key data visible without a separate reports page.

### 9. WhatsApp Message Button

Add a WhatsApp button for each repair entry. This should not use a paid API. It should open WhatsApp with a pre-filled message.

Example messages:

```text
Hello, your motor repair is completed. Please collect it from our shop.
```

```text
Hello, your motor repair is overdue. Please contact us for an update.
```

Why it matters:
- Shop owners already use WhatsApp.
- Fast customer communication.
- No paid service required.

### 10. Delete Protection

Add stronger protection before deleting important records.

Options:
- Admin PIN before delete
- Soft delete / archive instead of permanent delete
- Restore deleted entry option

Why it matters:
- Prevents accidental data loss.
- Protects records from staff mistakes.
- Important for real shop usage.

### 11. Windows Installer

Package the app as downloadable Windows software.

Installer should:
- Install the app
- Create desktop shortcut
- Start the local Flask server
- Open browser automatically
- Store data in Windows AppData
- Keep uploads and database safe between app updates

Recommended tools:
- PyInstaller for packaging Python
- Inno Setup for creating installer

Why it matters:
- Users can install like normal software.
- No command line needed.
- Ready to share with shop owners.

## Future Version Ideas

### Multi-Device Shop Mode

Install on one main computer and let phones or other computers connect on the same Wi-Fi.

Example:

```text
http://SHOP-PC-IP:5000
```

### Staff Login

Add simple users:
- Owner
- Worker

Owner can delete, restore, export, and change settings. Worker can add and update repairs.

### Barcode or QR Code

Print a QR code on receipts so the shop can quickly open the repair entry.

### Parts Inventory

Track common parts:
- Bearings
- Capacitors
- Coils
- Wires
- Switches

### SMS Support

Optional future feature if the owner wants paid SMS integration.

## Recommended Build Order

1. Job number
2. Payment tracking
3. Better repair statuses
4. Customer history
5. Receipt print
6. Shop settings
7. Backup and restore
8. Dashboard summaries
9. WhatsApp message button
10. Delete protection
11. Windows installer

## Version 1.0 Goal

Version 1.0 should feel like real offline shop software:

- Easy to install
- Easy to open
- Works without internet
- Stores all data locally
- Looks clean and professional
- Prints receipts
- Tracks payments
- Protects data with backup
- Helps owner manage daily repair work quickly
