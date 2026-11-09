const CLIENT_ID = '41933695492-ptmitgsik78675041cq13ohp45itoemo.apps.googleusercontent.com';
const SPREADSHEET_ID = '1qmCTZ_-1EoutNWMMJQY3nN0jFMIwOeKyfjolAx27MPw';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let accessToken = null;
let tokenClient = null;

function loadIdentityScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export function prepareGoogleAuth() {
  return loadIdentityScript().then(() => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: response => {
          if (response.error) {
            pendingReject?.(new Error(response.error_description || response.error));
            return;
          }
          accessToken = response.access_token;
          pendingResolve?.();
        },
        error_callback: error => {
          const message = error.type === 'popup_failed_to_open'
            ? 'This browser blocked the Google sign-in window. On mobile, allow pop-ups for this site or connect Google Sheets once from a desktop browser, then retry on mobile.'
            : error.type === 'popup_closed'
              ? 'Google sign-in was closed before authorization finished. Please try again.'
              : 'Google authorization failed' + (error.type ? ': ' + error.type : '.') ;
          pendingReject?.(new Error(message));
        }
      });
    }
  });
}

let pendingResolve = null;
let pendingReject = null;

export function authorizeGoogle() {
  if (!tokenClient) {
    return Promise.reject(new Error('Google sign-in is still loading. Please wait a moment and try again.'));
  }
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    // Must run synchronously inside the button click to preserve browser user activation.
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function api(path, options = {}) {
  if (!accessToken) throw new Error('Connect your Google account first.');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) accessToken = null;
    throw new Error(body.error?.message || `Google Sheets request failed (${response.status}).`);
  }
  return body;
}

