// src/hooks/useDB.jsx
// ─────────────────────────────────────────────────────────────
// Hook يُشغَّل مرة واحدة عند بدء التطبيق
// - يجلب من PostgreSQL (قراءة فقط، لا يمسح localStorage الفارغ)
// - يعرض شارة الحالة
//
// Phase 4A: مسار json-server الاحتياطي أُزيل بالكامل (loadFromDB لم يعد موجوداً —
// كان بلا أي مستهلك آخر). فشل loadFromPostgres يعني الآن "offline" مباشرة، بلا محاولة
// ثانية على backend قديم — localStorage/Zustand الحاليان يبقيان كما هما دون أي تغيير.
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useAppStore }         from '../store/app.store';
import { loadFromPostgres } from '../store/db.middleware';

export function useDB() {
  const [status, setStatus] = useState('checking'); // checking | connected | partial | offline

  useEffect(() => {
    let mounted = true;

    async function init() {
      setStatus('checking');
      // Phase 1: جرّب PostgreSQL (قراءة فقط، لا يمسح localStorage الفارغ)
      const pg = await loadFromPostgres((updater) => {
        useAppStore.setState(updater);
      });
      if (!mounted) return;
      if (!pg.ok) {
        setStatus('offline');
        return;
      }
      // Phase 4A: نجح health check لكن فشل جلب collection واحدة أو أكثر تحديداً —
      // حالة مختلفة عن "متصل بالكامل"، لا نخلطها بها.
      setStatus(pg.failed?.length > 0 ? 'partial' : 'connected');
    }

    init();
    return () => { mounted = false; };
  }, []);

  return status;
}

// ── DB Status Badge component ─────────────────────────────────
export function DBStatusBadge({ status }) {
  const config = {
    checking:  { label:'جاري الاتصال...',      color:'#f59e0b', bg:'rgba(245,158,11,.1)',  dot:'#f59e0b' },
    connected: { label:'DB متصل ✓',             color:'#10b981', bg:'rgba(16,185,129,.1)', dot:'#10b981' },
    // Phase 4A: قراءة جزئية — الاتصال بقاعدة البيانات نجح، لكن فشل جلب collection واحدة
    // أو أكثر تحديداً (شبكة/مهلة) وليس لأنها فارغة فعلاً — تمييز متعمَّد عن "متصل" الكامل.
    partial:   { label:'DB قراءة جزئية ⚠',      color:'#f59e0b', bg:'rgba(245,158,11,.1)', dot:'#f59e0b' },
    offline:   { label:'DB غير متصل',           color:'#ef4444', bg:'rgba(239,68,68,.1)',  dot:'#ef4444' },
  };
  const meta = config[status] || config.offline;
  const title = status === 'offline'
    ? 'تعذّر الاتصال بقاعدة البيانات — يُستخدَم آخر نسخة محلية محفوظة'
    : status === 'partial'
      ? 'تعذّر جلب بعض البيانات من الخادم — يُستخدَم آخر نسخة محلية محفوظة لها فقط'
      : 'متصل بقاعدة البيانات';

  return (
    <div title={title}
      style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:meta.bg, color:meta.color, border:`1px solid ${meta.color}30`, cursor:'default' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:meta.dot, animation:status==='checking'?'pulse 1s infinite':status==='connected'?'none':'none' }}/>
      {meta.label}
    </div>
  );
}
