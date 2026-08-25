// src/modules/treasury/TreasuryPage.jsx — Multi-Cashbox Architecture V2
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppStore }      from '../../store/app.store';
import { useAuth }          from '../../store/auth.context';
import { SectionBoundary }  from '../../components/ErrorBoundary';
import { Modal } from '../../components/ui/Modal';
import Button               from '../../components/ui/Button';
import { useToast }         from '../../components/Toast';
import { useErrorHandler }  from '../../hooks/useErrorHandler';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { INITIAL_CASHBOXES } from '../../data/initialData';
import {
  CASHBOX_TYPES, validateCashbox, createCashbox,
  validateTxn, validateTransfer, buildCashboxTxn,
  getCashboxBalance, getRunningBalance, getSystemOverview, getTotalBalance,
  getCashboxStats, getIncomeByCategory, getExpenseByCategory,
} from '../../services/cashboxService';
import {
  INCOME_CATEGORIES, EXPENSE_CATEGORIES, ALL_CATEGORIES, PAYMENT_METHODS,
} from '../../services/treasuryService';
import {
  pgCreateCashbox, pgUpdateCashbox,
  pgCreateTreasuryTxn, pgReverseTreasuryTxn, pgTransferBetweenCashboxes,
} from '../../services/api';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const VIEWS = [
  { id:'overview',  icon:'🏦', label:'نظرة عامة'       },
  { id:'ledger',    icon:'📋', label:'كشف الحركات'     },
  { id:'income',    icon:'↑',  label:'الإيرادات'       },
  { id:'expenses',  icon:'↓',  label:'المصروفات'       },
  { id:'transfer',  icon:'⇄',  label:'تحويل بين الخزن' },
  { id:'cashboxes', icon:'⚙',  label:'إدارة الخزن'    },
  { id:'reports',   icon:'📊', label:'التقارير'         },
];

