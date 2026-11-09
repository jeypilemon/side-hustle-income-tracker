# Side Hustle Income Tracker

A local-first React app for tracking creator and affiliate earnings and actual payouts.

## Features
- Track YouTube, TikTok Affiliate, Shopee Affiliate, Lazada Affiliate, and other income streams.
- Add weekly, monthly, or custom earnings reports with explicit period start/end dates.
- Late-entered reports are attributed to the report period end date, not the date entered.
- Record payouts separately from commissions earned to avoid double-counting.
- Monthly and annual totals, platform breakdowns, and a six-month chart.
- Edit and delete earnings and payout records.
- Export CSV and download/restore JSON backups.
- PHP currency and configurable monthly goal (default ₱10,000).

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Data storage
The app currently uses browser localStorage. Data stays in the current browser/device. Export JSON backups regularly; clearing browser storage can erase records. Google Sheets sync and cross-device synchronization are not enabled in this version.

## Reporting rules
- Earnings are grouped by the calendar month containing the report's **Period End** date.
- Payouts are grouped by the actual **Payout Date**.
- Earnings and payouts are separate measures; do not add them together as total income.
