import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const PLATFORMS = ['YouTube', 'TikTok Affiliate', 'Shopee Affiliate', 'Lazada Affiliate', 'Other'];
const STORE_KEY = 'side-hustle-income-tracker-v1';
const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(n || 0));
const today = () => new Date().toISOString().slice(0, 10);
const monthKey = d => (d || '').slice(0, 7);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { earnings: Array.isArray(saved.earnings) ? saved.earnings : [], payouts: Array.isArray(saved.payouts) ? saved.payouts : [], target: Number(saved.target) || 10000 };
  } catch { return { earnings: [], payouts: [], target: 10000 }; }
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [earnForm, setEarnForm] = useState({ platform: 'Shopee Affiliate', reportType: 'Weekly', periodStart: today(), periodEnd: today(), paymentReceivedDate: '', gross: '', tax: '0', adjustments: '0', notes: '' });
  const [payForm, setPayForm] = useState({ platform: 'YouTube', payoutDate: today(), amount: '', reference: '', relatedPeriod: '', notes: '' });

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }, [data]);
  const year = Number(selectedMonth.slice(0, 4));
  const monthEarnings = data.earnings.filter(x => monthKey(x.periodEnd) === selectedMonth);
  const monthTotal = monthEarnings.reduce((s, x) => s + Number(x.net || 0), 0);
  const monthPayouts = data.payouts.filter(x => monthKey(x.payoutDate) === selectedMonth).reduce((s, x) => s + Number(x.amount || 0), 0);
  const yearTotal = data.earnings.filter(x => Number((x.periodEnd || '').slice(0, 4)) === year).reduce((s, x) => s + Number(x.net || 0), 0);
  const yearPayouts = data.payouts.filter(x => Number((x.payoutDate || '').slice(0, 4)) === year).reduce((s, x) => s + Number(x.amount || 0), 0);
  const platformTotals = PLATFORMS.map(platform => ({ platform, earned: monthEarnings.filter(x => x.platform === platform).reduce((s, x) => s + Number(x.net || 0), 0) }));
  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(year, new Date(selectedMonth + '-01T00:00:00').getMonth() - 5 + i, 1);
    const key = d.toISOString().slice(0, 7);
    const row = { month: d.toLocaleString('en', { month: 'short' }) };
    PLATFORMS.slice(0, 4).forEach(p => row[p] = data.earnings.filter(x => x.platform === p && monthKey(x.periodEnd) === key).reduce((s, x) => s + Number(x.net || 0), 0));
    return row;
  });
  const filteredEarnings = useMemo(() => {
    if (period === 'all') return data.earnings;
    if (period === 'month') return data.earnings.filter(x => monthKey(x.periodEnd) === selectedMonth);
    if (period === 'year') return data.earnings.filter(x => (x.periodEnd || '').startsWith(String(year)));
    return data.earnings;
  }, [data.earnings, period, selectedMonth, year]);

  function saveEarning(e) {
    e.preventDefault();
    const gross = Number(earnForm.gross), tax = Number(earnForm.tax || 0), adjustments = Number(earnForm.adjustments || 0);
    if (!earnForm.periodStart || !earnForm.periodEnd || earnForm.periodEnd < earnForm.periodStart || !Number.isFinite(gross)) { setNotice('Check the reporting dates and gross amount.'); return; }
    const record = { ...earnForm, gross, tax, adjustments, net: gross - tax + adjustments, id: editing?.type === 'earning' ? editing.id : uid() };
    setData(d => ({ ...d, earnings: editing?.type === 'earning' ? d.earnings.map(x => x.id === editing.id ? record : x) : [record, ...d.earnings] }));
    setEditing(null); setEarnForm({ platform:'Shopee Affiliate', reportType:'Weekly', periodStart:today(), periodEnd:today(), paymentReceivedDate:'', gross:'', tax:'0', adjustments:'0', notes:'' }); setNotice('Earnings report saved.');
  }
  function savePayout(e) {
    e.preventDefault();
    if (!payForm.payoutDate || !(Number(payForm.amount) > 0)) { setNotice('Enter a valid payout date and amount.'); return; }
    const record = { ...payForm, amount:Number(payForm.amount), id:editing?.type === 'payout' ? editing.id : uid() };
    setData(d => ({ ...d, payouts: editing?.type === 'payout' ? d.payouts.map(x => x.id === editing.id ? record : x) : [record, ...d.payouts] }));
    setEditing(null); setPayForm({ platform:'YouTube', payoutDate:today(), amount:'', reference:'', relatedPeriod:'', notes:'' }); setNotice('Payout saved.');
  }
  function editEarning(x) { setEditing({type:'earning',id:x.id}); setEarnForm({ platform:x.platform, reportType:x.reportType, periodStart:x.periodStart, periodEnd:x.periodEnd, paymentReceivedDate:x.paymentReceivedDate||'', gross:String(x.gross), tax:String(x.tax), adjustments:String(x.adjustments), notes:x.notes || '' }); setTab('add-earning'); }
  function editPayout(x) { setEditing({type:'payout',id:x.id}); setPayForm({ platform:x.platform, payoutDate:x.payoutDate, amount:String(x.amount), reference:x.reference || '', relatedPeriod:x.relatedPeriod || '', notes:x.notes || '' }); setTab('add-payout'); }
  function remove(type, id) { if (!confirm('Delete this record? This cannot be undone.')) return; setData(d => ({...d, [type]:d[type].filter(x => x.id !== id)})); }
  function exportAll() {
    const rows = [['Record Type','ID','Platform','Period Start','Period End','Payment Received Date','Gross','Withholding Tax','Adjustments','Net Commission','Payout Date','Payout Amount','Reference','Related Period','Notes']];
    data.earnings.forEach(x => rows.push(['Earning',x.id,x.platform,x.periodStart,x.periodEnd,x.paymentReceivedDate,x.gross,x.tax,x.adjustments,x.net,'','','','',''+(x.notes || '')]));
    data.payouts.forEach(x => rows.push(['Payout',x.id,x.platform,'','','','','','','',x.payoutDate,x.amount,x.reference,x.relatedPeriod,x.notes]));
    downloadCsv('side-hustle-income-backup.csv', rows);
  }
  function importBackup(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { const parsed = JSON.parse(reader.result); if (!Array.isArray(parsed.earnings) || !Array.isArray(parsed.payouts)) throw new Error(); setData({ earnings:parsed.earnings, payouts:parsed.payouts, target:Number(parsed.target)||10000 }); setNotice('Backup restored.'); } catch { setNotice('Invalid JSON backup file.'); } };
    reader.readAsText(file); e.target.value = '';
  }
  function backupJson() { const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='side-hustle-income-backup.json'; a.click(); URL.revokeObjectURL(url); }
  const nav = [['overview','Overview'],['earnings','Earnings'],['payouts','Payouts'],['add-earning','Add earnings'],['add-payout','Add payout'],['settings','Settings']];
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">₱</div><div><strong>Side Hustle</strong><span>Income Tracker</span></div></div><nav>{nav.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setEditing(null);}}>{label}</button>)}</nav><div className="sidebar-bottom"><span className="local-dot"></span> Stored on this device</div></aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">PERSONAL FINANCE</p><h1>{nav.find(x=>x[0]===tab)?.[1] || 'Overview'}</h1></div><div className="month-control"><label>Reporting month</label><input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div></header>
      {notice && <div className="notice" onClick={()=>setNotice('')}>{notice} <span>×</span></div>}
      {tab==='overview' && <><section className="welcome"><div><span className="eyebrow light">YOUR CREATOR INCOME</span><h2>Know what you earn.<br/>Track what you receive.</h2><p>Keep commissions and actual payouts separate, with late reports assigned to their earning period.</p></div><div className="goal-ring"><span>MONTHLY GOAL</span><strong>{Math.min(100, data.target ? monthTotal/data.target*100 : 0).toFixed(0)}%</strong><small>{money(monthTotal)} / {money(data.target)}</small></div></section>
      <section className="kpi-grid"><Kpi label="Earned this month" value={money(monthTotal)} hint="Based on report period end date"/><Kpi label="Payouts received" value={money(monthPayouts)} hint="Based on actual payout date"/><Kpi label="Earned this year" value={money(yearTotal)} hint={String(year)}/><Kpi label="Payouts this year" value={money(yearPayouts)} hint="Cash received in selected year"/></section>
      <section className="panel"><div className="panel-head"><div><h3>Earnings by platform</h3><p>For {new Date(selectedMonth+'-01T00:00:00').toLocaleString('en',{month:'long',year:'numeric'})}</p></div><button className="text-btn" onClick={()=>setTab('earnings')}>View reports →</button></div><div className="platform-grid">{platformTotals.filter(x=>x.earned!==0 || PLATFORMS.indexOf(x.platform)<4).map(x=><div className="platform-card" key={x.platform}><span>{x.platform}</span><strong>{money(x.earned)}</strong><div className="mini-track"><i style={{width:Math.min(100,monthTotal>0?x.earned/monthTotal*100:0)+'%'}}/></div></div>)}</div></section>
      <section className="panel"><div className="panel-head"><div><h3>Recent earnings trend</h3><p>Last six months, grouped by report end date</p></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height={280}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis tickFormatter={v=>'₱'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false}/><Tooltip formatter={v=>money(v)}/><Legend/><Bar dataKey="YouTube" stackId="a" fill="#3157d5" radius={[3,3,0,0]}/><Bar dataKey="TikTok Affiliate" stackId="a" fill="#19a7a0"/><Bar dataKey="Shopee Affiliate" stackId="a" fill="#ef8b42"/><Bar dataKey="Lazada Affiliate" stackId="a" fill="#9b7bd8"/></BarChart></ResponsiveContainer></div></section></>}
      {tab==='earnings' && <section className="panel"><div className="panel-head"><div><h3>Earnings reports</h3><p>Commission earned during the reporting period—not necessarily paid yet.</p></div><div className="head-actions"><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="month">Selected month</option><option value="year">Selected year</option><option value="all">All records</option></select><button className="primary small" onClick={()=>{setEditing(null);setTab('add-earning')}}>＋ Add report</button></div></div><div className="table-wrap"><table><thead><tr><th>Platform</th><th>Reporting period</th><th>Bank received</th><th>Gross</th><th>Tax</th><th>Net earned</th><th></th></tr></thead><tbody>{filteredEarnings.map(x=><tr key={x.id}><td><Badge>{x.platform}</Badge></td><td>{x.periodStart} → {x.periodEnd}</td><td>{x.paymentReceivedDate||'—'}</td><td>{money(x.gross)}</td><td>{money(x.tax)}</td><td className="strong">{money(x.net)}</td><td><button className="icon-btn" onClick={()=>editEarning(x)}>Edit</button><button className="icon-btn danger" onClick={()=>remove('earnings',x.id)}>Delete</button></td></tr>)}{!filteredEarnings.length&&<Empty col={7} text="No earnings reports in this view yet."/ >}</tbody></table></div></section>}
      {tab==='payouts' && <section className="panel"><div className="panel-head"><div><h3>Payout history</h3><p>Record deposits separately to avoid counting them as new earnings.</p></div><button className="primary small" onClick={()=>{setEditing(null);setTab('add-payout')}}>＋ Add payout</button></div><div className="table-wrap"><table><thead><tr><th>Platform</th><th>Payout date</th><th>Amount received</th><th>Reference</th><th>Related period</th><th></th></tr></thead><tbody>{data.payouts.map(x=><tr key={x.id}><td><Badge>{x.platform}</Badge></td><td>{x.payoutDate}</td><td className="strong">{money(x.amount)}</td><td>{x.reference||'—'}</td><td>{x.relatedPeriod||'—'}</td><td><button className="icon-btn" onClick={()=>editPayout(x)}>Edit</button><button className="icon-btn danger" onClick={()=>remove('payouts',x.id)}>Delete</button></td></tr>)}{!data.payouts.length&&<Empty col={6} text="No payouts recorded yet."/ >}</tbody></table></div></section>}
      {tab==='add-earning' && <section className="panel form-panel"><div className="panel-head"><div><h3>{editing?'Edit earnings report':'Add earnings report'}</h3><p>Use the platform's actual reporting dates, even if you're entering the report late.</p></div></div><form onSubmit={saveEarning} className="form-grid"><Field label="Platform"><select value={earnForm.platform} onChange={e=>setEarnForm({...earnForm,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></Field><Field label="Report type"><select value={earnForm.reportType} onChange={e=>setEarnForm({...earnForm,reportType:e.target.value})}><option>Weekly</option><option>Monthly</option><option>Custom</option></select></Field><Field label="Period start"><input type="date" required value={earnForm.periodStart} onChange={e=>setEarnForm({...earnForm,periodStart:e.target.value})}/></Field><Field label="Period end"><input type="date" required value={earnForm.periodEnd} onChange={e=>setEarnForm({...earnForm,periodEnd:e.target.value})}/></Field><Field label="Payment received in bank (optional)"><input type="date" value={earnForm.paymentReceivedDate} onChange={e=>setEarnForm({...earnForm,paymentReceivedDate:e.target.value})}/></Field><Field label="Gross commission (₱)"><input type="number" min="0" step="0.01" required value={earnForm.gross} onChange={e=>setEarnForm({...earnForm,gross:e.target.value})}/></Field><Field label="Withholding tax (₱)"><input type="number" min="0" step="0.01" value={earnForm.tax} onChange={e=>setEarnForm({...earnForm,tax:e.target.value})}/></Field><Field label="Adjustments (₱)"><input type="number" step="0.01" value={earnForm.adjustments} onChange={e=>setEarnForm({...earnForm,adjustments:e.target.value})}/></Field><Field label="Net commission (calculated)"><div className="calculated">{money(Number(earnForm.gross||0)-Number(earnForm.tax||0)+Number(earnForm.adjustments||0))}</div></Field><Field label="Notes / report reference" wide><input value={earnForm.notes} onChange={e=>setEarnForm({...earnForm,notes:e.target.value})} placeholder="Optional reference or notes"/></Field><div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEditing(null);setTab('earnings')}}>Cancel</button><button className="primary">{editing?'Save changes':'Save earnings report'}</button></div></form></section>}
      {tab==='add-payout' && <section className="panel form-panel"><div className="panel-head"><div><h3>{editing?'Edit payout':'Record a payout'}</h3><p>Enter the date the money actually reached your account.</p></div></div><form onSubmit={savePayout} className="form-grid"><Field label="Platform"><select value={payForm.platform} onChange={e=>setPayForm({...payForm,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></Field><Field label="Payout date"><input type="date" required value={payForm.payoutDate} onChange={e=>setPayForm({...payForm,payoutDate:e.target.value})}/></Field><Field label="Amount received (₱)"><input type="number" min="0.01" step="0.01" required value={payForm.amount} onChange={e=>setPayForm({...payForm,amount:e.target.value})}/></Field><Field label="Transaction reference"><input value={payForm.reference} onChange={e=>setPayForm({...payForm,reference:e.target.value})}/></Field><Field label="Related earnings period (optional)"><input placeholder="e.g. 2026-10-01 to 2026-10-31" value={payForm.relatedPeriod} onChange={e=>setPayForm({...payForm,relatedPeriod:e.target.value})}/></Field><Field label="Notes"><input value={payForm.notes} onChange={e=>setPayForm({...payForm,notes:e.target.value})}/></Field><div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEditing(null);setTab('payouts')}}>Cancel</button><button className="primary">{editing?'Save changes':'Save payout'}</button></div></form></section>}
      {tab==='settings' && <section className="panel form-panel"><div className="panel-head"><div><h3>Settings & data</h3><p>Your records are stored in this browser using local storage.</p></div></div><div className="settings-block"><label>Monthly earnings target (₱)</label><input type="number" min="0" value={data.target} onChange={e=>setData(d=>({...d,target:Number(e.target.value)}))}/><p className="muted">Used for the monthly goal indicator on the Overview page.</p></div><div className="settings-block"><h4>Backup & restore</h4><p className="muted">Export a JSON backup regularly. CSV export is useful for spreadsheets and bookkeeping.</p><div className="button-row"><button className="primary" onClick={backupJson}>Download JSON backup</button><button className="secondary" onClick={exportAll}>Export CSV</button><label className="secondary file-label">Restore JSON backup<input type="file" accept="application/json,.json" onChange={importBackup}/></label></div></div><div className="warning-box"><strong>Important</strong><p>This version stores data in the current browser on this device. Clearing browser storage can erase your records. Keep JSON backups somewhere safe. Cross-device sync and live Google Sheets integration are not enabled yet.</p></div><div className="settings-block"><h4>Data totals</h4><p>{data.earnings.length} earnings reports · {data.payouts.length} payouts · {money(data.earnings.reduce((s,x)=>s+Number(x.net||0),0))} lifetime net commission</p></div></section>}
      <footer>Side Hustle Income Tracker <span>•</span> Local-first · PHP currency</footer>
    </main>
  </div>;
}

function Kpi({label,value,hint}) { return <div className="kpi"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function Badge({children}) { return <span className="badge">{children}</span>; }
function Field({label,children,wide}) { return <label className={'field'+(wide?' wide':'')}><span>{label}</span>{children}</label>; }
function Empty({col,text}) { return <tr><td colSpan={col} className="empty">{text}</td></tr>; }

export default App;