// ─────────────────────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────────────────────
function KPI({ icon, label, value, sub, color='var(--text)', big }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:big?'20px 22px':'16px 18px', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', bottom:-16, left:-8, width:56, height:56, borderRadius:'50%', background:`${color}10`, pointerEvents:'none' }}/>
      <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>{icon} {label}</div>
      <div style={{ fontSize:big?'2rem':'1.55rem', fontWeight:900, color, lineHeight:1, letterSpacing:'-0.5px' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

function CashboxBadge({ cb, selected, onClick, balance }) {
  const typeMeta = CASHBOX_TYPES[cb.type] || CASHBOX_TYPES.main;
  const isSelected = selected;
  return (
    <button onClick={onClick}
      style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderRadius:12, border:`2px solid ${isSelected?(cb.color||typeMeta.color):'var(--border)'}`, background:isSelected?`${cb.color||typeMeta.color}12`:'var(--surface)', cursor:'pointer', transition:'all .15s', textAlign:'right', width:'100%', fontFamily:'Cairo,sans-serif' }}
      onMouseOver={e=>{if(!isSelected){e.currentTarget.style.borderColor=cb.color||typeMeta.color;e.currentTarget.style.background=`${cb.color||typeMeta.color}08`;}}}
      onMouseOut={e =>{if(!isSelected){e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.background='var(--surface)';}}}
    >
      <div style={{ width:38, height:38, borderRadius:10, background:`${cb.color||typeMeta.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.2rem', flexShrink:0 }}>{cb.icon||typeMeta.icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cb.name}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:2 }}>{typeMeta.label}</div>
      </div>
      <div style={{ textAlign:'left', flexShrink:0 }}>
        <div style={{ fontWeight:900, fontSize:'0.92rem', color:balance>=0?'#10b981':'#ef4444' }}>{formatCurrency(balance)}</div>
        {cb.isDefault && <div style={{ fontSize:'0.58rem', color:'var(--accent)', textAlign:'left' }}>افتراضي</div>}
      </div>
    </button>
  );
}

function CategoryBar({ label, icon, color, total, maxTotal }) {
  const pct = maxTotal > 0 ? Math.round(total/maxTotal*100) : 0;
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.78rem', marginBottom:4 }}>
        <span>{icon} {label}</span>
        <span style={{ fontWeight:700, color }}>{formatCurrency(total)}</span>
      </div>
      <div style={{ height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, transition:'width .5s', borderRadius:99 }}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Forms
// ─────────────────────────────────────────────────────────────
const BASE_INP = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl', transition:'border-color .15s' };
const F_ON  = e => e.target.style.borderColor='var(--accent)';
const F_OFF = e => e.target.style.borderColor='var(--border)';

function Field({ label, required, error, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      <label style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em' }}>
        {label}{required&&<span style={{color:'var(--red)',marginRight:3}}>*</span>}
      </label>
      {children}
      {error && <div style={{ fontSize:'0.68rem', color:'var(--red)' }}>⚠ {error}</div>}
    </div>
  );
}

function CashboxSelector({ cashboxes, value, onChange, txns, error, label='الخزنة' }) {
  return (
    <Field label={label} required error={error}>
      <select value={value||''} onChange={e=>onChange(e.target.value)}
        style={{ ...BASE_INP, cursor:'pointer', borderColor:error?'var(--red)':'var(--border)' }}
        onFocus={F_ON} onBlur={F_OFF}>
        <option value="">اختر الخزنة...</option>
        {cashboxes.filter(cb=>cb.active).map(cb => {
          const balance = getCashboxBalance(cb.id, txns, cb.openingBalance);
          const typeMeta = CASHBOX_TYPES[cb.type]||CASHBOX_TYPES.main;
          return (
            <option key={cb.id} value={cb.id}>
              {cb.icon||typeMeta.icon} {cb.name} — {formatCurrency(balance)}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────
// Transaction Form
// ─────────────────────────────────────────────────────────────
function TxnForm({ type, defaultCashboxId, cashboxes, txns, onSubmit, onCancel, loading }) {
  const cats = type==='income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const [form, setForm] = useState({
    cashboxId:   defaultCashboxId || cashboxes.find(cb=>cb.isDefault)?.id || cashboxes[0]?.id || '',
    date:        new Date().toISOString().split('T')[0],
    category:    '',
    description: '',
    amount:      '',
    method:      'cash',
    party:       '',
    notes:       '',
  });
  const [errors, setErrors] = useState({});
  const ch = (k,v) => setForm(p=>({...p,[k]:v}));
  const err = k => errors[k];
  const isEr= k => !!errors[k];

  const selectedCb = cashboxes.find(cb=>cb.id===form.cashboxId);
  const currentBalance = form.cashboxId ? getCashboxBalance(form.cashboxId, txns, selectedCb?.openingBalance||0) : null;

  const handleSubmit = () => {
    const errs = validateTxn({...form, type});
    // Extra: check balance for expenses
    if (type==='expense' && currentBalance!=null && Number(form.amount)>currentBalance) {
      errs.amount = `الرصيد غير كافٍ (المتاح: ${formatCurrency(currentBalance)})`;
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSubmit({ ...form, type, amount:Number(form.amount) });
  };

  const accentColor = type==='income' ? '#10b981' : '#ef4444';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'6px 14px', borderRadius:99, fontSize:'0.82rem', fontWeight:700, background:`${accentColor}15`, color:accentColor, border:`1px solid ${accentColor}30` }}>
        {type==='income'?'↑ إيراد':'↓ مصروف'}
      </div>

      <CashboxSelector cashboxes={cashboxes} value={form.cashboxId} onChange={v=>ch('cashboxId',v)} txns={txns} error={err('cashboxId')}/>

      {form.cashboxId && currentBalance !== null && (
        <div style={{ padding:'8px 12px', borderRadius:9, background:`${currentBalance>=0?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)'}`, border:`1px solid ${currentBalance>=0?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'}`, fontSize:'0.8rem', display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'var(--text3)' }}>الرصيد الحالي للخزنة</span>
          <span style={{ fontWeight:800, color:currentBalance>=0?'#10b981':'#ef4444' }}>{formatCurrency(currentBalance)}</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <Field label="التاريخ" required error={err('date')}>
          <input type="date" value={form.date} onChange={e=>ch('date',e.target.value)}
            style={{...BASE_INP, borderColor:isEr('date')?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}/>
        </Field>
        <Field label="النوع" required error={err('category')}>
          <select value={form.category} onChange={e=>ch('category',e.target.value)}
            style={{...BASE_INP, cursor:'pointer', borderColor:isEr('category')?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}>
            <option value="">اختر...</option>
            {Object.entries(cats).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn:'1/-1' }}>
          <Field label="وصف العملية" required error={err('description')}>
            <input value={form.description} onChange={e=>ch('description',e.target.value)}
              placeholder={type==='income'?'مثال: اشتراك أحمد — مارس':'مثال: إيجار مارس'}
              style={{...BASE_INP, borderColor:isEr('description')?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}/>
          </Field>
        </div>
        <Field label="المبلغ (ج.م)" required error={err('amount')}>
          <input type="number" min="0.01" value={form.amount} onChange={e=>ch('amount',e.target.value)}
            placeholder="0.00"
            style={{...BASE_INP, fontWeight:700, borderColor:isEr('amount')?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}/>
        </Field>
        <Field label="طريقة الدفع">
          <select value={form.method} onChange={e=>ch('method',e.target.value)}
            style={{...BASE_INP, cursor:'pointer'}} onFocus={F_ON} onBlur={F_OFF}>
            {Object.entries(PAYMENT_METHODS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn:'1/-1' }}>
          <Field label="الجهة / المستلم">
            <input value={form.party} onChange={e=>ch('party',e.target.value)}
              placeholder={type==='income'?'اسم الطالب أو الجهة...':'صاحب العقار، اسم المدرس...'}
              style={{...BASE_INP}} onFocus={F_ON} onBlur={F_OFF}/>
          </Field>
        </div>
        <div style={{ gridColumn:'1/-1' }}>
          <Field label="ملاحظات">
            <textarea value={form.notes} onChange={e=>ch('notes',e.target.value)} rows={2}
              style={{...BASE_INP, resize:'vertical', minHeight:60}} onFocus={F_ON} onBlur={F_OFF}/>
          </Field>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}
          style={{ background:accentColor, borderColor:accentColor }}>
          {type==='income'?'↑ تسجيل الإيراد':'↓ تسجيل المصروف'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Transfer Form
// ─────────────────────────────────────────────────────────────
function TransferForm({ cashboxes, txns, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({
    fromCashboxId: '',
    toCashboxId:   '',
    amount:        '',
    date:          new Date().toISOString().split('T')[0],
    description:   'تحويل داخلي',
    method:        'cash',
    notes:         '',
  });
  const [errors, setErrors] = useState({});
  const ch = (k,v) => setForm(p=>({...p,[k]:v}));

  const fromCb = cashboxes.find(cb=>cb.id===form.fromCashboxId);
  const fromBal= form.fromCashboxId ? getCashboxBalance(form.fromCashboxId, txns, fromCb?.openingBalance||0) : null;
  const toCb   = cashboxes.find(cb=>cb.id===form.toCashboxId);
  const toBal  = form.toCashboxId   ? getCashboxBalance(form.toCashboxId,   txns, toCb?.openingBalance||0)   : null;

  const handleSubmit = () => {
    const errs = validateTransfer(form, cashboxes, txns);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSubmit(form);
  };

  const CBSEL = ({ label, field, exclude }) => (
    <Field label={label} required error={errors[field]}>
      <select value={form[field]||''} onChange={e=>ch(field,e.target.value)}
        style={{...BASE_INP, cursor:'pointer', borderColor:errors[field]?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}>
        <option value="">اختر الخزنة...</option>
        {cashboxes.filter(cb=>cb.active && cb.id!==exclude).map(cb=>{
          const bal = getCashboxBalance(cb.id, txns, cb.openingBalance);
          return <option key={cb.id} value={cb.id}>{cb.name} — {formatCurrency(bal)}</option>;
        })}
      </select>
    </Field>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Visual flow */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px', background:'var(--surface2)', borderRadius:12 }}>
        <div style={{ flex:1, padding:'10px 14px', background:'var(--surface)', borderRadius:10, border:'1px solid var(--border)', textAlign:'center' }}>
          <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginBottom:4 }}>من</div>
          <div style={{ fontWeight:700, fontSize:'0.88rem' }}>{fromCb?.name || '—'}</div>
          {fromBal!=null && <div style={{ fontSize:'0.72rem', color:fromBal>=0?'#10b981':'#ef4444', fontWeight:700, marginTop:2 }}>{formatCurrency(fromBal)}</div>}
        </div>
        <div style={{ fontSize:'1.5rem', color:'var(--accent)' }}>→</div>
        <div style={{ flex:1, padding:'10px 14px', background:'var(--surface)', borderRadius:10, border:'1px solid var(--border)', textAlign:'center' }}>
          <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginBottom:4 }}>إلى</div>
          <div style={{ fontWeight:700, fontSize:'0.88rem' }}>{toCb?.name || '—'}</div>
          {toBal!=null && <div style={{ fontSize:'0.72rem', color:toBal>=0?'#10b981':'#ef4444', fontWeight:700, marginTop:2 }}>{formatCurrency(toBal)}</div>}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <CBSEL label="من الخزنة"  field="fromCashboxId" exclude={form.toCashboxId}/>
        <CBSEL label="إلى الخزنة" field="toCashboxId"   exclude={form.fromCashboxId}/>
        <Field label="المبلغ (ج.م)" required error={errors.amount}>
          <input type="number" min="0.01" value={form.amount} onChange={e=>ch('amount',e.target.value)}
            placeholder="0.00" style={{...BASE_INP, fontWeight:700, borderColor:errors.amount?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}/>
        </Field>
        <Field label="التاريخ">
          <input type="date" value={form.date} onChange={e=>ch('date',e.target.value)} style={{...BASE_INP}} onFocus={F_ON} onBlur={F_OFF}/>
        </Field>
        <div style={{ gridColumn:'1/-1' }}>
          <Field label="ملاحظات">
            <input value={form.notes} onChange={e=>ch('notes',e.target.value)} placeholder="سبب التحويل..." style={{...BASE_INP}} onFocus={F_ON} onBlur={F_OFF}/>
          </Field>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>⇄ تنفيذ التحويل</Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ledger Table
// ─────────────────────────────────────────────────────────────
function LedgerTable({ txns, onReverse }) {
  const [search,   setSearch]   = useState('');
  const [typeF,    setTypeF]    = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'6px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem', outline:'none', cursor:'pointer', direction:'rtl' };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return txns.filter(t =>
      (!typeF    || t.type===typeF) &&
      (!dateFrom || t.date>=dateFrom) &&
      (!dateTo   || t.date<=dateTo) &&
      (!q || t.description?.toLowerCase().includes(q) || t.party?.toLowerCase().includes(q))
    );
  }, [txns, search, typeF, dateFrom, dateTo]);

  return (
    <div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        <div style={{ flex:1, minWidth:180, display:'flex', alignItems:'center', gap:7, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 10px' }}
          onFocusCapture={e=>e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e =>e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.8rem', padding:'8px 0', direction:'rtl' }}/>
        </div>
        <select style={SEL} value={typeF} onChange={e=>setTypeF(e.target.value)}>
          <option value="">كل العمليات</option>
          <option value="income">إيرادات</option>
          <option value="expense">مصروفات</option>
        </select>
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={SEL}/>
        <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   style={SEL}/>
        {(search||typeF||dateFrom||dateTo) && (
          <button onClick={()=>{setSearch('');setTypeF('');setDateFrom('');setDateTo('');}}
            style={{...SEL,cursor:'pointer',color:'var(--text3)'}}>× مسح</button>
        )}
      </div>
      <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginBottom:8 }}>{filtered.length} حركة</div>
      <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
        <div style={{ maxHeight:500, overflowY:'auto', overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead style={{ position:'sticky', top:0, zIndex:1 }}>
              <tr style={{ background:'var(--surface2)' }}>
                {['التاريخ','النوع','الوصف','الجهة','المبلغ','الرصيد','الحالة',''].map(h=>(
                  <th key={h} style={{ padding:'9px 14px', fontSize:'0.63rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr><td colSpan={8} style={{ padding:'40px', textAlign:'center', color:'var(--text3)' }}>
                  <div style={{ fontSize:32, opacity:.3, marginBottom:8 }}>📋</div>لا توجد حركات
                </td></tr>
              ) : filtered.map((tx,i) => {
                const isInc = tx.type==='income';
                const catMeta = ALL_CATEGORIES[tx.category] || { icon:'💰', color:'var(--text3)', label:tx.category };
                // Phase 3B-14B: قرار Decision 1 المعتمَد — الحالة تبقى active/cancelled
                // فقط، مطابقةً لـ chk_treasury_status حرفياً؛ pending/rejected متقاعدة.
                const isReversed = tx.status==='cancelled';
                return (
                  <tr key={tx.id}
                    style={{ background:i%2===0?'':'var(--surface2)', opacity:isReversed?.5:1, transition:'background .1s' }}
                    onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                    onMouseOut={e =>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                  >
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)', color:'var(--text3)', fontSize:'0.76rem', whiteSpace:'nowrap' }}>{formatDate(tx.date,{month:'short',day:'numeric',year:'2-digit'})}</td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ fontSize:'0.68rem', fontWeight:700, padding:'2px 8px', borderRadius:99, background:isInc?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)', color:isInc?'#10b981':'#ef4444' }}>
                        {isInc?'↑ إيراد':'↓ مصروف'}
                      </span>
                      <div style={{ fontSize:'0.62rem', color:catMeta.color, marginTop:2 }}>{catMeta.icon} {catMeta.label}</div>
                    </td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)', fontWeight:600, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {tx.description}
                      {tx.notes && <div style={{ fontSize:'0.62rem', color:'var(--text3)', fontWeight:400 }}>{tx.notes}</div>}
                    </td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.76rem', color:'var(--text2)' }}>{tx.party||'—'}</td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                      <span style={{ fontWeight:900, fontSize:'0.9rem', color:isInc?'#10b981':'#ef4444', textDecoration:isReversed?'line-through':'none' }}>
                        {isInc?'+':'-'}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                      <span style={{ fontWeight:700, fontSize:'0.8rem', color:tx.balance>=0?'var(--text)':'#ef4444' }}>
                        {tx.balance!==undefined ? formatCurrency(tx.balance) : '—'}
                      </span>
                    </td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ fontSize:'0.65rem', fontWeight:700, padding:'2px 8px', borderRadius:99,
                        background:{active:'rgba(16,185,129,.1)',cancelled:'rgba(239,68,68,.1)'}[tx.status]||'var(--surface3)',
                        color:{active:'#10b981',cancelled:'#ef4444'}[tx.status]||'var(--text3)',
                      }}>{({active:'نشط',cancelled:'معكوس'})[tx.status]||tx.status}</span>
                    </td>
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid var(--border)' }}>
                      {tx.status==='active' && !tx.refType && onReverse && (
                        <button onClick={()=>onReverse(tx)}
                          style={{ padding:'3px 8px', borderRadius:6, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.06)', fontSize:'0.68rem', cursor:'pointer', color:'var(--red)', fontFamily:'Cairo,sans-serif' }}
                          onMouseOver={e=>{e.currentTarget.style.background='var(--red)';e.currentTarget.style.color='#fff';}}
                          onMouseOut={e =>{e.currentTarget.style.background='rgba(239,68,68,.06)';e.currentTarget.style.color='var(--red)';}}>
                          ↩ عكس
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════

// Product Completion Phase 1 — Issue 2 (Option A): a fresh install has zero real
// cashboxes in Postgres, but INITIAL_CASHBOXES already seeds a local-only 'cb_main' that
// looks usable — so payments.js's tx.cashboxes.findUnique(...) rejects the very first
// payment, late, after the whole form was filled. This completes the already-documented
// original intent (see the PRESERVE_CLIENT_ID_COLLECTIONS comment in api.js) by syncing
// that exact seed row to Postgres once, background, on first TreasuryPage mount.
//
// Module-level (not component-state) guard: survives every remount as the user navigates
// away from/back to Treasury within the same session, so the attempt fires at most once
// per app load — a plain per-mount effect would refire the POST on every visit. A fresh
// page reload resets it, which is safe: pgCreateCashbox's 409-on-conflict is treated as
// success below, so a repeat attempt after reload never creates a duplicate row.
let cashboxSyncAttempted = false;

async function syncSeedCashboxOnce() {
  if (cashboxSyncAttempted) return;
  cashboxSyncAttempted = true;
  const seed = INITIAL_CASHBOXES.find((cb) => cb.id === 'cb_main');
  if (!seed) return;
  try {
    await pgCreateCashbox(seed);
  } catch {
    // 409 (already exists — a prior sync, or another browser, won) is the expected steady
    // state and is treated as success. Any other failure (network, etc.) is swallowed too,
    // by design (Issue 2, Option A) — the existing "no active cashbox" empty-state message
    // in PaymentForm.jsx remains the correct, honest fallback; this background step must
    // never surface a confusing error of its own.
  }
}

// Test-only: the guard above is intentionally module-level (not component state) so it
// survives remounts within one real app session — but that makes it persist across `it()`
// blocks in the same test file too. Exported so tests can make each case deterministic
// instead of depending on execution order.
export function __resetCashboxSyncGuardForTests() {
  cashboxSyncAttempted = false;
}

export default function TreasuryPage() {
  const cashboxes             = useAppStore(s => s.cashboxes);
  const addCashbox            = useAppStore(s => s.addCashbox);
  const updateCashbox         = useAppStore(s => s.updateCashbox);
  const removeCashbox         = useAppStore(s => s.removeCashbox);
  const setDefaultCashbox     = useAppStore(s => s.setDefaultCashbox);
  const treasuryTxn           = useAppStore(s => s.treasuryTxn);
  const addTreasuryTxn        = useAppStore(s => s.addTreasuryTxn);
  const updateTreasuryTxn     = useAppStore(s => s.updateTreasuryTxn);
  const { currentUser }       = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [view,          setView]         = useState('overview');
  const [selectedCbId,  setSelectedCbId] = useState(() => cashboxes.find(cb=>cb.isDefault)?.id || cashboxes[0]?.id);
  const [modal,         setModal]        = useState({ type:null });
  const [reverseModal,  setReverseModal] = useState({ open:false, txn:null });
  // Phase 3B-14B: سبب العكس يُدخله المستخدم صراحةً الآن — لا نص ثابت بعد الآن.
  const [reverseReason, setReverseReason]= useState('');
  const [reverseError,  setReverseError] = useState('');
  const [cbModal,       setCbModal]      = useState({ open:false, cb:null });

  // Issue 2, Option A — see syncSeedCashboxOnce above for the full rationale/guard.
  useEffect(() => { syncSeedCashboxOnce(); }, []);

  const defaultCbId = useMemo(() => cashboxes.find(cb=>cb.isDefault)?.id||cashboxes[0]?.id, [cashboxes]);

  // ── Computed balances ───────────────────────────────────────
  const overview = useMemo(() => getSystemOverview(cashboxes, treasuryTxn), [cashboxes, treasuryTxn]);
  const totalBalance = useMemo(() => getTotalBalance(cashboxes, treasuryTxn), [cashboxes, treasuryTxn]);

  // ── Selected cashbox txns with running balance ───────────────
  const selectedTxnsWithBalance = useMemo(() => {
    const cb = cashboxes.find(x=>x.id===selectedCbId);
    if (!cb) return [];
    return getRunningBalance(selectedCbId, treasuryTxn, cb.openingBalance);
  }, [selectedCbId, cashboxes, treasuryTxn]);

  // ── All txns (for overview / reports) ───────────────────────
  const allActiveTxns = useMemo(() => treasuryTxn.filter(t=>t.status==='active'), [treasuryTxn]);

  // ── Save transaction ─────────────────────────────────────────
  // Phase 3B-14B: خادم-الحقيقة-أولاً — لا تعديل محلي قبل نجاح pgCreateTreasuryTxn.
  // buildCashboxTxn تبني الجسم فقط (تقليم/تطبيع الحقول كالسابق تماماً) — لا تُستخدَم
  // لإضافة أي شيء للـ state محلياً قبل النجاح. id/status/createdAt/balance المحلية
  // فيها كلها إما تُتجاهَل (لا عمود مطابق) أو تُستبدَل خادمياً (id→UUID، created_by من
  // الجلسة — انظر treasuryTxn.js) بغضّ النظر عمّا يصل في الجسم.
  const handleSaveTxn = useCallback(async (formData) => {
    await run(async () => {
      const body = buildCashboxTxn(formData, currentUser?.id);
      const saved = await pgCreateTreasuryTxn(body);
      addTreasuryTxn(saved);
      toast.success(`تم تسجيل ${formData.type==='income'?'الإيراد':'المصروف'} ✓`);
      setModal({ type:null });
    }, { errorMsg:'فشل تسجيل العملية' });
  }, [addTreasuryTxn, currentUser, run, toast]);

  // ── Transfer ─────────────────────────────────────────────────
  // Phase 3B-14B: نداء ذرّي واحد (POST /api/treasuryTxn/transfer) — كلا الحركتين معاً
  // أو لا شيء، لا يمكن أن يترك زوجاً ناقصاً أبداً. لا تعديل محلي قبل النجاح.
  const handleTransfer = useCallback(async (formData) => {
    await run(async () => {
      const fromCb = cashboxes.find(cb=>cb.id===formData.fromCashboxId);
      const toCb   = cashboxes.find(cb=>cb.id===formData.toCashboxId);
      const { outTxn, inTxn } = await pgTransferBetweenCashboxes(formData);
      addTreasuryTxn(outTxn);
      addTreasuryTxn(inTxn);
      toast.success(`تم تحويل ${formatCurrency(formData.amount)} من ${fromCb?.name} إلى ${toCb?.name} ✓`);
      setView('ledger');
    }, { errorMsg:'فشل تنفيذ التحويل' });
  }, [cashboxes, addTreasuryTxn, run, toast]);

  // ── Reverse ──────────────────────────────────────────────────
  // Phase 3B-14B: نداء ذرّي واحد (PUT /api/treasuryTxn/:id/reverse) — يعيد {original,
  // reversal} معاً؛ نتبنّى كليهما بعد النجاح فقط (updateTreasuryTxn/addTreasuryTxn، لا
  // reverseTreasuryTxn المحلي القديم — ذاك يبقى محجوزاً لمسار PaymentsPage.jsx وحده
  // (reverseLinkedTxn)، خارج نطاق 3B-14B تماماً، ولم يُمَسّ). السبب يأتي من المستخدم
  // فعلياً الآن، لا نص ثابت.
  const handleReverse = useCallback(async () => {
    const txn = reverseModal.txn;
    if (!reverseReason.trim()) { setReverseError('سبب العكس مطلوب'); return; }
    await run(async () => {
      const { original, reversal } = await pgReverseTreasuryTxn(txn.id, reverseReason.trim());
      updateTreasuryTxn(txn.id, original);
      addTreasuryTxn(reversal);
      toast.info(`تم عكس العملية: ${txn.description}`);
      setReverseModal({ open:false, txn:null });
      setReverseReason('');
      setReverseError('');
    }, { errorMsg:'فشل عكس العملية' });
  }, [reverseModal.txn, reverseReason, updateTreasuryTxn, addTreasuryTxn, run, toast]);

  // ── Cashbox form ─────────────────────────────────────────────
  const [cbForm, setCbForm] = useState({ name:'', type:'main', openingBalance:0, color:'#0d9488', icon:'🏦', notes:'', active:true });
  const [cbErrors, setCbErrors] = useState({});

  // Phase 3B-14A: خادم-الحقيقة-أولاً — لا تعديل محلي قبل نجاح pgCreateCashbox/
  // pgUpdateCashbox؛ عند النجاح تُعتمَد استجابة الخادم كاملة (شكل createCashbox يطابق
  // أعمدة الجدول تماماً — لا حقول محلية إضافية بلا عمود، فلا حاجة لدمج انتقائي).
  const handleSaveCashbox = async () => {
    await run(async () => {
      const errors = validateCashbox(cbForm);
      if (Object.keys(errors).length) { setCbErrors(errors); return; }
      if (cbModal.cb) {
        const localUpdated = { ...cbModal.cb, ...cbForm };
        const saved = await pgUpdateCashbox(cbModal.cb.id, localUpdated);
        updateCashbox(cbModal.cb.id, saved);
        toast.success('تم تحديث الخزنة ✓');
      } else {
        const localCb = createCashbox(cbForm);
        const saved = await pgCreateCashbox(localCb);
        addCashbox(saved);
        toast.success(`تمت إضافة خزنة "${cbForm.name}" ✓`);
      }
      setCbModal({ open:false, cb:null });
      setCbForm({ name:'', type:'main', openingBalance:0, color:'#0d9488', icon:'🏦', notes:'', active:true });
      setCbErrors({});
    }, { errorMsg:'فشل حفظ الخزنة' });
  };

  const selectedCb = cashboxes.find(cb=>cb.id===selectedCbId);
  const selectedBalance = selectedCb ? getCashboxBalance(selectedCbId, treasuryTxn, selectedCb.openingBalance) : 0;

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:900, letterSpacing:'-0.4px', marginBottom:3 }}>الخزنة والمالية</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
            {cashboxes.filter(cb=>cb.active).length} خزنة · إجمالي الرصيد:
            <span style={{ fontWeight:900, color:totalBalance>=0?'#10b981':'#ef4444', marginRight:4 }}>{formatCurrency(totalBalance)}</span>
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Button size="sm" variant="secondary" onClick={()=>setModal({type:'expense'})}
            style={{ background:'rgba(239,68,68,.1)', borderColor:'rgba(239,68,68,.2)', color:'#ef4444' }}>
            ↓ مصروف
          </Button>
          <Button size="sm" variant="primary" onClick={()=>setModal({type:'income'})}
            style={{ background:'#10b981', borderColor:'#10b981' }}>
            ↑ إيراد
          </Button>
        </div>
      </div>

      {/* View tabs */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:20, flexWrap:'wrap' }}>
        {VIEWS.map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, fontSize:'0.85rem', fontWeight:view===v.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:`1.5px solid ${view===v.id?'var(--accent)':'var(--border)'}`, background:view===v.id?'rgba(13,148,136,.1)':'transparent', color:view===v.id?'var(--accent)':'var(--text2)', whiteSpace:'nowrap' }}
            onMouseOver={e=>{if(view!==v.id){e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)';}}}
            onMouseOut={e =>{if(view!==v.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';}}}
          >{v.icon} {v.label}</button>
        ))}
      </div>

      <div style={{ padding:'0 28px 60px', display:'flex', gap:20 }}>

        {/* ── Sidebar: cashbox list (show always except on cashboxes manage tab) ── */}
        {view !== 'cashboxes' && (
          <div style={{ width:240, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>الخزن</div>
            {overview.map(cb=>(
              <CashboxBadge key={cb.id} cb={cb} selected={selectedCbId===cb.id} balance={cb.balance}
                onClick={()=>setSelectedCbId(cb.id)}/>
            ))}
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.78rem', padding:'6px 8px' }}>
                <span style={{ color:'var(--text3)' }}>الإجمالي</span>
                <span style={{ fontWeight:900, color:totalBalance>=0?'#10b981':'#ef4444' }}>{formatCurrency(totalBalance)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────── */}
        <div style={{ flex:1, minWidth:0 }}>
          <SectionBoundary label={`treasury:${view}`}>

            {/* ═══ OVERVIEW ═══ */}
            {view==='overview' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                {/* Selected cashbox header */}
                {selectedCb && (
                  <div style={{ display:'flex', alignItems:'center', gap:14, padding:'16px 18px', background:'var(--surface)', border:`2px solid ${selectedCb.color||'var(--accent)'}30`, borderRadius:14 }}>
                    <div style={{ width:48, height:48, borderRadius:12, background:`${selectedCb.color||'#0d9488'}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.4rem', flexShrink:0 }}>{selectedCb.icon||'🏦'}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:800, fontSize:'1.05rem' }}>{selectedCb.name}</div>
                      <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{CASHBOX_TYPES[selectedCb.type]?.label||selectedCb.type}</div>
                    </div>
                    <div style={{ textAlign:'left' }}>
                      <div style={{ fontSize:'1.8rem', fontWeight:900, color:selectedBalance>=0?'#10b981':'#ef4444', lineHeight:1 }}>{formatCurrency(selectedBalance)}</div>
                      <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:4, textAlign:'left' }}>الرصيد الحالي</div>
                    </div>
                  </div>
                )}

                {/* KPIs for selected cashbox */}
                {selectedCbId && (() => {
                  const stats = getCashboxStats(selectedCbId, treasuryTxn);
                  const cb = cashboxes.find(x=>x.id===selectedCbId);
                  return (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
                      <KPI icon="↑"  label="إجمالي الإيرادات"  value={formatCurrency(stats.income)}  color="#10b981"/>
                      <KPI icon="↓"  label="إجمالي المصروفات"  value={formatCurrency(stats.expense)} color="#ef4444"/>
                      <KPI icon="📊" label="صافي الحركة"        value={formatCurrency(stats.net)}     color={stats.net>=0?'#10b981':'#ef4444'}/>
                      <KPI icon="📋" label="عدد الحركات"        value={stats.count}                   color="var(--text)"/>
                    </div>
                  );
                })()}

                {/* Recent txns for selected cashbox */}
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
                  <div style={{ padding:'13px 18px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div style={{ fontWeight:800, fontSize:'0.88rem' }}>آخر الحركات</div>
                    <button onClick={()=>setView('ledger')} style={{ fontSize:'0.75rem', color:'var(--accent)', background:'none', border:'none', cursor:'pointer', fontFamily:'Cairo,sans-serif', fontWeight:700 }}>عرض الكل →</button>
                  </div>
                  {selectedTxnsWithBalance.slice().reverse().slice(0,7).map(tx=>{
                    const isInc = tx.type==='income';
                    const catMeta = ALL_CATEGORIES[tx.category]||{icon:'💰'};
                    return (
                      <div key={tx.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 18px', borderBottom:'1px solid var(--border)', transition:'background .1s' }}
                        onMouseOver={e=>e.currentTarget.style.background='var(--surface2)'}
                        onMouseOut={e =>e.currentTarget.style.background=''}>
                        <div style={{ width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:'1rem', background:isInc?'rgba(16,185,129,.1)':'rgba(239,68,68,.1)' }}>
                          {catMeta.icon}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:'0.87rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.description}</div>
                          <div style={{ fontSize:'0.68rem', color:'var(--text3)', display:'flex', gap:8, marginTop:1 }}>
                            <span>{formatDate(tx.date,{month:'short',day:'numeric'})}</span>
                            {tx.party && <span>{tx.party}</span>}
                          </div>
                        </div>
                        <div style={{ textAlign:'left', flexShrink:0 }}>
                          <div style={{ fontWeight:900, color:isInc?'#10b981':'#ef4444', fontSize:'0.9rem' }}>{isInc?'+':'-'}{formatCurrency(tx.amount)}</div>
                          <div style={{ fontSize:'0.65rem', color:tx.balance>=0?'var(--text3)':'#ef4444', textAlign:'left' }}>رصيد: {formatCurrency(tx.balance)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ LEDGER ═══ */}
            {view==='ledger' && (
              <LedgerTable txns={selectedTxnsWithBalance} onReverse={tx=>setReverseModal({open:true,txn:tx})}/>
            )}

            {/* ═══ INCOME / EXPENSES ═══ */}
            {(view==='income'||view==='expenses') && (() => {
              const isInc = view==='income';
              const filtered = selectedTxnsWithBalance.filter(t=>t.type===(isInc?'income':'expense') && t.status==='active');
              const total = filtered.reduce((s,t)=>s+t.amount,0);
              const cats = isInc ? getIncomeByCategory(selectedCbId, treasuryTxn, INCOME_CATEGORIES) : getExpenseByCategory(selectedCbId, treasuryTxn, EXPENSE_CATEGORIES);
              const maxCat = Math.max(...cats.map(c=>c.total), 1);
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div style={{ fontSize:'0.9rem', color:'var(--text3)' }}>
                      {filtered.length} حركة · إجمالي:
                      <span style={{ fontWeight:900, color:isInc?'#10b981':'#ef4444', marginRight:4 }}>{formatCurrency(total)}</span>
                    </div>
                    <Button size="sm" variant="primary" onClick={()=>setModal({type:view==='income'?'income':'expense'})}
                      style={isInc?{background:'#10b981',borderColor:'#10b981'}:{background:'#ef4444',borderColor:'#ef4444'}}>
                      {isInc?'↑ إيراد جديد':'↓ مصروف جديد'}
                    </Button>
                  </div>
                  {cats.length>0 && (
                    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
                      <div style={{ fontWeight:700, fontSize:'0.85rem', marginBottom:14 }}>التوزيع حسب النوع</div>
                      {cats.map(c=><CategoryBar key={c.key} {...c} maxTotal={maxCat}/>)}
                    </div>
                  )}
                  <LedgerTable txns={filtered} onReverse={tx=>setReverseModal({open:true,txn:tx})}/>
                </div>
              );
            })()}

            {/* ═══ TRANSFER ═══ */}
            {view==='transfer' && (
              <div style={{ maxWidth:560 }}>
                <div style={{ fontWeight:700, fontSize:'0.9rem', marginBottom:16, color:'var(--text3)' }}>
                  تحويل أموال بين خزنتين — العملية أتوماتيكية وتُسجَّل في كلا الخزنتين
                </div>
                <TransferForm cashboxes={cashboxes} txns={treasuryTxn} onSubmit={handleTransfer} onCancel={()=>setView('overview')} loading={loading}/>
              </div>
            )}

            {/* ═══ CASHBOXES MANAGEMENT ═══ */}
            {view==='cashboxes' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontWeight:700, fontSize:'0.9rem' }}>إدارة الخزن ({cashboxes.length})</div>
                  <Button size="sm" variant="primary" onClick={()=>{setCbModal({open:true,cb:null});setCbForm({name:'',type:'main',openingBalance:0,color:'#0d9488',icon:'🏦',notes:'',active:true});}}>+ إضافة خزنة</Button>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:14 }}>
                  {overview.map(cb=>{
                    const typeMeta = CASHBOX_TYPES[cb.type]||CASHBOX_TYPES.main;
                    return (
                      <div key={cb.id} style={{ background:'var(--surface)', border:`2px solid ${cb.color||typeMeta.color}30`, borderRadius:16, overflow:'hidden', transition:'transform .12s' }}
                        onMouseOver={e=>{e.currentTarget.style.transform='translateY(-2px)';}}
                        onMouseOut={e =>{e.currentTarget.style.transform='';}}
                      >
                        <div style={{ height:4, background:cb.color||typeMeta.color }}/>
                        <div style={{ padding:'16px 18px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                            <div style={{ width:42, height:42, borderRadius:12, background:`${cb.color||typeMeta.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.3rem', flexShrink:0 }}>{cb.icon||typeMeta.icon}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:800 }}>{cb.name}</div>
                              <div style={{ fontSize:'0.7rem', color:'var(--text3)' }}>{typeMeta.label}</div>
                            </div>
                            {cb.isDefault && <span style={{ fontSize:'0.62rem', color:'var(--accent)', background:'rgba(13,148,136,.1)', padding:'2px 8px', borderRadius:99, border:'1px solid rgba(13,148,136,.2)' }}>افتراضي</span>}
                          </div>
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
                            {[
                              {l:'الرصيد', v:formatCurrency(cb.balance), c:cb.balance>=0?'#10b981':'#ef4444'},
                              {l:'إيرادات', v:formatCurrency(cb.income), c:'#10b981'},
                              {l:'مصروفات', v:formatCurrency(cb.expenses), c:'#ef4444'},
                            ].map(s=>(
                              <div key={s.l} style={{ textAlign:'center', background:'var(--surface2)', borderRadius:8, padding:'8px 6px' }}>
                                <div style={{ fontSize:'0.78rem', fontWeight:800, color:s.c }}>{s.v}</div>
                                <div style={{ fontSize:'0.6rem', color:'var(--text3)', marginTop:2 }}>{s.l}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display:'flex', gap:6 }}>
                            <Button variant="ghost" size="sm" style={{ flex:1 }}
                              onClick={()=>{setCbModal({open:true,cb});setCbForm({name:cb.name,type:cb.type,openingBalance:cb.openingBalance,color:cb.color||'#0d9488',icon:cb.icon||'🏦',notes:cb.notes||'',active:cb.active});}}>
                              ✎ تعديل
                            </Button>
                            {!cb.isDefault && (
                              <Button variant="ghost" size="sm"
                                onClick={()=>setDefaultCashbox(cb.id)}>
                                ★ افتراضي
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ REPORTS ═══ */}
            {view==='reports' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                {/* System-wide overview */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
                  <KPI icon="🏦" label="إجمالي رصيد النظام" value={formatCurrency(totalBalance)} color={totalBalance>=0?'#10b981':'#ef4444'} big/>
                  <KPI icon="↑" label="إجمالي الإيرادات" value={formatCurrency(allActiveTxns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0))} color="#10b981"/>
                  <KPI icon="↓" label="إجمالي المصروفات" value={formatCurrency(allActiveTxns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0))} color="#ef4444"/>
                </div>

                {/* Per-cashbox breakdown */}
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {overview.map(cb=>{
                    const stats = getCashboxStats(cb.id, treasuryTxn);
                    const inCats = getIncomeByCategory(cb.id, treasuryTxn, INCOME_CATEGORIES);
                    const exCats = getExpenseByCategory(cb.id, treasuryTxn, EXPENSE_CATEGORIES);
                    const maxI = Math.max(...inCats.map(c=>c.total),1);
                    const maxE = Math.max(...exCats.map(c=>c.total),1);
                    return (
                      <div key={cb.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
                          <span style={{ fontSize:'1.2rem' }}>{cb.icon||'🏦'}</span>
                          <div style={{ fontWeight:800, flex:1 }}>{cb.name}</div>
                          <span style={{ fontWeight:900, color:cb.balance>=0?'#10b981':'#ef4444', fontSize:'1.1rem' }}>{formatCurrency(cb.balance)}</span>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0 }}>
                          <div style={{ padding:'14px 18px', borderLeft:'1px solid var(--border)' }}>
                            <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#10b981', marginBottom:10 }}>↑ الإيرادات — {formatCurrency(stats.income)}</div>
                            {inCats.length>0 ? inCats.map(c=><CategoryBar key={c.key} {...c} maxTotal={maxI}/>) : <div style={{ color:'var(--text3)', fontSize:'0.78rem' }}>لا توجد إيرادات</div>}
                          </div>
                          <div style={{ padding:'14px 18px' }}>
                            <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#ef4444', marginBottom:10 }}>↓ المصروفات — {formatCurrency(stats.expense)}</div>
                            {exCats.length>0 ? exCats.map(c=><CategoryBar key={c.key} {...c} maxTotal={maxE}/>) : <div style={{ color:'var(--text3)', fontSize:'0.78rem' }}>لا توجد مصروفات</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </SectionBoundary>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      <Modal isOpen={modal.type==='income'||modal.type==='expense'} onClose={()=>setModal({type:null})}
        title={modal.type==='income'?'↑ تسجيل إيراد':'↓ تسجيل مصروف'} size="md">
        {(modal.type==='income'||modal.type==='expense') && (
          <TxnForm type={modal.type} defaultCashboxId={selectedCbId||defaultCbId} cashboxes={cashboxes} txns={treasuryTxn} onSubmit={handleSaveTxn} onCancel={()=>setModal({type:null})} loading={loading}/>
        )}
      </Modal>

      {/* Phase 3B-14B: ConfirmModal لا تدعم محتوى مخصّصاً (message ثابت فقط) — Modal
          عادية هنا بدلاً منها، محلياً في هذا الملف فقط، لإضافة حقل السبب المطلوب فعلياً
          الآن دون تعديل المكوّن المشترَك Modal.jsx (تُستخدَم في صفحات أخرى كثيرة). */}
      <Modal isOpen={reverseModal.open}
        onClose={()=>{setReverseModal({open:false,txn:null});setReverseReason('');setReverseError('');}}
        title="تأكيد عكس العملية" size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={()=>{setReverseModal({open:false,txn:null});setReverseReason('');setReverseError('');}}>إلغاء</Button>
            <Button variant="danger" loading={loading} onClick={handleReverse}>نعم، عكس العملية</Button>
          </>
        }
      >
        <div style={{ padding:'8px 0' }}>
          <div style={{ textAlign:'center', marginBottom:16 }}>
            <div style={{ fontSize:36, marginBottom:10 }}>↩️</div>
            <p style={{ fontSize:14, color:'var(--text2)', lineHeight:1.7 }}>
              هل تريد عكس العملية: "{reverseModal.txn?.description}"؟<br/>سيتم إنشاء قيد معاكس بنفس المبلغ.
            </p>
          </div>
          <Field label="سبب العكس" required error={reverseError}>
            <textarea value={reverseReason}
              onChange={e=>{setReverseReason(e.target.value); if (reverseError) setReverseError('');}}
              rows={2} placeholder="مثال: خطأ في القيد، إلغاء العملية..."
              style={{...BASE_INP, resize:'vertical', minHeight:60, borderColor:reverseError?'var(--red)':'var(--border)'}}
              onFocus={F_ON} onBlur={F_OFF} autoFocus/>
          </Field>
        </div>
      </Modal>

      <Modal isOpen={cbModal.open} onClose={()=>setCbModal({open:false,cb:null})}
        title={cbModal.cb?`تعديل — ${cbModal.cb.name}`:'إضافة خزنة جديدة'} size="sm">
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <Field label="اسم الخزنة" required error={cbErrors.name}>
            <input value={cbForm.name} onChange={e=>setCbForm(p=>({...p,name:e.target.value}))}
              placeholder="مثال: الخزنة الرئيسية" style={{...BASE_INP, borderColor:cbErrors.name?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}/>
          </Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <Field label="النوع" required>
              <select value={cbForm.type} onChange={e=>setCbForm(p=>({...p,type:e.target.value,color:CASHBOX_TYPES[e.target.value]?.color||p.color,icon:CASHBOX_TYPES[e.target.value]?.icon||p.icon}))}
                style={{...BASE_INP, cursor:'pointer'}} onFocus={F_ON} onBlur={F_OFF}>
                {Object.entries(CASHBOX_TYPES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </Field>
            <Field label="الرصيد الافتتاحي" error={cbErrors.openingBalance}>
              <input type="number" min="0" value={cbForm.openingBalance} onChange={e=>setCbForm(p=>({...p,openingBalance:Number(e.target.value)}))}
                style={{...BASE_INP, borderColor:cbErrors.openingBalance?'var(--red)':'var(--border)'}} onFocus={F_ON} onBlur={F_OFF}/>
            </Field>
          </div>
          <Field label="ملاحظات">
            <input value={cbForm.notes} onChange={e=>setCbForm(p=>({...p,notes:e.target.value}))}
              placeholder="وصف أو ملاحظات..." style={{...BASE_INP}} onFocus={F_ON} onBlur={F_OFF}/>
          </Field>
          {/* MEDIUM-A Finding 4: تفعيل/تعطيل خزنة موجودة — إنشاء خزنة جديدة يبدأ دائماً
              نشطاً (createCashbox)، فلا حاجة لهذا التبديل عند الإضافة، فقط عند التعديل. */}
          {cbModal.cb && (
            <Field label="الحالة">
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:'0.82rem', color:'var(--text2)' }}>
                <input type="checkbox" checked={cbForm.active} onChange={e=>setCbForm(p=>({...p,active:e.target.checked}))}/>
                خزنة نشطة
              </label>
            </Field>
          )}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
            <Button variant="secondary" onClick={()=>setCbModal({open:false,cb:null})}>إلغاء</Button>
            <Button variant="primary" loading={loading} onClick={handleSaveCashbox}>💾 حفظ</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
