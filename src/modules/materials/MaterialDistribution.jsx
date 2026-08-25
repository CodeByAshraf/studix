// src/modules/materials/MaterialDistribution.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useToast } from '../../components/Toast';
import Button       from '../../components/ui/Button';
import { PAY_STATUS, deriveMatDist } from '../../services/materialService';
import { pgSaveMaterialDistribution, pgGetCollection } from '../../services/api';
import { mergeById, normalizeCollectionForMerge } from '../../store/db.middleware';
import { formatDate, formatCurrency } from '../../utils/helpers';

const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},{bg:'rgba(6,182,212,.18)', color:'#06b6d4'},
];
const av = n => AV_PAL[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%AV_PAL.length];

// ── Single student row ───────────────────────────────────────
function StudentDistRow({ student, dist, material, onChange }) {
  const { bg, color } = av(student.name);
  const letters = student.name.split(' ').map(w=>w[0]).slice(0,2).join('');

  const [localPaid, setLocalPaid] = useState(dist?.paidAmount ?? '');

  const handleReceived = () => {
    const newReceived = !dist?.received;
    onChange(student.id, {
      received:   newReceived,
      receivedAt: newReceived ? new Date().toISOString().split('T')[0] : null,
      payStatus:  dist?.payStatus || 'unpaid',
      paidAmount: dist?.paidAmount || 0,
    });
  };

  const handlePayStatus = (status) => {
    const amount = status === 'paid' ? material.price : status === 'unpaid' ? 0 : (dist?.paidAmount || 0);
    if (status === 'paid') setLocalPaid(material.price);
    if (status === 'unpaid') setLocalPaid(0);
    onChange(student.id, { ...dist, payStatus: status, paidAmount: amount });
  };

  const handlePaidBlur = () => {
    const amount = Number(localPaid) || 0;
    const status = amount === 0 ? 'unpaid' : amount >= material.price ? 'paid' : 'partial';
    onChange(student.id, { ...dist, paidAmount: amount, payStatus: status });
  };

  const received   = dist?.received || false;
  const payMeta    = PAY_STATUS[dist?.payStatus || 'unpaid'];

  return (
    <tr style={{ transition:'background .12s' }}
      onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
      onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
    >
      {/* الطالب */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
          <div>
            <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{student.name}</div>
            <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>{student.grade}</div>
          </div>
        </div>
      </td>

      {/* الاستلام */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)', textAlign:'center' }}>
        <button
          onClick={handleReceived}
          title={received ? 'استلم المذكرة — اضغط للإلغاء' : 'لم يستلم — اضغط للتسجيل'}
          style={{
            width:36, height:36, borderRadius:9, border:'2px solid',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'all .15s',
            borderColor: received ? 'rgba(16,185,129,.4)' : 'var(--border)',
            background:  received ? 'rgba(16,185,129,.12)' : 'transparent',
            fontSize:'1rem', margin:'0 auto',
          }}
          onMouseOver={e => e.currentTarget.style.transform='scale(1.1)'}
          onMouseOut={e  => e.currentTarget.style.transform='scale(1)'}
        >
          {received ? <span style={{ color:'#10b981', fontWeight:900 }}>✓</span> : <span style={{ color:'var(--border)', fontSize:'0.8rem' }}>○</span>}
        </button>
      </td>

      {/* تاريخ الاستلام */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>
        {dist?.receivedAt ? formatDate(dist.receivedAt, {month:'short',day:'numeric'}) : '—'}
      </td>

      {/* حالة الدفع */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', gap:4 }}>
          {Object.entries(PAY_STATUS).map(([k, m]) => (
            <button key={k}
              onClick={() => handlePayStatus(k)}
              style={{
                padding:'3px 9px', borderRadius:7, fontSize:'0.68rem', fontWeight:700,
                cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                border:`1.5px solid ${dist?.payStatus===k ? m.border : 'var(--border)'}`,
                background: dist?.payStatus===k ? m.bg : 'transparent',
                color:      dist?.payStatus===k ? m.color : 'var(--text3)',
              }}
              onMouseOver={e => { if(dist?.payStatus!==k){e.currentTarget.style.background=m.bg;e.currentTarget.style.color=m.color;e.currentTarget.style.borderColor=m.border;} }}
              onMouseOut={e  => { if(dist?.payStatus!==k){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text3)';e.currentTarget.style.borderColor='var(--border)';} }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </td>

      {/* المبلغ المدفوع */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        {material.price > 0 ? (
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <input type="number" min="0" max={material.price}
              value={localPaid}
              onChange={e => setLocalPaid(e.target.value)}
              onBlur={handlePaidBlur}
              placeholder="0"
              style={{ width:60, padding:'5px 8px', textAlign:'center', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:7, color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', fontWeight:700, outline:'none' }}
              onFocus={e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.1)'; }}
            />
            <span style={{ fontSize:'0.68rem', color:'var(--text3)' }}>/ {material.price}</span>
          </div>
        ) : <span style={{ color:'var(--text3)', fontSize:'0.75rem' }}>مجاني</span>}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
export default function MaterialDistribution({ material, onClose }) {
  const groups               = useAppStore((s) => s.groups);
  const inventoryTxn         = useAppStore((s) => s.inventoryTxn);
  const setInventoryTxn      = useAppStore((s) => s.setInventoryTxn);
  const students             = useAppStore((s) => s.students);
  // matDist مُشتَق من inventoryTxn — لا حالة مستقلة بعد الآن.
  const matDist = useMemo(() => deriveMatDist(inventoryTxn), [inventoryTxn]);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [filterGrp, setFilterGrp] = useState('');
  const [search, setSearch] = useState('');

  // Students eligible: same grade as material
  const eligibleStudents = useMemo(() => {
    let list = students.filter(s => s.status === 'active' && s.grade === material.grade);
    if (filterGrp) list = list.filter(s => s.groupId === filterGrp);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q));
    }
    return list;
  }, [students, material.grade, filterGrp, search]);

  const eligibleGroups = useMemo(() =>
    groups.filter(g => eligibleStudents.some(s => s.groupId === g.id)),
  [groups, eligibleStudents]);

  // Local dist map: { [studentId]: dist }
  const [localDist, setLocalDist] = useState(() => {
    const map = {};
    students.filter(s => s.status==='active' && s.grade===material.grade).forEach(s => {
      const existing = matDist.find(d => d.matId === material.id && d.studentId === s.id);
      map[s.id] = existing || { matId:material.id, studentId:s.id, received:false, receivedAt:null, payStatus:'unpaid', paidAmount:0 };
    });
    return map;
  });

  const updateDist = useCallback((studentId, data) => {
    setLocalDist(prev => ({ ...prev, [studentId]: { ...prev[studentId], ...data } }));
  }, []);

  // Mark all received
  const markAllReceived = () => {
    const today = new Date().toISOString().split('T')[0];
    const updated = {};
    eligibleStudents.forEach(s => {
      updated[s.id] = { ...localDist[s.id], received:true, receivedAt:today };
    });
    setLocalDist(prev => ({ ...prev, ...updated }));
  };

  // Stats
  const stats = useMemo(() => {
    const all = Object.values(localDist);
    return {
      total:     students.filter(s=>s.status==='active'&&s.grade===material.grade).length,
      received:  all.filter(d=>d.received).length,
      paid:      all.filter(d=>d.payStatus==='paid').length,
      partial:   all.filter(d=>d.payStatus==='partial').length,
      unpaid:    all.filter(d=>d.payStatus==='unpaid').length,
      collected: all.reduce((s,d)=>s+(d.paidAmount||0),0),
      expected:  all.filter(d=>d.received).length * material.price,
    };
  }, [localDist, students, material]);

  // Phase 3B-12: PostgreSQL هو مصدر الحقيقة الآن — roster كامل يُرسَل لنقطة نهاية
  // مخصّصة واحدة (معاملة ذرّية على الخادم)، لا تعديل محلي إلا بعد نجاحها. لا تغيير على
  // نقطة النهاية أو منطق التسوية/المعاملة/الترقيم/idempotency إطلاقاً.
  //
  // matDist read-path migration: استجابة pgSaveMaterialDistribution بشكل matDist
  // (id/matId/studentId/received/...)، لا بشكل inventoryTxn — ولم يعد matDist حالة
  // مستقلة نتبنّاها مباشرة. بدل ذلك: إعادة جلب inventoryTxn الحقيقية كاملة من الخادم
  // بعد نجاح الحفظ (pgGetCollection، بلا أي تغيير على شكل استجابة نقطة نهاية الحفظ
  // نفسها)، ودمجها بنفس mergeById المُستخدَمة إقلاعياً — لا استبدال شامل، حتى لا تُفقَد
  // أي حركة محلية بحتة من مسار InventoryPage المباشر المنفصل (خارج نطاق هذا التغيير).
  // matDist المشتقّة (أعلاه) تُعاد حسابها تلقائياً بمجرد تحديث inventoryTxn.
  const handleSave = async () => {
    setSaving(true);
    try {
      const records = Object.values(localDist).map(d => ({
        studentId:  d.studentId,
        received:   d.received,
        payStatus:  d.payStatus,
        paidAmount: d.paidAmount,
        receivedAt: d.receivedAt,
      }));
      await pgSaveMaterialDistribution(material.id, records);
      const fresh = await pgGetCollection('inventoryTxn');
      setInventoryTxn((prev) => mergeById(prev, normalizeCollectionForMerge('inventoryTxn', fresh)));
      toast.success(`تم حفظ توزيع "${material.name}" ✓`);
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'فشل حفظ التوزيع — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* Material header */}
      <div style={{ background:'var(--surface2)', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
        <div style={{ fontWeight:800, fontSize:'0.95rem', marginBottom:6 }}>📚 {material.name}</div>
        <div style={{ fontSize:'0.75rem', color:'var(--text3)', display:'flex', gap:14, flexWrap:'wrap' }}>
          <span>{material.subject}</span>
          {material.teacher && <span>👤 {material.teacher}</span>}
          <span>🎓 {material.grade}</span>
          {material.price > 0 && <span style={{ color:'var(--green)', fontWeight:700 }}>💰 {material.price} ج.م</span>}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:16 }}>
        {[
          { l:'إجمالي الطلاب',  v:stats.total,     c:'var(--text)'  },
          { l:'استلموا',         v:stats.received,  c:'#10b981'      },
          { l:'لم يستلموا',     v:stats.total-stats.received, c:'#ef4444' },
          { l:'المحصّل',        v:`${stats.collected} ج`,    c:'var(--green)' },
          { l:'نسبة التحصيل',   v: stats.expected > 0 ? `${Math.round(stats.collected/stats.expected*100)}%` : '—', c:'var(--accent)' },
        ].map(s => (
          <div key={s.l} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 14px', textAlign:'center' }}>
            <div style={{ fontSize:'1.2rem', fontWeight:800, color:s.c, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:4, fontWeight:600 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', color:'var(--text3)', marginBottom:4 }}>
          <span>استلام المذكرة</span>
          <span style={{ fontWeight:700, color:'#10b981', fontFamily:'Cairo,sans-serif' }}>
            {stats.total > 0 ? Math.round(stats.received/stats.total*100) : 0}%
          </span>
        </div>
        <div style={{ height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${stats.total>0?Math.round(stats.received/stats.total*100):0}%`, background:'#10b981', transition:'width .5s' }}/>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, minWidth:180, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 11px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث عن طالب..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
        </div>

        {eligibleGroups.length > 1 && (
          <select style={SEL} value={filterGrp} onChange={e => setFilterGrp(e.target.value)}>
            <option value="">كل المجموعات</option>
            {eligibleGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        <button onClick={markAllReceived}
          style={{ padding:'7px 14px', borderRadius:8, border:'1px solid rgba(16,185,129,.3)', background:'rgba(16,185,129,.08)', color:'#10b981', fontSize:'0.75rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
          onMouseOver={e => e.currentTarget.style.background='rgba(16,185,129,.18)'}
          onMouseOut={e  => e.currentTarget.style.background='rgba(16,185,129,.08)'}
        >
          ✓ تسجيل الكل استلم
        </button>
      </div>

      {/* Table */}
      {eligibleStudents.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, color:'var(--text3)' }}>
          <div style={{ fontSize:36, opacity:.4, marginBottom:8 }}>👥</div>
          <div>لا يوجد طلاب في {material.grade}</div>
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:16, maxHeight:400, overflowY:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead style={{ position:'sticky', top:0, zIndex:1 }}>
              <tr style={{ background:'var(--surface2)' }}>
                {['الطالب','استلم','تاريخ الاستلام','حالة الدفع','المبلغ المدفوع'].map(h => (
                  <th key={h} style={{ padding:'9px 16px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {eligibleStudents.map(s => (
                <StudentDistRow
                  key={s.id}
                  student={s}
                  dist={localDist[s.id]}
                  material={material}
                  onChange={updateDist}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:'0.8rem', color:'var(--text2)' }}>
          استلم <span style={{ color:'#10b981', fontWeight:700 }}>{stats.received}</span> ·{' '}
          مدفوع <span style={{ color:'#10b981', fontWeight:700 }}>{stats.paid}</span> ·{' '}
          جزئي <span style={{ color:'#f59e0b', fontWeight:700 }}>{stats.partial}</span> ·{' '}
          محصّل <span style={{ color:'var(--green)', fontWeight:700 }}>{formatCurrency(stats.collected)}</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="secondary" onClick={onClose}>إغلاق</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>💾 حفظ التوزيع</Button>
        </div>
      </div>
    </div>
  );
}
