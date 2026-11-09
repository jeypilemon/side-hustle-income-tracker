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

export async function authorizeGoogle() {
  await loadIdentityScript();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: response => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        accessToken = response.access_token;
        resolve();
      },
      error_callback: error => reject(new Error(error.message || 'Google authorization failed.'))
    });
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
  await putValues(\"'Earnings Reports'!L4\", [['Payment Status']]);
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
      net: Number(row[8]) || 0, notes: String(row[9] || ''), paymentStatus: String(row[11] || (row[4] ? 'Paid' : 'Pending')), paidAmount: Number(row[12]) || ((row[11] === 'Paid' || (!row[11] && row[4])) ? Number(row[8]) || 0 : 0)
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
  const earningRows = data.earnings.map(x => [
    x.platform, x.reportType, x.periodStart, x.periodEnd,
    x.paymentReceivedDate || '', Number(x.gross) || 0, Number(x.tax) || 0,
    Number(x.adjustments) || 0, Number(x.net) || 0, x.notes || '', x.id || makeId(), x.paymentStatus || (x.paymentReceivedDate ? 'Paid' : 'Pending'), Number(x.paidAmount) || 0
  ]);
  const payoutRows = data.payouts.map(x => [
    x.platform, x.payoutDate, Number(x.amount) || 0, x.reference || '',
    x.relatedPeriod || '', x.notes || '', x.id || makeId()
  ]);

  // These are dedicated data-table areas. Headers, formatting, filters and other tabs are untouched.
  await api('/values:batchClear', {
    method: 'POST',
    body: JSON.stringify({ ranges: ["'Earnings Reports'!A5:M", "'Payout History'!A5:G"] })
  });

  const updates = [];
  if (earningRows.length) updates.push({ range: "'Earnings Reports'!A5:M", majorDimension: 'ROWS', values: earningRows });
  if (payoutRows.length) updates.push({ range: "'Payout History'!A5:G", majorDimension: 'ROWS', values: payoutRows });

  if (updates.length) {
    await api('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates })
    });
  }

  const settings = await getValues("'Settings'!A1:B100");
  const targetIndex = settings.findIndex(row => String(row[0] || '').trim() === 'Monthly income target');
  if (targetIndex >= 0) {
    await putValues(`'Settings'!B${targetIndex + 1}`, [[Number(data.target) || 10000]]);
  }
  return true;
}