async function getValues(range) {
  const result = await api(`/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
  return result.values || [];
}

async function putValues(range, values) {
  return api(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ range, majorDimension: 'ROWS', values })
  });
}

const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateString = value => {
  if (!value) return '';
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

export async function loadSpreadsheetData() {
  await putValues("'Earnings Reports'!E4", [['Payment Received Date']]);
  await putValues("'Earnings Reports'!L4:M4", [['Payment Status', 'Amount Received']]);
  const [earningRows, payoutRows, settingRows] = await Promise.all([
    getValues("'Earnings Reports'!A5:M"),
    getValues("'Payout History'!A5:G"),
    getValues("'Settings'!A1:C100")
  ]);

  const earnings = [];
  const earningIds = [];
  earningRows.forEach((row, index) => {
    if (!row[0]) return;
    const id = String(row[10] || makeId());
    earningIds.push({ row: index + 5, id, needsId: !row[10] });
    earnings.push({
      id, platform: String(row[0] || ''), reportType: String(row[1] || ''),
      periodStart: dateString(row[2]), periodEnd: dateString(row[3]),
      paymentReceivedDate: dateString(row[4]), gross: Number(row[5]) || 0,
      tax: Number(row[6]) || 0, adjustments: Number(row[7]) || 0,
      net: Number(row[8]) || 0, notes: String(row[9] || ''), paymentStatus: String(row[11] || (row[4] ? 'Paid' : 'Pending')),
      paidAmount: row[12] !== undefined && row[12] !== '' ? Math.max(0, Number(row[12]) || 0) : ((row[11] === 'Paid' || (!row[11] && row[4])) ? Number(row[8]) || 0 : 0)
    });
  });

  const payouts = [];
  const payoutIds = [];
  payoutRows.forEach((row, index) => {
    if (!row[0]) return;
    const id = String(row[6] || makeId());
    payoutIds.push({ row: index + 5, id, needsId: !row[6] });
    payouts.push({
      id, platform: String(row[0] || ''), payoutDate: dateString(row[1]),
      amount: Number(row[2]) || 0, reference: String(row[3] || ''),
      relatedPeriod: String(row[4] || ''), notes: String(row[5] || '')
    });
  });

  // Backfill stable IDs only in the dedicated hidden ID columns.
  const missingEarningIds = earningIds.filter(x => x.needsId);
  const missingPayoutIds = payoutIds.filter(x => x.needsId);
  for (const item of missingEarningIds) {
    await putValues(`'Earnings Reports'!K${item.row}`, [[item.id]]);
  }
  for (const item of missingPayoutIds) {
    await putValues(`'Payout History'!G${item.row}`, [[item.id]]);
  }

  let target = 10000;
  const targetRow = settingRows.find(row => String(row[0] || '').trim() === 'Monthly income target');
  if (targetRow) target = Number(targetRow[1]) || 10000;

  return { earnings, payouts, target };
}

export async function saveSpreadsheetData(data) {
  // Always re-read the spreadsheet immediately before writing. Cloud-only rows
  // are retained; matching IDs with different values are treated as conflicts.
  const cloud = await loadSpreadsheetData();
  const fields = [
    'platform', 'reportType', 'periodStart', 'periodEnd',
    'paymentReceivedDate', 'gross', 'tax', 'adjustments', 'net',
    'notes', 'paymentStatus', 'paidAmount'
  ];
  const payoutFields = [
    'platform', 'payoutDate', 'amount', 'reference', 'relatedPeriod', 'notes'
  ];
  const mergeRecords = (cloudRows, localRows) => {
    // Deterministic merge: retain every cloud-only row, add local-only rows,
    // and let the active browser's version win for matching IDs. This avoids
    // blocking the user with sync conflicts while retaining a pre-write backup.
    const merged = new Map(cloudRows.map(row => [String(row.id), row]));
    for (const row of localRows) merged.set(String(row.id), row);
    return [...merged.values()];
  };

  const mergedEarnings = mergeRecords(cloud.earnings, data.earnings);
  const mergedPayouts = mergeRecords(cloud.payouts, data.payouts);
  // Save a recovery point containing both sides before writing to Sheets.
  try {
    localStorage.setItem(
      'side-hustle-income-tracker-pre-sync-' + Date.now(),
      JSON.stringify({ savedAt: new Date().toISOString(), local: data, cloud })
    );
  } catch (error) {
    throw new Error('Could not create a pre-sync backup; sync was cancelled. ' + error.message);
  }

  const earningRows = mergedEarnings.map(x => [
    x.platform, x.reportType, x.periodStart, x.periodEnd,
    x.paymentReceivedDate || '', Number(x.gross) || 0, Number(x.tax) || 0,
    Number(x.adjustments) || 0, Number(x.net) || 0, x.notes || '', x.id,
    x.paymentStatus || (x.paymentReceivedDate ? 'Paid' : 'Pending'), Number(x.paidAmount) || 0
  ]);
  const payoutRows = mergedPayouts.map(x => [
    x.platform, x.payoutDate, Number(x.amount) || 0, x.reference || '',
    x.relatedPeriod || '', x.notes || '', x.id
  ]);

  const updates = [];
  if (earningRows.length) updates.push({ range: "'Earnings Reports'!A5:M", majorDimension: 'ROWS', values: earningRows });
  if (payoutRows.length) updates.push({ range: "'Payout History'!A5:G", majorDimension: 'ROWS', values: payoutRows });
  if (updates.length) {
    await api('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates })
    });
  }

  // Clear only trailing rows after the merged dataset, never rows that were
  // absent locally but still present in the spreadsheet.
  const existingEarnings = await getValues("'Earnings Reports'!A5:M");
  const existingPayouts = await getValues("'Payout History'!A5:G");
  const earningCount = existingEarnings.filter(row => row.some(value => value !== '' && value !== null && value !== undefined)).length;
  const payoutCount = existingPayouts.filter(row => row.some(value => value !== '' && value !== null && value !== undefined)).length;
  const clears = [];
  if (earningCount > earningRows.length) clears.push("'Earnings Reports'!A" + (5 + earningRows.length) + ":M" + (4 + earningCount));
  if (payoutCount > payoutRows.length) clears.push("'Payout History'!A" + (5 + payoutRows.length) + ":G" + (4 + payoutCount));
  if (clears.length) {
    await api('/values:batchClear', { method: 'POST', body: JSON.stringify({ ranges: clears }) });
  }

  const settings = await getValues("'Settings'!A1:B100");
  const targetIndex = settings.findIndex(row => String(row[0] || '').trim() === 'Monthly income target');
  if (targetIndex >= 0 && Number(data.target) !== Number(cloud.target)) {
    await putValues(`'Settings'!B${targetIndex + 1}`, [[Number(data.target) || 10000]]);
  }
  return {
    earnings: mergedEarnings,
    payouts: mergedPayouts,
    target: Number(data.target) || Number(cloud.target) || 10000
  };
}
