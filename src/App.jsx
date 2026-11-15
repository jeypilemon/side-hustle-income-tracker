import React, { useEffect, useMemo, useRef, useState } from 'react';
import { authorizeGoogle, prepareGoogleAuth, loadSpreadsheetData, saveSpreadsheetData } from './googleSheets';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const PLATFORMS = ['YouTube', 'TikTok Affiliate', 'Shopee Affiliate', 'Lazada Affiliate', 'Other'];
const STORE_KEY = 'side-hustle-income-tracker-v1';
const DELETED_KEY = STORE_KEY + '-pending-deletions';
const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(n || 0));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const monthKey = d => (d || '').slice(0, 7);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { earnings: Array.isArray(saved.earnings) ? saved.earnings : [], payouts: Array.isArray(saved.payouts) ? saved.payouts : [], repairs: Array.isArray(saved.repairs) ? saved.repairs : [], tasks: Array.isArray(saved.tasks) ? saved.tasks : [], target: Number(saved.target) || 10000 };
  } catch { return { earnings: [], payouts: [], repairs: [], tasks: [], target: 10000 }; }
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function App() {
  const [data, setData] = useState(loadData);
  const [deletedIds, setDeletedIds] = useState(() => { try { return JSON.parse(localStorage.getItem(DELETED_KEY) || '{\"earnings\":[],\"payouts\":[]}'); } catch { return { earnings: [], payouts: [] }; } });
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState('month');
  const [earningSort, setEarningSort] = useState({ key: 'periodEnd', direction: 'desc' });
  const [payoutSort, setPayoutSort] = useState({ key: 'date', direction: 'desc' });
  const [repairSearch, setRepairSearch] = useState('');
  const [repairSort, setRepairSort] = useState({ key: 'serviceDate', direction: 'desc' });
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [selectedRepair, setSelectedRepair] = useState(null);
  const [privacyMode, setPrivacyMode] = useState(() => localStorage.getItem('sidetracked-privacy-mode') === 'true');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('sidetracked-dark-mode') === 'true');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [cloudConnected, setCloudConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const lastSyncedSignature = useRef(null);
  const syncInFlight = useRef(false);
  const [earnForm, setEarnForm] = useState({ platform: 'Shopee Affiliate', reportType: 'Weekly', periodStart: today(), periodEnd: today(), paymentReceivedDate: '', paymentStatus: 'Pending', paidAmount: '0', gross: '', tax: '0', adjustments: '0', notes: '' });
  const [payForm, setPayForm] = useState({ platform: 'YouTube', payoutDate: today(), amount: '', reference: '', relatedPeriod: '', notes: '' });
  const [repairForm, setRepairForm] = useState({ serviceDate: today(), serviceType: 'Phone repair', device: '', customer: '', customerPhone: '', customerEmail: '', customerAddress: '', serviceRendered: '', repairStatus: 'In progress', labor: '', partsCost: '0', otherCosts: '0', amountCharged: '', paymentStatus: 'Paid', paymentReceivedDate: today(), notes: '' });

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }, [data]);
  useEffect(() => { localStorage.setItem(DELETED_KEY, JSON.stringify(deletedIds)); }, [deletedIds]);
  useEffect(() => { localStorage.setItem('sidetracked-privacy-mode', String(privacyMode)); }, [privacyMode]);
  useEffect(() => { localStorage.setItem('sidetracked-dark-mode', String(darkMode)); document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'; }, [darkMode]);
  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 30000); return () => clearInterval(timer); }, []);

  useEffect(() => { prepareGoogleAuth().catch(error => setNotice('Google sign-in could not initialize: ' + error.message)); }, []);

  useEffect(() => {
    if (!cloudConnected) return;
    const signature = JSON.stringify({ data, deletedIds });
    if (signature === lastSyncedSignature.current) return;
    const timer = setTimeout(async () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      setSyncing(true);
      setSyncError(false);
      try {
        const syncedData = { ...(await saveSpreadsheetData(data, deletedIds)), tasks: data.tasks || [] };
        const hasPendingDeletions = (deletedIds.earnings || []).length > 0 || (deletedIds.payouts || []).length > 0;
        const emptyDeletions = { earnings: [], payouts: [] };
        lastSyncedSignature.current = JSON.stringify({ data: syncedData, deletedIds: emptyDeletions });
        if (JSON.stringify(syncedData) !== JSON.stringify(data)) setData(syncedData);
        if (hasPendingDeletions) setDeletedIds(emptyDeletions);
        setNotice('Google Sheets synced. Changes and deletions were applied safely.');
      } catch (error) {
        setSyncError(true);
        setNotice('Sync failed: ' + error.message + ' Your changes remain saved locally. Retry when Google Sheets is available.');
        setCloudConnected(false);
      } finally {
        syncInFlight.current = false;
        setSyncing(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [data, cloudConnected, deletedIds]);

  async function connectGoogleSheets() {
    setConnecting(true);
    try {
      await authorizeGoogle();
      const cloudData = await loadSpreadsheetData();

      // Preserve both sides on connection. The previous implementation replaced
      // the entire browser dataset whenever *any* cloud records existed, which
      // could silently discard offline/platform-specific records.
      const snapshot = {
        savedAt: new Date().toISOString(),
        local: data,
        cloud: cloudData
      };
      try {
        localStorage.setItem(STORE_KEY + '-pre-sync-' + Date.now(), JSON.stringify(snapshot));
      } catch (backupError) {
        throw new Error('Could not create a pre-sync recovery snapshot. No data was synchronized. ' + backupError.message);
      }

      const mergeById = (cloudRows, localRows) => {
        const merged = new Map();
        [...cloudRows, ...localRows].forEach((row, index) => {
          const key = row.id ? String(row.id) : [
            row.platform, row.periodStart || row.payoutDate || '',
            row.periodEnd || '', row.gross ?? row.amount ?? '', row.net ?? ''
          ].join('|');
          // Local copy wins for a matching ID; records found only in either
          // location are retained. This avoids dropping offline additions.
          merged.set(key || 'record-' + index, row);
        });
        return [...merged.values()];
      };
      const deletedEarnings = new Set(deletedIds.earnings || []);
      const deletedPayouts = new Set(deletedIds.payouts || []);
      const deletedRepairs = new Set(deletedIds.repairs || []);
      const mergedData = {
        earnings: mergeById(cloudData.earnings.filter(x => !deletedEarnings.has(String(x.id))), data.earnings),
        payouts: mergeById(cloudData.payouts.filter(x => !deletedPayouts.has(String(x.id))), data.payouts),
        repairs: mergeById((cloudData.repairs || []).filter(x => !deletedRepairs.has(String(x.id))), data.repairs || []),
        tasks: data.tasks || [],
        target: Number(data.target) || Number(cloudData.target) || 10000
      };

      setData(mergedData);
      lastSyncedSignature.current = null;
      setSyncError(false);
      setCloudConnected(true);
      setNotice(
        'Connected safely. Local and Google Sheets records were merged (' +
        mergedData.earnings.length + ' earnings, ' + mergedData.payouts.length +
        ' payouts). A pre-sync recovery snapshot was saved in this browser.'
      );
    } catch (error) {
      setSyncError(true);
      setNotice('Google connection failed: ' + error.message);
    } finally {
      setConnecting(false);
    }
  }
  const year = Number(selectedMonth.slice(0, 4));
  const monthEarnings = data.earnings.filter(x => monthKey(x.periodEnd) === selectedMonth);
  const monthTotal = monthEarnings.reduce((s, x) => s + Number(x.net || 0), 0);
  const monthPending = monthEarnings.reduce((s, x) => s + Math.max(0, Number(x.net || 0) - Number(x.paidAmount ?? ((x.paymentStatus === 'Paid' || (!x.paymentStatus && x.paymentReceivedDate)) ? x.net : 0))), 0);
  const monthPartialCount = monthEarnings.filter(x => x.paymentStatus === 'Partially Paid').length;
  const prevDate = new Date(Number(selectedMonth.slice(0,4)), Number(selectedMonth.slice(5,7))-2, 1);
  const previousMonthKey = prevDate.getFullYear() + '-' + String(prevDate.getMonth()+1).padStart(2,'0');
  const previousMonthTotal = data.earnings.filter(x => monthKey(x.periodEnd) === previousMonthKey).reduce((s,x)=>s+Number(x.net||0),0);
  const monthGrowth = previousMonthTotal ? ((monthTotal-previousMonthTotal)/previousMonthTotal)*100 : null;
  const trailingMonths = Array.from({length:12},(_,i)=>{const d=new Date(Number(selectedMonth.slice(0,4)),Number(selectedMonth.slice(5,7))-1-i,1);const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');return data.earnings.filter(x=>monthKey(x.periodEnd)===k).reduce((s,x)=>s+Number(x.net||0),0);});
  const averageMonthly = trailingMonths.reduce((s,v)=>s+v,0)/12;
  const latestPayouts = [...data.payouts].sort((a,b) => (b.payoutDate || '').localeCompare(a.payoutDate || '')).slice(0,5);
  const monthPayouts = data.payouts.filter(x => monthKey(x.payoutDate) === selectedMonth).reduce((s, x) => s + Number(x.amount || 0), 0);
  const yearTotal = data.earnings.filter(x => Number((x.periodEnd || '').slice(0, 4)) === year).reduce((s, x) => s + Number(x.net || 0), 0);
  const yearPayouts = data.payouts.filter(x => Number((x.payoutDate || '').slice(0, 4)) === year).reduce((s, x) => s + Number(x.amount || 0), 0);
  const lifetimeCommissionIncome = data.earnings.reduce((sum, x) => sum + Number(x.net || 0), 0);
  const lifetimeRepairProfit = (data.repairs || []).reduce((sum, x) => sum + Number(x.netProfit ?? (Number(x.amountCharged || 0) - Number(x.partsCost || 0) - Number(x.otherCosts || 0))), 0);
  const overallNetIncome = lifetimeCommissionIncome + lifetimeRepairProfit;
  const pendingRepairs = (data.repairs || []).filter(x => ['pending','in progress'].includes(String(x.repairStatus || '').toLowerCase())).sort((a,b)=>(a.serviceDate||'').localeCompare(b.serviceDate||'')).slice(0,6);
  const displayMoney = value => privacyMode ? '₱ ••••••' : new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP', maximumFractionDigits:2 }).format(Number(value || 0));
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a,b)=>a-b);
    const mid = Math.floor(sorted.length/2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2);
  };
  const receivedAmount = report => {
    if (report.paidAmount !== undefined && report.paidAmount !== null && report.paidAmount !== '') return Math.max(0, Number(report.paidAmount) || 0);
    return report.paymentStatus === 'Paid' || (!report.paymentStatus && report.paymentReceivedDate) ? Number(report.net) || 0 : 0;
  };
  const paymentState = report => {
    const received = receivedAmount(report);
    const net = Math.max(0, Number(report.net) || 0);
    if (net > 0 && received >= net) return 'Paid';
    if (received > 0) return 'Partially Paid';
    return 'Pending';
  };
  const paymentLagStats = platform => {
    const paidReports = data.earnings.filter(x => x.platform === platform && x.paymentReceivedDate && x.periodEnd && receivedAmount(x) > 0);
    const lags = paidReports.map(x => Math.round((new Date(x.paymentReceivedDate+'T12:00:00') - new Date(x.periodEnd+'T12:00:00')) / 86400000))
      .filter(days => Number.isFinite(days) && days >= 0 && days <= 120);
    return { median: median(lags), count: lags.length };
  };
  const predictedPaymentDate = report => {
    if (report.paymentReceivedDate) return null;
    const stats = paymentLagStats(report.platform);
    if (stats.median === null || stats.count < 2 || !report.periodEnd) return null;
    const date = new Date(report.periodEnd+'T12:00:00');
    date.setDate(date.getDate()+stats.median);
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  };
  const predictionLabel = report => {
    const predicted = predictedPaymentDate(report);
    if (!predicted) return report.paymentReceivedDate && receivedAmount(report) === 0 ? 'Review payment' : '—';
    const days = Math.round((new Date(predicted+'T12:00:00') - new Date(today()+'T12:00:00')) / 86400000);
    if (days < 0) return predicted + ' · Overdue';
    if (days <= 7) return predicted + ' · Due soon';
    return predicted + ' · Estimated';
  };
  const platformTotals = PLATFORMS.map(platform => { const earned = monthEarnings.filter(x => x.platform === platform).reduce((s, x) => s + Number(x.net || 0), 0); return { platform, earned, share: monthTotal > 0 ? earned / monthTotal * 100 : 0 }; });
  const chartData = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, new Date(selectedMonth + '-01T00:00:00').getMonth() - 11 + i, 1);
    const key = d.toISOString().slice(0, 7);
    const row = { month: d.toLocaleString('en', { month: 'short' }) };
    PLATFORMS.slice(0, 4).forEach(p => row[p] = data.earnings.filter(x => x.platform === p && monthKey(x.periodEnd) === key).reduce((s, x) => s + Number(x.net || 0), 0));
    const monthRepairs = (data.repairs || []).filter(x => monthKey(x.serviceDate) === key);
    row['Repair net profit'] = monthRepairs.reduce((sum, x) => sum + Number(x.netProfit ?? (Number(x.amountCharged || 0) - Number(x.partsCost || 0) - Number(x.otherCosts || 0))), 0);
    row['Repairs done'] = monthRepairs.length;
    return row;
  });
  const filteredEarnings = useMemo(() => {
    if (period === 'all') return data.earnings;
    if (period === 'month') return data.earnings.filter(x => monthKey(x.periodEnd) === selectedMonth);
    if (period === 'year') return data.earnings.filter(x => (x.periodEnd || '').startsWith(String(year)));
    return data.earnings;
  }, [data.earnings, period, selectedMonth, year]);
  const sortedEarnings = useMemo(() => [...filteredEarnings].sort((a,b) => {
    const av = a[earningSort.key] ?? '', bv = b[earningSort.key] ?? '';
    const result = typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv), undefined, {numeric:true});
    return earningSort.direction === 'asc' ? result : -result;
  }), [filteredEarnings, earningSort]);
  const payoutHistoryRows = useMemo(() => {
    const actual = data.payouts.map(x => ({ id:x.id, source:'Bank payout', platform:x.platform, date:x.payoutDate, amount:Number(x.amount)||0, reference:x.reference||'', relatedPeriod:x.relatedPeriod||'', actual:true }));
    const paidReports = data.earnings.filter(x => receivedAmount(x) > 0 && x.paymentReceivedDate).map(x => ({
      id:'earning-'+x.id, source:'Paid report', platform:x.platform, date:x.paymentReceivedDate,
      amount:receivedAmount(x), reference:'Linked from Earnings', relatedPeriod:(x.periodStart||'')+' to '+(x.periodEnd||''), actual:false
    }));
    return [...actual, ...paidReports].sort((a,b) => {
      const av = payoutSort.key === 'amount' ? a.amount : a[payoutSort.key] || '';
      const bv = payoutSort.key === 'amount' ? b.amount : b[payoutSort.key] || '';
      const result = typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv), undefined, {numeric:true});
      return payoutSort.direction === 'asc' ? result : -result;
    });
  }, [data.payouts, data.earnings, payoutSort]);

  function saveEarning(e) {
    e.preventDefault();
    const gross = Number(earnForm.gross), tax = Number(earnForm.tax || 0), adjustments = Number(earnForm.adjustments || 0);
    if (!earnForm.periodStart || !earnForm.periodEnd || earnForm.periodEnd < earnForm.periodStart || !Number.isFinite(gross)) { setNotice('Check the reporting dates and gross amount.'); return; }
    const record = { ...earnForm, paymentStatus: Number(earnForm.paidAmount || 0) >= gross - tax + adjustments ? 'Paid' : Number(earnForm.paidAmount || 0) > 0 ? 'Partially Paid' : (earnForm.paymentStatus || 'Pending'), paidAmount: Math.max(0, Math.min(Number(earnForm.paidAmount || 0), gross - tax + adjustments)), gross, tax, adjustments, net: gross - tax + adjustments, id: editing?.type === 'earning' ? editing.id : uid() };
    setData(d => ({ ...d, earnings: editing?.type === 'earning' ? d.earnings.map(x => x.id === editing.id ? record : x) : [record, ...d.earnings] }));
    setEditing(null); setEarnForm({ platform:'Shopee Affiliate', reportType:'Weekly', periodStart:today(), periodEnd:today(), paymentReceivedDate:'', paymentStatus:'Pending', paidAmount:'0', gross:'', tax:'0', adjustments:'0', notes:'' }); setNotice('Earnings report saved.');
  }
  function saveRepair(e) {
    e.preventDefault();
    const labor = Number(repairForm.labor || 0), partsCost = Number(repairForm.partsCost || 0), otherCosts = Number(repairForm.otherCosts || 0), amountCharged = Number(repairForm.amountCharged || 0);
    if (!repairForm.serviceDate || !repairForm.device.trim() || !(amountCharged > 0) || [labor, partsCost, otherCosts, amountCharged].some(v => !Number.isFinite(v) || v < 0)) { setNotice('Enter a service date, device, valid charge, and non-negative costs.'); return; }
    const repairId = editing?.type === 'repair' ? editing.id : uid();
    const record = { ...repairForm, customer: repairForm.customer.trim(), customerPhone: repairForm.customerPhone.trim(), customerEmail: repairForm.customerEmail.trim(), customerAddress: repairForm.customerAddress.trim(), serviceRendered: repairForm.serviceRendered.trim(), repairStatus: repairForm.repairStatus || 'In progress', labor, partsCost, otherCosts, amountCharged, netProfit: amountCharged - partsCost - otherCosts, receiptNumber: editing?.type === 'repair' ? (data.repairs || []).find(x=>x.id===editing.id)?.receiptNumber || ('SR-' + repairId.slice(-8).toUpperCase()) : ('SR-' + repairId.slice(-8).toUpperCase()), id: repairId };
    setData(d => ({ ...d, repairs: editing?.type === 'repair' ? (d.repairs || []).map(x => x.id === editing.id ? record : x) : [record, ...(d.repairs || [])] }));
    setEditing(null); setRepairForm({ serviceDate:today(), serviceType:'Phone repair', device:'', customer:'', customerPhone:'', customerEmail:'', customerAddress:'', serviceRendered:'', repairStatus:'In progress', labor:'', partsCost:'0', otherCosts:'0', amountCharged:'', paymentStatus:'Paid', paymentReceivedDate:today(), notes:'' }); setNotice('Repair income saved.'); setTab('repairs');
  }
  function editRepair(x) { setSelectedRepair(null); setEditing({type:'repair',id:x.id}); setRepairForm({ serviceDate:x.serviceDate || today(), serviceType:x.serviceType || 'Phone repair', device:x.device || '', customer:x.customer || '', customerPhone:x.customerPhone || '', customerEmail:x.customerEmail || '', customerAddress:x.customerAddress || '', serviceRendered:x.serviceRendered || '', repairStatus:x.repairStatus || 'Completed', labor:String(x.labor ?? ''), partsCost:String(x.partsCost ?? 0), otherCosts:String(x.otherCosts ?? 0), amountCharged:String(x.amountCharged ?? 0), paymentStatus:x.paymentStatus || 'Paid', paymentReceivedDate:x.paymentReceivedDate || '', notes:x.notes || '' }); setTab('add-repair'); }
  function savePayout(e) {
    e.preventDefault();
    if (!payForm.payoutDate || !(Number(payForm.amount) > 0)) { setNotice('Enter a valid payout date and amount.'); return; }
    const record = { ...payForm, amount:Number(payForm.amount), id:editing?.type === 'payout' ? editing.id : uid() };
    setData(d => ({ ...d, payouts: editing?.type === 'payout' ? d.payouts.map(x => x.id === editing.id ? record : x) : [record, ...d.payouts] }));
    setEditing(null); setPayForm({ platform:'YouTube', payoutDate:today(), amount:'', reference:'', relatedPeriod:'', notes:'' }); setNotice('Payout saved.');
  }
  function toggleEarningPaid(id) {
    setData(d => ({ ...d, earnings: d.earnings.map(x => {
      if (x.id !== id) return x;
      const isPaid = paymentState(x) === 'Paid';
      return isPaid
        ? { ...x, paymentStatus: 'Pending', paidAmount: 0, paymentReceivedDate: '' }
        : { ...x, paymentStatus: 'Paid', paidAmount: Number(x.net || 0), paymentReceivedDate: x.paymentReceivedDate || today() };
    }) }));
    setNotice('Payment status updated.');
  }
  function editEarning(x) { setEditing({type:'earning',id:x.id}); setEarnForm({ platform:x.platform, reportType:x.reportType, periodStart:x.periodStart, periodEnd:x.periodEnd, paymentReceivedDate:x.paymentReceivedDate||'', paymentStatus:paymentState(x), paidAmount:String(receivedAmount(x)), gross:String(x.gross), tax:String(x.tax), adjustments:String(x.adjustments), notes:x.notes || '' }); setTab('add-earning'); }
  function editPayout(x) { setEditing({type:'payout',id:x.id}); setPayForm({ platform:x.platform, payoutDate:x.payoutDate, amount:String(x.amount), reference:x.reference || '', relatedPeriod:x.relatedPeriod || '', notes:x.notes || '' }); setTab('add-payout'); }
  function remove(type, id) { if (!confirm('Delete this record? This cannot be undone.')) return; setDeletedIds(current => ({ ...current, [type]: [...new Set([...(current[type] || []), String(id)])] })); setData(d => ({...d, [type]:d[type].filter(x => String(x.id) !== String(id))})); setNotice(cloudConnected ? 'Record deleted locally. Google Sheets deletion will sync shortly.' : 'Record deleted locally. Connect Google Sheets later to sync this deletion.'); }
  function exportAll() {
    const rows = [['Record Type','ID','Platform','Period Start','Period End','Payment Received Date','Payment Status','Amount Received','Gross','Withholding Tax','Adjustments','Net Commission','Payout Date','Payout Amount','Reference','Related Period','Notes']];
    data.earnings.forEach(x => rows.push(['Earning',x.id,x.platform,x.periodStart,x.periodEnd,x.paymentReceivedDate,x.paymentStatus || (x.paymentReceivedDate ? 'Paid' : 'Pending'),x.paidAmount ?? ((x.paymentStatus === 'Paid' || (!x.paymentStatus && x.paymentReceivedDate)) ? x.net : 0),x.gross,x.tax,x.adjustments,x.net,'','','','','',''+(x.notes || '')]));
    data.payouts.forEach(x => rows.push(['Payout',x.id,x.platform,'','','','','','','','',x.payoutDate,x.amount,x.reference,x.relatedPeriod,x.notes]));
    (data.repairs || []).forEach(x => rows.push(['Repair',x.id,x.serviceType,x.serviceDate,x.device,x.customer,x.labor,x.partsCost,x.otherCosts,x.amountCharged,x.netProfit,x.paymentStatus,x.paymentReceivedDate,'','','',x.notes]));
    downloadCsv('side-hustle-income-backup.csv', rows);
  }
  function importBackup(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { const parsed = JSON.parse(reader.result); if (!Array.isArray(parsed.earnings) || !Array.isArray(parsed.payouts)) throw new Error(); setData({ earnings:parsed.earnings, payouts:parsed.payouts, repairs:Array.isArray(parsed.repairs)?parsed.repairs:[], tasks:Array.isArray(parsed.tasks)?parsed.tasks:[], target:Number(parsed.target)||10000 }); setNotice('Backup restored.'); } catch { setNotice('Invalid JSON backup file.'); } };
    reader.readAsText(file); e.target.value = '';
  }
  function backupJson() { const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='side-hustle-income-backup.json'; a.click(); URL.revokeObjectURL(url); }
  function addTask(e) { e.preventDefault(); if (!taskTitle.trim()) return; setData(d=>({...d,tasks:[{id:uid(),title:taskTitle.trim(),dueDate:taskDueDate,done:false,createdAt:new Date().toISOString()},...(d.tasks||[])]})); setTaskTitle(''); setTaskDueDate(''); }
  function toggleTask(id) { setData(d=>({...d,tasks:(d.tasks||[]).map(x=>x.id===id?{...x,done:!x.done}:x)})); }
  function removeTask(id) { setData(d=>({...d,tasks:(d.tasks||[]).filter(x=>x.id!==id)})); }
  const nav = [['overview','Overview'],['tasks','Tasks'],['earnings','Earnings'],['payouts','Payouts'],['repairs','Repairs'],['add-earning','Add earnings'],['add-payout','Add payout'],['settings','Settings']];
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><img className="brand-mark" src="/sidetracked-icon.svg" alt="" /><div><strong>SideTracked</strong><span>Your side income, on track.</span></div></div><nav>{nav.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setEditing(null);}} >{label}{id==='tasks' && (data.tasks||[]).filter(x=>!x.done).length>0 && <span className="nav-count">{(data.tasks||[]).filter(x=>!x.done).length}</span>}</button>)}</nav><div className="sidebar-bottom"><span className={"local-dot" + (syncError ? " error" : connecting || syncing ? " busy" : cloudConnected ? " connected" : "")}></span> {connecting ? "Connecting to Google Sheets…" : syncing ? "Updating Google Sheets…" : syncError ? "Google Sheets sync issue · Local backup active" : cloudConnected ? "Google Sheets connected · Up to date" : "Local backup active"}</div></aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">PERSONAL FINANCE</p><h1>{nav.find(x=>x[0]===tab)?.[1] || 'Overview'}</h1></div><div className="header-tools"><div className="clock-chip"><strong>{currentTime.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Manila'})}</strong><span>{currentTime.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila'})}</span></div><button type="button" className="secondary small" onClick={()=>setDarkMode(v=>!v)} aria-pressed={darkMode}>{darkMode?'☀ Light':'☾ Dark'}</button><button type="button" className="secondary small" onClick={()=>setPrivacyMode(v=>!v)} aria-pressed={privacyMode}>{privacyMode?'Show amounts':'Hide amounts'}</button><div className="month-control"><label>Reporting month</label><input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div></div></header>
      {notice && <div className="notice" onClick={()=>setNotice('')}>{notice} <span>×</span></div>}
      {tab==='overview' && <div className="overview-layout"><div className="overview-main"><section className="welcome"><div><span className="eyebrow light">YOUR CREATOR INCOME</span><h2>Know what you earn.<br/>Track what you receive.</h2><p>Keep commissions and actual payouts separate, with late reports assigned to their earning period.</p></div><div className="goal-ring"><span>MONTHLY GOAL</span><strong>{Math.min(100, data.target ? monthTotal/data.target*100 : 0).toFixed(0)}%</strong><small>{displayMoney(monthTotal)} / {displayMoney(data.target)}</small></div></section>
      <section className="combined-income-card"><div className="combined-income-main"><span className="combined-income-label">TOTAL OVERALL NET INCOME</span><strong>{displayMoney(overallNetIncome)}</strong><small>Net commissions + repair profit, after recorded costs</small></div><div className="combined-income-breakdown"><div><span>Creator & affiliate net commissions</span><b>{displayMoney(lifetimeCommissionIncome)}</b></div><div><span>Repair net profit</span><b>{displayMoney(lifetimeRepairProfit)}</b></div></div></section>
      <section className="kpi-grid"><Kpi label="Earned this month" value={displayMoney(monthTotal)} hint="Based on report period end date"/><Kpi label="Payouts received" value={displayMoney(monthPayouts)} hint="Actual deposits recorded"/><Kpi label="Unpaid balance" value={displayMoney(monthPending)} hint={monthPartialCount ? monthPartialCount + ' partially paid report(s)' : 'Net earned less amount received'}/><Kpi label="12-month average" value={displayMoney(averageMonthly)} hint="Average net commission per month"/><Kpi label="Earned this year" value={displayMoney(yearTotal)} hint={String(year)}/><Kpi label="Payouts this year" value={displayMoney(yearPayouts)} hint="Cash received in selected year"/><Kpi label="Repair income" value={displayMoney((data.repairs || []).filter(x=>monthKey(x.serviceDate)===selectedMonth).reduce((s,x)=>s+Number(x.amountCharged||0),0))} hint="Service charges this month"/><Kpi label="Repair profit" value={displayMoney((data.repairs || []).filter(x=>monthKey(x.serviceDate)===selectedMonth).reduce((s,x)=>s+Number(x.netProfit ?? (Number(x.amountCharged||0)-Number(x.partsCost||0)-Number(x.otherCosts||0))),0))} hint="Charges less parts and other costs"/><Kpi label="Month-over-month" value={monthGrowth===null?'—':(monthGrowth>=0?'+':'')+monthGrowth.toFixed(1)+'%'} hint={'Vs. '+previousMonthKey}/> </section>
      <section className="panel"><div className="panel-head"><div><h3>Earnings by platform</h3><p>For {new Date(selectedMonth+'-01T00:00:00').toLocaleString('en',{month:'long',year:'numeric'})}</p></div><button className="text-btn" onClick={()=>setTab('earnings')}>View reports →</button></div><div className="platform-grid">{platformTotals.filter(x=>x.earned!==0 || PLATFORMS.indexOf(x.platform)<4).map(x=><div className="platform-card" key={x.platform}><span>{x.platform}</span><strong>{displayMoney(x.earned)}</strong><small className="platform-share">{x.share.toFixed(1)}% of monthly total</small><div className="mini-track"><i style={{width:Math.min(100,x.share)+'%'}}/></div></div>)}</div></section>
      <section className="panel"><div className="panel-head"><div><h3>Recent payouts</h3><p>Latest deposits recorded from affiliate platforms</p></div><button className="text-btn" onClick={()=>setTab('payouts')}>View payout history →</button></div><div className="table-wrap"><table><thead><tr><th>Platform</th><th>Received</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{latestPayouts.map(x=><tr key={x.id}><td><Badge>{x.platform}</Badge></td><td>{x.payoutDate}</td><td className="strong">{displayMoney(x.amount)}</td><td>{x.reference || '—'}</td></tr>)}{!latestPayouts.length&&<Empty col={4} text="No payouts recorded yet."/>}</tbody></table></div></section>
      <section className="panel"><div className="panel-head"><div><h3>12-month earnings trend</h3><p>Rolling 12 months ending with the selected reporting month, grouped by report end date</p></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height={280}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis tickFormatter={v=>privacyMode?'':'₱'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false}/><Tooltip content={<TrendTooltip money={displayMoney}/>} /><Legend/><Bar dataKey="YouTube" stackId="a" fill="#3157d5" radius={[3,3,0,0]}/><Bar dataKey="TikTok Affiliate" stackId="a" fill="#19a7a0"/><Bar dataKey="Shopee Affiliate" stackId="a" fill="#ef8b42"/><Bar dataKey="Lazada Affiliate" stackId="a" fill="#9b7bd8"/><Bar dataKey="Repair net profit" fill="#e0a23d" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div></section></div><aside className="pending-repairs-panel"><div className="pending-repairs-head"><div><h3>Pending repairs</h3><p>{pendingRepairs.length} jobs in progress</p></div><button type="button" className="text-btn" onClick={()=>setTab('repairs')}>All repairs →</button></div>{pendingRepairs.length ? pendingRepairs.map(repair=><button type="button" className="pending-repair-item" key={repair.id} onClick={()=>setSelectedRepair(repair)}><span className="pending-repair-date">{repair.serviceDate||'Date not set'}</span><strong>{repair.device||'Repair job'}</strong><small>{repair.customer||repair.serviceType||'Customer not recorded'} · {repair.repairStatus}</small></button>) : <p className="empty-note">No pending repairs. New jobs marked In progress will appear here.</p>}<button type="button" className="primary small pending-add-btn" onClick={()=>{setEditing(null);setRepairForm({serviceDate:today(),serviceType:'Phone repair',device:'',customer:'',customerPhone:'',customerEmail:'',customerAddress:'',serviceRendered:'',repairStatus:'In progress',labor:'',partsCost:'0',otherCosts:'0',amountCharged:'',paymentStatus:'Paid',paymentReceivedDate:today(),notes:''});setTab('add-repair')}}>＋ Add repair</button></aside></div>}
      {tab==='tasks' && <section className="panel tasks-panel"><div className="panel-head"><div><h3>Tasks</h3><p>Keep repair follow-ups and side-hustle work in one list. Tasks are saved in this browser.</p></div></div><form className="task-entry" onSubmit={addTask}><input aria-label="Task" required value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} placeholder="Add a task or follow-up"/><input aria-label="Due date" type="date" value={taskDueDate} onChange={e=>setTaskDueDate(e.target.value)}/><button className="primary">Add task</button></form><div className="task-list">{(data.tasks||[]).map(task=><div className={'task-row'+(task.done?' is-done':'')} key={task.id}><label><input type="checkbox" checked={task.done} onChange={()=>toggleTask(task.id)}/><span>{task.title}</span></label><small>{task.dueDate||'No due date'}</small><button type="button" className="icon-btn danger" onClick={()=>removeTask(task.id)}>Delete</button></div>)}{!(data.tasks||[]).length&&<p className="empty-note">No tasks yet. Add a task or follow-up above.</p>}</div></section>}
      {tab==='earnings' && <section className="panel"><div className="panel-head"><div><h3>Earnings reports</h3><p>Commission earned during the reporting period—not necessarily paid yet.</p></div><div className="head-actions"><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="month">Selected month</option><option value="year">Selected year</option><option value="all">All records</option></select><button type="button" className="secondary small reset-btn" onClick={()=>{setPeriod('month');setSelectedMonth(today().slice(0,7));setEarningSort({key:'periodEnd',direction:'desc'});}}>↺ Reset filters</button><button className="primary small" onClick={()=>{setEditing(null);setTab('add-earning')}}>＋ Add report</button></div></div><div className="table-wrap"><table><thead><tr><th><SortHeader label="Platform" sortKey="platform" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Reporting period" sortKey="periodEnd" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Bank received" sortKey="paymentReceivedDate" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th>Predicted payment</th><th><SortHeader label="Payment status" sortKey="paymentStatus" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Gross" sortKey="gross" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Tax" sortKey="tax" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Net earned" sortKey="net" state={earningSort} onSort={key=>setEarningSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th></th></tr></thead><tbody>{sortedEarnings.map(x=><tr key={x.id}><td><Badge>{x.platform}</Badge></td><td>{x.periodStart} → {x.periodEnd}</td><td>{x.paymentReceivedDate||'—'}</td><td>{predictionLabel(x)}{!x.paymentReceivedDate && paymentLagStats(x.platform).count >= 2 && <small className="muted prediction-sample">Based on {paymentLagStats(x.platform).count} paid reports</small>}</td><td><div className="payment-cell"><Badge>{paymentState(x)}</Badge><button type="button" role="switch" aria-checked={paymentState(x) === 'Paid'} className={'paid-toggle '+(paymentState(x) === 'Paid' ? 'is-paid' : '')} onClick={()=>toggleEarningPaid(x.id)} title="Toggle paid status"><span className="toggle-knob"></span><span>{paymentState(x) === 'Paid' ? 'Paid' : 'Mark paid'}</span></button></div></td><td>{displayMoney(x.gross)}</td><td>{displayMoney(x.tax)}</td><td className="strong">{displayMoney(x.net)}</td><td><button className="icon-btn" onClick={()=>editEarning(x)}>Edit</button><button className="icon-btn danger" onClick={()=>remove('earnings',x.id)}>Delete</button></td></tr>)}{!filteredEarnings.length&&<Empty col={9} text="No earnings reports in this view yet."/ >}</tbody></table></div></section>}
      {tab==='payouts' && <section className="panel"><div className="panel-head"><div><h3>Payout history</h3><p>Actual bank deposits plus paid-report allocations linked from Earnings. Linked rows are not counted twice in cash totals.</p></div><div className="head-actions"><button type="button" className="secondary small reset-btn" onClick={()=>setPayoutSort({key:'date',direction:'desc'})}>↺ Reset sorting</button><button className="primary small" onClick={()=>{setEditing(null);setTab('add-payout')}}>＋ Add payout</button></div></div><div className="table-wrap"><table><thead><tr><th><SortHeader label="Platform" sortKey="platform" state={payoutSort} onSort={key=>setPayoutSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Payout date" sortKey="date" state={payoutSort} onSort={key=>setPayoutSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th><SortHeader label="Amount received" sortKey="amount" state={payoutSort} onSort={key=>setPayoutSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}))}/></th><th>Reference</th><th>Related period</th><th></th></tr></thead><tbody>{payoutHistoryRows.map(x=><tr key={x.id}><td><Badge>{x.platform}</Badge><small className="muted payout-source">{x.source}</small></td><td>{x.date||'—'}</td><td className="strong">{displayMoney(x.amount)}</td><td>{x.reference||'—'}</td><td>{x.relatedPeriod||'—'}</td><td>{x.actual?<><button className="icon-btn" onClick={()=>editPayout(data.payouts.find(p=>p.id===x.id))}>Edit</button><button className="icon-btn danger" onClick={()=>remove('payouts',x.id)}>Delete</button></>:'Linked automatically'}</td></tr>)}{!payoutHistoryRows.length&&<Empty col={6} text="No payouts or paid report entries yet."/ >}</tbody></table></div></section>}
      {tab==='add-earning' && <section className="panel form-panel"><div className="panel-head"><div><h3>{editing?'Edit earnings report':'Add earnings report'}</h3><p>Use the platform's actual reporting dates, even if you're entering the report late.</p></div></div><form onSubmit={saveEarning} className="form-grid"><Field label="Platform"><select value={earnForm.platform} onChange={e=>setEarnForm({...earnForm,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></Field><Field label="Report type"><select value={earnForm.reportType} onChange={e=>setEarnForm({...earnForm,reportType:e.target.value})}><option>Weekly</option><option>Monthly</option><option>Custom</option></select></Field><Field label="Period start"><input type="date" required value={earnForm.periodStart} onChange={e=>setEarnForm({...earnForm,periodStart:e.target.value})}/></Field><Field label="Period end"><input type="date" required value={earnForm.periodEnd} onChange={e=>setEarnForm({...earnForm,periodEnd:e.target.value})}/></Field><Field label="Payment received in bank (optional)"><input type="date" value={earnForm.paymentReceivedDate} onChange={e=>setEarnForm({...earnForm,paymentReceivedDate:e.target.value,paymentStatus:e.target.value ? "Paid" : "Pending"})}/></Field><Field label="Payment received"><label className="paid-form-toggle"><input type="checkbox" checked={Number(earnForm.paidAmount || 0) >= Math.max(0, Number(earnForm.gross || 0) - Number(earnForm.tax || 0) + Number(earnForm.adjustments || 0)) && Number(earnForm.gross || 0) > 0} onChange={e=>{const net=Math.max(0,Number(earnForm.gross||0)-Number(earnForm.tax||0)+Number(earnForm.adjustments||0));setEarnForm({...earnForm,paidAmount:e.target.checked?String(net):'0',paymentReceivedDate:e.target.checked?(earnForm.paymentReceivedDate||today()):''});}}/><span className="paid-form-track"></span><span className="paid-form-label">{Number(earnForm.paidAmount || 0) >= Math.max(0, Number(earnForm.gross || 0) - Number(earnForm.tax || 0) + Number(earnForm.adjustments || 0)) && Number(earnForm.gross || 0) > 0 ? 'Paid' : 'Not paid'}</span></label></Field><Field label="Gross commission (₱)"><input type="number" min="0" step="0.01" required value={earnForm.gross} onChange={e=>setEarnForm({...earnForm,gross:e.target.value})}/></Field><Field label="Withholding tax (₱)"><input type="number" min="0" step="0.01" value={earnForm.tax} onChange={e=>setEarnForm({...earnForm,tax:e.target.value})}/></Field><Field label="Adjustments (₱)"><input type="number" step="0.01" value={earnForm.adjustments} onChange={e=>setEarnForm({...earnForm,adjustments:e.target.value})}/></Field><Field label="Net commission (calculated)"><div className="calculated">{displayMoney(Number(earnForm.gross||0)-Number(earnForm.tax||0)+Number(earnForm.adjustments||0))}</div></Field><Field label="Notes / report reference" wide><input value={earnForm.notes} onChange={e=>setEarnForm({...earnForm,notes:e.target.value})} placeholder="Optional reference or notes"/></Field><div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEditing(null);setTab('earnings')}}>Cancel</button><button className="primary">{editing?'Save changes':'Save earnings report'}</button></div></form></section>}
      {tab==='add-payout' && <section className="panel form-panel"><div className="panel-head"><div><h3>{editing?'Edit payout':'Record a payout'}</h3><p>Enter the date the money actually reached your account.</p></div></div><form onSubmit={savePayout} className="form-grid"><Field label="Platform"><select value={payForm.platform} onChange={e=>setPayForm({...payForm,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></Field><Field label="Payout date"><input type="date" required value={payForm.payoutDate} onChange={e=>setPayForm({...payForm,payoutDate:e.target.value})}/></Field><Field label="Amount received (₱)"><input type="number" min="0.01" step="0.01" required value={payForm.amount} onChange={e=>setPayForm({...payForm,amount:e.target.value})}/></Field><Field label="Transaction reference"><input value={payForm.reference} onChange={e=>setPayForm({...payForm,reference:e.target.value})}/></Field><Field label="Related earnings period (optional)"><input placeholder="e.g. 2026-10-01 to 2026-10-31" value={payForm.relatedPeriod} onChange={e=>setPayForm({...payForm,relatedPeriod:e.target.value})}/></Field><Field label="Notes"><input value={payForm.notes} onChange={e=>setPayForm({...payForm,notes:e.target.value})}/></Field><div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEditing(null);setTab('payouts')}}>Cancel</button><button className="primary">{editing?'Save changes':'Save payout'}</button></div></form></section>}
      {tab==='repairs' && (() => {
        const repairs = data.repairs || [];
        const totalIncome = repairs.reduce((sum,x)=>sum+Number(x.amountCharged||0),0);
        const totalProfit = repairs.reduce((sum,x)=>sum+Number(x.netProfit ?? (Number(x.amountCharged||0)-Number(x.partsCost||0)-Number(x.otherCosts||0))),0);
        const unpaid = repairs.filter(x=>(x.paymentStatus||'Paid')!=='Paid').reduce((sum,x)=>sum+Number(x.amountCharged||0),0);
        const query = repairSearch.trim().toLowerCase();
        const filtered = repairs.filter(x=>[x.device,x.customer,x.serviceType,x.notes,x.paymentStatus].join(' ').toLowerCase().includes(query))
          .sort((a,b)=>{const av=a[repairSort.key]??'',bv=b[repairSort.key]??'';const n=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true});return repairSort.direction==='asc'?n:-n;});
        const sortBy = key => setRepairSort(v=>({key,direction:v.key===key&&v.direction==='asc'?'desc':'asc'}));
        return <><section className="repair-stat-grid">
          <div className="repair-stat"><span>Repairs completed</span><strong>{repairs.length}</strong><small>All recorded jobs</small></div>
          <div className="repair-stat"><span>Total repair income</span><strong>{displayMoney(totalIncome)}</strong><small>Customer charges</small></div>
          <div className="repair-stat"><span>Estimated net profit</span><strong>{displayMoney(totalProfit)}</strong><small>After parts and other costs</small></div>
          <div className="repair-stat"><span>Outstanding payments</span><strong>{displayMoney(unpaid)}</strong><small>Pending / partially paid jobs</small></div>
        </section><section className="repair-category-summary" aria-label="Repair jobs by category">
          {['Phone repair','Laptop repair','Computer repair','Other repair'].map(category => <div className={'repair-category-count '+category.toLowerCase().replaceAll(' ','-')} key={category}>
            <span>{category === 'Phone repair' ? 'Phones' : category === 'Laptop repair' ? 'Laptops' : category === 'Computer repair' ? 'Computers' : 'Other repairs'}</span>
            <strong>{repairs.filter(x => (x.serviceType || 'Other repair') === category).length}</strong>
            <small>jobs recorded</small>
          </div>)}
        </section><section className="panel"><div className="panel-head"><div><h3>Repair income</h3><p>Track service charges separately from creator and affiliate earnings. Profit = amount charged − parts − other costs.</p></div><button className="primary small" onClick={()=>{setEditing(null);setRepairForm({serviceDate:today(),serviceType:'Phone repair',device:'',customer:'',customerPhone:'',customerEmail:'',customerAddress:'',serviceRendered:'',repairStatus:'In progress',labor:'',partsCost:'0',otherCosts:'0',amountCharged:'',paymentStatus:'Paid',paymentReceivedDate:today(),notes:''});setTab('add-repair')}}>＋ Add repair</button></div>
        <div className="repair-toolbar"><input aria-label="Search repair records" placeholder="Search device, customer, service, status…" value={repairSearch} onChange={e=>setRepairSearch(e.target.value)}/><select aria-label="Sort repair records" value={repairSort.key} onChange={e=>setRepairSort(v=>({...v,key:e.target.value}))}><option value="serviceDate">Sort: Date</option><option value="amountCharged">Sort: Income</option><option value="netProfit">Sort: Profit</option><option value="serviceType">Sort: Category</option><option value="paymentStatus">Sort: Payment</option><option value="device">Sort: Device</option></select><button type="button" className="secondary small" onClick={()=>setRepairSort(v=>({...v,direction:v.direction==='desc'?'asc':'desc'}))}>{repairSort.direction==='desc'?'Newest / highest':'Oldest / lowest'}</button></div>
        <div className="table-wrap"><table><thead><tr><th><SortHeader label="Date" sortKey="serviceDate" state={repairSort} onSort={sortBy}/></th><th><SortHeader label="Service" sortKey="serviceType" state={repairSort} onSort={sortBy}/></th><th><SortHeader label="Device" sortKey="device" state={repairSort} onSort={sortBy}/></th><th><SortHeader label="Amount charged" sortKey="amountCharged" state={repairSort} onSort={sortBy}/></th><th>Parts cost</th><th>Other costs</th><th>Job status</th><th><SortHeader label="Net profit" sortKey="netProfit" state={repairSort} onSort={sortBy}/></th><th><SortHeader label="Payment" sortKey="paymentStatus" state={repairSort} onSort={sortBy}/></th><th></th></tr></thead><tbody>{filtered.map(x=><tr key={x.id}><td>{x.serviceDate}</td><td><span className={'repair-category '+(x.serviceType||'Other repair').toLowerCase().replaceAll(' ','-')}>{x.serviceType||'Other repair'}</span></td><td>{x.device}</td><td className="strong">{displayMoney(x.amountCharged)}</td><td>{displayMoney(x.partsCost)}</td><td>{displayMoney(x.otherCosts)}</td><td><span className={'job-status '+String(x.repairStatus||'Completed').toLowerCase().replaceAll(' ','-')}>{x.repairStatus||'Completed'}</span></td><td className="strong">{displayMoney(x.netProfit ?? (Number(x.amountCharged||0)-Number(x.partsCost||0)-Number(x.otherCosts||0)))}</td><td><span className={'repair-payment '+String(x.paymentStatus||'Paid').toLowerCase().replaceAll(' ','-')}>{x.paymentStatus||'Paid'}</span></td><td><button className="icon-btn" onClick={()=>setSelectedRepair(x)}>View details</button><button className="icon-btn" onClick={()=>editRepair(x)}>Edit</button><button className="icon-btn danger" onClick={()=>remove('repairs',x.id)}>Delete</button></td></tr>)}{!filtered.length&&<Empty col={10} text={repairs.length?'No repair records match your search.':'No repair jobs recorded yet. Add your first service transaction.'}/>}</tbody></table></div><p className="repair-result-count">Showing {filtered.length} of {repairs.length} repair jobs</p></section></>;
      })()}
      {tab==='add-repair' && <section className="panel form-panel"><div className="panel-head"><div><h3>{editing?'Edit repair record':'Record a repair'}</h3><p>Record what the customer paid and your actual parts and other costs. Labor is tracked separately for reference.</p></div></div><form onSubmit={saveRepair} className="form-grid"><Field label="Service date"><input type="date" required value={repairForm.serviceDate} onChange={e=>setRepairForm({...repairForm,serviceDate:e.target.value})}/></Field><Field label="Service type"><select value={repairForm.serviceType} onChange={e=>setRepairForm({...repairForm,serviceType:e.target.value})}><option>Phone repair</option><option>Laptop repair</option><option>Computer repair</option><option>Other repair</option></select></Field><Field label="Device / model"><input required value={repairForm.device} onChange={e=>setRepairForm({...repairForm,device:e.target.value})} placeholder="e.g. Samsung A52 LCD replacement"/></Field><Field label="Customer name"><input value={repairForm.customer} onChange={e=>setRepairForm({...repairForm,customer:e.target.value})} placeholder="Client name"/></Field><Field label="Customer phone"><input value={repairForm.customerPhone} onChange={e=>setRepairForm({...repairForm,customerPhone:e.target.value})} placeholder="Phone number"/></Field><Field label="Customer email"><input type="email" value={repairForm.customerEmail} onChange={e=>setRepairForm({...repairForm,customerEmail:e.target.value})} placeholder="Email address"/></Field><Field label="Customer address" wide><input value={repairForm.customerAddress} onChange={e=>setRepairForm({...repairForm,customerAddress:e.target.value})} placeholder="Address (optional)"/></Field><Field label="Service rendered" wide><textarea rows="3" value={repairForm.serviceRendered} onChange={e=>setRepairForm({...repairForm,serviceRendered:e.target.value})} placeholder="Describe work performed for the receipt"/></Field><Field label="Job status"><select value={repairForm.repairStatus} onChange={e=>setRepairForm({...repairForm,repairStatus:e.target.value})}><option>Pending</option><option>In progress</option><option>Completed</option></select></Field><Field label="Labor charge (₱)"><input type="number" min="0" step="0.01" value={repairForm.labor} onChange={e=>setRepairForm({...repairForm,labor:e.target.value})}/></Field><Field label="Parts / materials cost (₱)"><input type="number" min="0" step="0.01" value={repairForm.partsCost} onChange={e=>setRepairForm({...repairForm,partsCost:e.target.value})}/></Field><Field label="Other expenses (₱)"><input type="number" min="0" step="0.01" value={repairForm.otherCosts} onChange={e=>setRepairForm({...repairForm,otherCosts:e.target.value})}/></Field><Field label="Total amount charged (₱)"><input type="number" min="0.01" step="0.01" required value={repairForm.amountCharged} onChange={e=>setRepairForm({...repairForm,amountCharged:e.target.value})}/></Field><Field label="Net profit (calculated)"><div className="calculated">{displayMoney(Number(repairForm.amountCharged||0)-Number(repairForm.partsCost||0)-Number(repairForm.otherCosts||0))}</div></Field><Field label="Payment status"><select value={repairForm.paymentStatus} onChange={e=>setRepairForm({...repairForm,paymentStatus:e.target.value,paymentReceivedDate:e.target.value==='Paid'?(repairForm.paymentReceivedDate||today()):''})}><option>Paid</option><option>Pending</option><option>Partially Paid</option></select></Field><Field label="Payment received date (optional)"><input type="date" value={repairForm.paymentReceivedDate} onChange={e=>setRepairForm({...repairForm,paymentReceivedDate:e.target.value})}/></Field><Field label="Notes (optional)" wide><input value={repairForm.notes} onChange={e=>setRepairForm({...repairForm,notes:e.target.value})} placeholder="Parts used, warranty, issue, or job notes"/></Field><div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEditing(null);setTab('repairs')}}>Cancel</button><button className="primary">{editing?'Save changes':'Save repair record'}</button></div></form></section>}
      {tab==='settings' && <section className="panel form-panel"><div className="panel-head"><div><h3>Settings & data</h3><p>{cloudConnected ? "Google Sheets is your connected storage." : "Connect Google Sheets for persistent, cross-device storage."}</p></div><button className="primary" onClick={connectGoogleSheets} disabled={connecting}>{connecting ? "Connecting…" : cloudConnected ? "Reconnect Google Sheets" : "Connect Google Sheets"}</button></div><div className="settings-block"><label>Monthly earnings target (₱)</label><input type="number" min="0" value={data.target} onChange={e=>setData(d=>({...d,target:Number(e.target.value)}))}/><p className="muted">Used for the monthly goal indicator on the Overview page.</p></div><div className="settings-block"><h4>Backup & restore</h4><p className="muted">Export a JSON backup regularly. CSV export is useful for spreadsheets and bookkeeping.</p><div className="button-row"><button className="primary" onClick={backupJson}>Download JSON backup</button><button className="secondary" onClick={exportAll}>Export CSV</button><label className="secondary file-label">Restore JSON backup<input type="file" accept="application/json,.json" onChange={importBackup}/></label></div></div><div className="warning-box"><strong>{cloudConnected ? "Google Sheets storage enabled" : "Before connecting"}</strong><p>{cloudConnected ? "Your records are synced to your private Google spreadsheet. Keep your JSON backup as an additional recovery copy. Google access may need to be renewed when the access token expires." : "Until you connect Google Sheets, records are stored only in this browser. Download a JSON backup before connecting if you have existing records."}</p></div><div className="settings-block"><h4>Data totals</h4><p>{data.earnings.length} earnings reports · {data.payouts.length} payouts · {(data.repairs||[]).length} repair jobs · {displayMoney(data.earnings.reduce((s,x)=>s+Number(x.net||0),0))} lifetime creator/affiliate earnings · {displayMoney((data.repairs||[]).reduce((s,x)=>s+Number(x.netProfit ?? (Number(x.amountCharged||0)-Number(x.partsCost||0)-Number(x.otherCosts||0))),0))} repair profit</p></div></section>}
      {selectedRepair && <div className="modal-backdrop" role="presentation" onClick={()=>setSelectedRepair(null)}><section className="repair-modal" role="dialog" aria-modal="true" aria-labelledby="repair-modal-title" onClick={e=>e.stopPropagation()}><div className="modal-toolbar"><div><p className="eyebrow">REPAIR RECORD</p><h2 id="repair-modal-title">{selectedRepair.device||'Repair details'}</h2></div><button type="button" className="secondary small" onClick={()=>setSelectedRepair(null)}>Close</button></div><div className="repair-detail-grid"><div><span>Client</span><strong>{selectedRepair.customer||'Not provided'}</strong></div><div><span>Phone</span><strong>{selectedRepair.customerPhone||'Not provided'}</strong></div><div><span>Email</span><strong>{selectedRepair.customerEmail||'Not provided'}</strong></div><div><span>Address</span><strong>{selectedRepair.customerAddress||'Not provided'}</strong></div><div><span>Service</span><strong>{selectedRepair.serviceType||'Repair'}</strong></div><div><span>Job status</span><strong>{selectedRepair.repairStatus||'Completed'}</strong></div><div><span>Date</span><strong>{selectedRepair.serviceDate||'—'}</strong></div><div><span>Payment</span><strong>{selectedRepair.paymentStatus||'Paid'}</strong></div><div className="detail-wide"><span>Service rendered</span><strong>{selectedRepair.serviceRendered||selectedRepair.notes||'No service description recorded.'}</strong></div></div><div className="receipt-print-area"><div className="receipt-heading"><div><strong>Service Receipt</strong><span>{selectedRepair.receiptNumber||('SR-'+String(selectedRepair.id||'').slice(-8).toUpperCase())}</span></div><small>{selectedRepair.serviceDate||today()}</small></div><div className="receipt-client"><b>Client</b><span>{selectedRepair.customer||'—'}</span>{selectedRepair.customerPhone&&<span>{selectedRepair.customerPhone}</span>}{selectedRepair.customerEmail&&<span>{selectedRepair.customerEmail}</span>}{selectedRepair.customerAddress&&<span>{selectedRepair.customerAddress}</span>}</div><div className="receipt-service"><b>Device / model</b><span>{selectedRepair.device||'—'}</span><b>Service rendered</b><span>{selectedRepair.serviceRendered||selectedRepair.notes||'—'}</span></div><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>Labor</td><td>{displayMoney(selectedRepair.labor)}</td></tr><tr><td>Parts and materials</td><td>{displayMoney(selectedRepair.partsCost)}</td></tr><tr><td>Other costs</td><td>{displayMoney(selectedRepair.otherCosts)}</td></tr><tr className="receipt-total"><td>Total charged</td><td>{displayMoney(selectedRepair.amountCharged)}</td></tr></tbody></table><p className="receipt-payment">Payment status: {selectedRepair.paymentStatus||'Paid'}{selectedRepair.paymentReceivedDate?' · '+selectedRepair.paymentReceivedDate:''}</p></div><div className="modal-actions"><button type="button" className="secondary" onClick={()=>editRepair(selectedRepair)}>Edit repair</button><button type="button" className="primary" onClick={()=>window.print()}>Print receipt</button></div></section></div>}
  <footer>SideTracked <span>•</span> {cloudConnected ? "Google Sheets storage · PHP currency" : "Local backup · PHP currency"}</footer>
    </main>
  </div>;
}

function TrendTooltip({active,payload,label,money}) { if(!active||!payload?.length)return null; const row=payload[0].payload; return <div className='trend-tooltip'><strong>{label}</strong>{payload.map(item=><div key={item.dataKey}><span>{item.name||item.dataKey}</span><b>{money(item.value)}</b></div>)}<div><span>Repairs done</span><b>{row['Repairs done']||0}</b></div></div>; }
function SortHeader({label,sortKey,state,onSort}) { const active=state.key===sortKey; return <button type="button" className="sort-header" onClick={()=>onSort(sortKey)}>{label}<span aria-hidden="true">{active?(state.direction==='asc'?' ↑':' ↓'):' ↕'}</span></button>; }
function Kpi({label,value,hint}) { return <div className="kpi"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function Badge({children}) { return <span className="badge">{children}</span>; }
function Field({label,children,wide}) { return <label className={'field'+(wide?' wide':'')}><span>{label}</span>{children}</label>; }
function Empty({col,text}) { return <tr><td colSpan={col} className="empty">{text}</td></tr>; }

export default App;
