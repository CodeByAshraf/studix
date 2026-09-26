// src/modules/settings/SettingsPage.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth }     from '../../store/auth.context';
import { useUI   }     from '../../store/ui.context';
import { useAppStore } from '../../store/app.store';
import { THEMES }      from '../../constants/theme';
import { PageHeader }  from '../../components/shared';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { ConfirmModal } from '../../components/ui/Modal';
import { useToast } from '../../components/Toast';
import {
  pgCheckHealth, pgUpdateCenterProfile, pgTriggerDatabaseSwitch, pgGetDatabaseIdentity,
} from '../../services/api';
import { checkDatabaseIdentityAndInvalidate } from '../../store/dbIdentity';
import ReportSettingsSection from './ReportSettingsSection';
import DatabaseBackupSection from './DatabaseBackupSection';

// ── حالة الاتصال: نفس منطق الألوان المستخدَم في DBStatusBadge (src/hooks/useDB.jsx) ──
const DB_STATUS_META = {
  checking:     { label: 'جاري الاختبار...', color: '#f59e0b', bg: 'rgba(245,158,11,.1)' },
  connected:    { label: 'متصل ✓',           color: '#10b981', bg: 'rgba(16,185,129,.1)' },
  disconnected: { label: 'غير متصل',         color: '#ef4444', bg: 'rgba(239,68,68,.1)'  },
};

function dbErrorMessage(error) {
  if (error === 'backend-unreachable') return 'تعذّر الوصول إلى الخادم الخلفي (تأكد أن الـ backend يعمل).';
  if (error) return error;
  return 'تعذّر الاتصال بقاعدة البيانات.';
}

// ── field helper ──────────────────────────────────────────────
function Field({ label, value, onChange, placeholder = '', type = 'text', hint = '' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.04em' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface2)',
          color: 'var(--text)', fontSize: 13, fontFamily: 'Cairo, sans-serif',
          outline: 'none', transition: 'border .15s',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e  => e.target.style.borderColor = 'var(--border)'}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{hint}</div>}
    </div>
  );
}

export default function SettingsPage() {
  const { currentUser }     = useAuth();
  const { theme, setTheme } = useUI();
  const exportFn            = useAppStore(s => s.exportBackup);
  const centerProfile       = useAppStore(s => s.centerProfile);
  const setCenterProfile    = useAppStore(s => s.setCenterProfile);
  const resetCenterProfile  = useAppStore(s => s.resetCenterProfile);

  const logoInputRef = useRef(null);
  const [saved, setSaved] = useState(false);
  // local draft — لا يُحفظ إلا بعد الضغط على "حفظ"
  const [draft, setDraft] = useState({ ...centerProfile });
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // ── اتصال قاعدة البيانات (Admin فقط) ─────────────────────
  const isAdmin = currentUser?.isAdmin || currentUser?.role === 'admin';
  const [dbInfo, setDbInfo] = useState(null);       // آخر نتيجة من pgCheckHealth()
  const [dbTesting, setDbTesting] = useState(false);
  const [dbLastTestedAt, setDbLastTestedAt] = useState(null);

  const handleTestConnection = useCallback(async () => {
    setDbTesting(true);
    const result = await pgCheckHealth();
    setDbInfo(result);
    setDbLastTestedAt(new Date());
    setDbTesting(false);
    if (result.ok) toast.success('الاتصال بقاعدة البيانات ناجح');
    else toast.error(dbErrorMessage(result.error));
  }, [toast]);

  useEffect(() => {
    if (isAdmin) handleTestConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const dbStatusKey = dbTesting ? 'checking' : dbInfo?.ok ? 'connected' : dbInfo ? 'disconnected' : 'checking';
  const dbStatusMeta = DB_STATUS_META[dbStatusKey];

  // ── Phase 2C-3C Part 4 — تبديل/تراجع قاعدة البيانات (Admin فقط) ──────────────────
  // confirmSwitchAction يحمل 'switch' | 'rollback' | null — مودال واحد مُعاد استخدامه
  // لكلا الإجراءين (عنوان/رسالة/تسمية تختلف حسب القيمة)، بدل تكرار المودال بالكامل مرتين.
  const [confirmSwitchAction, setConfirmSwitchAction] = useState(null);
  const [switchBusy, setSwitchBusy] = useState(false);

  const handleDatabaseSwitchAction = useCallback(async (action) => {
    setSwitchBusy(true);
    let switchError = null;
    try {
      await pgTriggerDatabaseSwitch(action); // POST /api/db-switch — { action } فقط
    } catch (err) {
      switchError = err;
    }

    // يُعاد فحص الهوية دائماً بعد المحاولة، سواء نجحت استجابة POST أم فشلت — العملية
    // الحقيقية على الخادم قد توقف/تعيد تشغيل عملية StudixApp نفسها أثناء تنفيذها، فقد
    // ينقطع الاتصال دون استجابة نظيفة حتى لو نجحت العملية فعلياً على الخادم (موثَّق في
    // تقرير Part 2's own §"Locking design"). GET /api/db-identity هو المرجع الوحيد
    // الموثوق لحالة قاعدة البيانات الفعلية، لا نجاح/فشل استجابة POST وحدها.
    let identityChanged = false;
    try {
      const identityResult = await pgGetDatabaseIdentity();
      if (identityResult.ok) {
        identityChanged = checkDatabaseIdentityAndInvalidate(identityResult.identity).changed;
      }
    } catch { /* best-effort */ }

    setSwitchBusy(false);
    setConfirmSwitchAction(null);

    if (switchError) {
      // رسالة الخادم آمنة ومُنقَّحة مسبقاً (backend/src/routes/dbSwitch.js's own
      // redaction) — تُعرَض كما هي، بلا أي تفاصيل خام إضافية من هذا الملف.
      toast.error(switchError.message || 'فشلت عملية قاعدة البيانات');
    } else {
      toast.success(action === 'switch' ? 'اكتمل تبديل قاعدة البيانات بنجاح' : 'اكتمل التراجع بنجاح');
    }

    if (identityChanged) {
      // نفس نمط "مسح جميع بيانات النظام" الحالي في هذا الملف بالضبط (handleClearAll
      // أدناه) — إعادة تحميل كاملة تُشغِّل تسلسل الإقلاع الحقيقي من الصفر (DBInit ←
      // useDB ← loadFromPostgres)، بدل اختراع مزامنة جزئية جديدة يدوياً لكل collection.
      window.location.reload();
    }
  }, [toast]);

  // exportBackup أصبحت async (تجلب payments طازجة من الخادم) — انتظار/خطأ محليان هنا،
  // بنفس نمط dbTesting أعلاه في هذا الملف بالضبط.
  const [exportBusy, setExportBusy] = useState(false);
  const handleExport = useCallback(async () => {
    setExportBusy(true);
    try {
      await exportFn(currentUser?.id);
    } catch (err) {
      toast.error(err.message || 'فشل تصدير البيانات');
    } finally {
      setExportBusy(false);
    }
  }, [exportFn, currentUser, toast]);

  // ── Logo upload ───────────────────────────────────────────
  const handleLogoChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error('حجم الصورة أكبر من 500 كيلوبايت — اختر صورة أصغر');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft(d => ({ ...d, logoUrl: reader.result }));
    reader.readAsDataURL(file);
  }, []);

  // ── Save ─────────────────────────────────────────────────
  // مصدر الحقيقة هو الخادم لكل الحقول المُدارة به (name/address/phone1/phone2/logoUrl،
  // وما تُعيده القاعدة أيضاً من teacherName/subject/academicYear/id/updatedAt) — لا تعديل
  // محلي إلا بعد نجاح الاستدعاء، ونتبنّى سجل الاستجابة كما هو (نفس مبدأ كل المراحل السابقة).
  // slogan قرار نطاق متعمَّد لهذه المرحلة (بلا عمود DB إطلاقاً — انظر تقرير تفتيش
  // Phase 3B-10) — يبقى محلياً فقط، فيُدمَج من draft بعد نجاح الحفظ حتى لا يُفقَد تعديله
  // محلياً، لكن لا يُرسَل للخادم أبداً (pgUpdateCenterProfile لا يتضمّنه في الطلب).
  const handleSave = useCallback(async () => {
    try {
      const saved = await pgUpdateCenterProfile(draft);
      setCenterProfile({ ...saved, slogan: draft.slogan });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toast.error(err.message || 'تعذّر حفظ بيانات المركز — حاول مرة أخرى');
    }
  }, [draft, setCenterProfile, toast]);

  // ── Reset ────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    resetCenterProfile();
    setDraft({ name:'', slogan:'', address:'', phone1:'', phone2:'', logoUrl:'' });
    setConfirmReset(false);
    toast.success('تم مسح بيانات الطباعة');
  }, [resetCenterProfile, toast]);

  const handleClearAll = useCallback(() => {
    localStorage.removeItem('studix-v1');
    localStorage.removeItem('studix-auth-users');
    localStorage.removeItem('studix-auth-teachers');
    localStorage.removeItem('studix-auth-roles');
    sessionStorage.clear();
    window.location.reload();
  }, []);

  // ── Preview ──────────────────────────────────────────────
  const hasPreview = draft.name || draft.logoUrl;

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="تخصيص النظام وبيانات الطباعة"/>

      <div style={{ padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ══ بيانات الطباعة ══════════════════════════════════ */}
        <SectionBoundary label="Print Profile">
          <div className="card">
            <div className="card-header">
              <div className="card-title">🖨 بيانات الطباعة</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                تظهر في رأس كل تقرير عند الطباعة
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Logo uploader */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  onClick={() => logoInputRef.current?.click()}
                  style={{
                    width: 90, height: 90, borderRadius: 14, flexShrink: 0,
                    border: `2px dashed ${draft.logoUrl ? 'var(--accent)' : 'var(--border)'}`,
                    background: 'var(--surface2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', overflow: 'hidden', transition: 'border .2s',
                    position: 'relative',
                  }}
                  title="اضغط لاختيار الشعار"
                >
                  {draft.logoUrl
                    ? <img src={draft.logoUrl} alt="logo" style={{ width:'100%', height:'100%', objectFit:'contain' }}/>
                    : <div style={{ textAlign:'center', color:'var(--text3)', fontSize:11, padding:8, lineHeight:1.5 }}>
                        <div style={{ fontSize:26, marginBottom:4 }}>🖼</div>
                        شعار المركز
                      </div>
                  }
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleLogoChange}/>
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
                  <button onClick={() => logoInputRef.current?.click()}
                    style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text)', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', width:'fit-content' }}>
                    📁 اختيار صورة
                  </button>
                  {draft.logoUrl && (
                    <button onClick={() => setDraft(d => ({ ...d, logoUrl:'' }))}
                      style={{ padding:'6px 14px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--red)', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', width:'fit-content' }}>
                      🗑 حذف الشعار
                    </button>
                  )}
                  <div style={{ fontSize:11, color:'var(--text3)' }}>PNG أو JPG — بحد أقصى 500 كيلوبايت</div>
                </div>
              </div>

              {/* Fields grid */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                <div style={{ gridColumn:'1 / -1' }}>
                  <Field
                    label="اسم المركز / المدرس *"
                    value={draft.name}
                    onChange={v => setDraft(d => ({ ...d, name:v }))}
                    placeholder="مثال: مركز النور التعليمي"
                  />
                </div>
                <div style={{ gridColumn:'1 / -1' }}>
                  <Field
                    label="السلوجان / الشعار النصي"
                    value={draft.slogan}
                    onChange={v => setDraft(d => ({ ...d, slogan:v }))}
                    placeholder="مثال: نحو مستقبل أفضل"
                  />
                </div>
                <div style={{ gridColumn:'1 / -1' }}>
                  <Field
                    label="العنوان"
                    value={draft.address}
                    onChange={v => setDraft(d => ({ ...d, address:v }))}
                    placeholder="مثال: 15 شارع الجمهورية، المنصورة"
                  />
                </div>
                <Field
                  label="تليفون 1"
                  value={draft.phone1}
                  onChange={v => setDraft(d => ({ ...d, phone1:v }))}
                  placeholder="01XXXXXXXXX"
                  type="tel"
                />
                <Field
                  label="تليفون 2"
                  value={draft.phone2}
                  onChange={v => setDraft(d => ({ ...d, phone2:v }))}
                  placeholder="01XXXXXXXXX (اختياري)"
                  type="tel"
                />
              </div>

              {/* Preview */}
              {hasPreview && (
                <div style={{ border:'1px solid var(--border)', borderRadius:10, padding:14, background:'#fff' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:10, letterSpacing:'0.06em' }}>
                    معاينة رأس الطباعة
                  </div>
                  <div style={{
                    direction:'rtl', fontFamily:'Cairo, Arial, sans-serif',
                    borderBottom:'2px solid #333', paddingBottom:10,
                    display:'flex', alignItems:'center', gap:14,
                  }}>
                    {draft.logoUrl && (
                      <img src={draft.logoUrl} alt="logo"
                        style={{ width:60, height:60, objectFit:'contain', flexShrink:0 }}/>
                    )}
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:18, fontWeight:900, color:'#111' }}>{draft.name || 'اسم المركز'}</div>
                      {draft.slogan  && <div style={{ fontSize:12, color:'#555', marginTop:2, fontStyle:'italic' }}>{draft.slogan}</div>}
                      {draft.address && <div style={{ fontSize:11, color:'#444', marginTop:3 }}>📍 {draft.address}</div>}
                      <div style={{ display:'flex', gap:16, marginTop:3 }}>
                        {draft.phone1 && <span style={{ fontSize:12, color:'#333' }}>📞 {draft.phone1}</span>}
                        {draft.phone2 && <span style={{ fontSize:12, color:'#333' }}>📞 {draft.phone2}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <button onClick={handleSave}
                  style={{
                    padding:'10px 24px', borderRadius:9, border:'none',
                    background: saved ? '#10b981' : 'var(--accent)',
                    color:'#fff', fontSize:14, fontWeight:700,
                    cursor:'pointer', fontFamily:'Cairo,sans-serif',
                    transition:'background .3s',
                    display:'flex', alignItems:'center', gap:8,
                  }}>
                  {saved ? '✓ تم الحفظ' : '💾 حفظ بيانات الطباعة'}
                </button>
                <button onClick={() => setConfirmReset(true)}
                  style={{ padding:'10px 18px', borderRadius:9, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text2)', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif' }}>
                  ↺ مسح
                </button>
              </div>

            </div>
          </div>
        </SectionBoundary>

        {/* ══ المظهر ══════════════════════════════════════════ */}
        <SectionBoundary label="Theme Settings">
          <div className="card">
            <div className="card-header"><div className="card-title">🎨 المظهر</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.values(THEMES).map(t => (
                  <button key={t.id} onClick={() => setTheme(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 16px', borderRadius: 9,
                      border: `2px solid ${theme === t.id ? t.accent : 'var(--border)'}`,
                      background: theme === t.id ? `${t.accent}18` : 'var(--surface2)',
                      color: 'var(--text)', fontFamily: 'Cairo, sans-serif',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.accent, flexShrink: 0 }}/>
                    {t.label}
                    {theme === t.id && <span style={{ color: t.accent }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SectionBoundary>

        {/* ══ أقسام تقرير الطالب الاحترافي (Admin فقط) ═════════ */}
        {isAdmin && <ReportSettingsSection/>}

        {/* ══ النسخ الاحتياطي ═════════════════════════════════ */}
        <SectionBoundary label="Backup">
          <div className="card">
            <div className="card-header"><div className="card-title">💾 النسخ الاحتياطي</div></div>
            <div className="card-body">
              {isAdmin && (
                <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
                  <DatabaseBackupSection/>
                </div>
              )}

              {/* P1-1 — هذا تصدير بيانات جزئي للاطلاع/النقل، لا نسخة احتياطية قابلة للاستعادة */}
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>📄 تصدير البيانات (JSON)</div>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.7 }}>
                ملف JSON يحتوي بعض بيانات النظام (الطلاب، المجموعات، المدفوعات، الحضور، الامتحانات، الدرجات، الواجبات)
                للاطلاع عليها أو نقلها إلى برنامج آخر.{' '}
                <strong>هذا ليس نسخة احتياطية كاملة ولا يمكن استعادة النظام منه</strong> — النسخة الاحتياطية الكاملة هي
                النسخ التلقائي اليومي لقاعدة البيانات.
              </p>
              <button className="btn btn-primary" onClick={handleExport} disabled={exportBusy}>
                {exportBusy ? '...جارِ التصدير' : '⬇ تصدير البيانات (JSON)'}
              </button>

              {/* ── مسح بيانات التجربة ──────────────────── */}
              <div style={{ padding:'16px 20px', borderTop:'1px solid var(--border)', background:'rgba(239,68,68,.04)', marginTop:16 }}>
                <div style={{ fontWeight:700, marginBottom:6, color:'var(--red)' }}>⚠ مسح جميع بيانات النظام</div>
                <p style={{ fontSize:'0.8rem', color:'var(--text3)', marginBottom:12 }}>
                  يمسح كل البيانات المحفوظة (طلاب، مدفوعات، حضور...) ويعيد النظام لحالته الأولى. استخدمه للتجربة فقط.
                </p>
                <button
                  onClick={() => setConfirmClearAll(true)}
                  style={{ padding:'9px 20px', borderRadius:9, border:'1px solid var(--red)', background:'rgba(239,68,68,.1)', color:'var(--red)', fontFamily:'Cairo,sans-serif', fontSize:'0.88rem', fontWeight:700, cursor:'pointer', transition:'all .15s' }}
                  onMouseOver={e=>{e.currentTarget.style.background='var(--red)';e.currentTarget.style.color='#fff';}}
                  onMouseOut={e =>{e.currentTarget.style.background='rgba(239,68,68,.1)';e.currentTarget.style.color='var(--red)';}}>
                  🗑 مسح جميع البيانات وإعادة الضبط
                </button>
              </div>
            </div>
          </div>
        </SectionBoundary>

        {/* ══ معلومات الحساب ══════════════════════════════════ */}
        <SectionBoundary label="Account Info">
          <div className="card">
            <div className="card-header"><div className="card-title">👤 معلومات الحساب</div></div>
            <div className="card-body">
              <div className="form-grid">
                {[
                  ['المعرّف',  currentUser?.id],
                  ['الاسم',    currentUser?.name],
                  ['الدور',    currentUser?.role],
                  ['الحالة',   currentUser?.active ? 'نشط' : 'غير نشط'],
                ].map(([l, v]) => (
                  <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 13px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionBoundary>

        {/* ══ اتصال قاعدة البيانات (Admin فقط) ═════════════════ */}
        {isAdmin && (
          <SectionBoundary label="Database Connection">
            <div className="card">
              <div className="card-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                <div>
                  <div className="card-title">🔌 اتصال قاعدة البيانات</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    حالة الاتصال بـ PostgreSQL — مفيد عند نقل النظام لجهاز آخر
                  </div>
                </div>
                <div style={{
                  display:'inline-flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:99,
                  fontSize:'0.72rem', fontWeight:700, background: dbStatusMeta.bg, color: dbStatusMeta.color,
                  border: `1px solid ${dbStatusMeta.color}30`,
                }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background: dbStatusMeta.color }}/>
                  {dbStatusMeta.label}
                </div>
              </div>
              <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>

                {dbInfo && !dbInfo.ok && (
                  <div style={{
                    padding:'10px 14px', borderRadius:8, background:'rgba(239,68,68,.08)',
                    border:'1px solid rgba(239,68,68,.25)', color:'var(--red)', fontSize:12.5, lineHeight:1.6,
                  }}>
                    ⚠ {dbErrorMessage(dbInfo.error)}
                  </div>
                )}

                <div className="form-grid">
                  {[
                    ['قاعدة البيانات', dbInfo?.connection?.database],
                    ['المضيف (Host)',  dbInfo?.connection?.host],
                    ['المنفذ (Port)',  dbInfo?.connection?.port],
                    ['المستخدم',       dbInfo?.connection?.user],
                    ['عدد الجداول',    dbInfo?.tableCount ?? '—'],
                    ['آخر اختبار',     dbLastTestedAt ? dbLastTestedAt.toLocaleString('ar-EG') : '—'],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 13px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>

                <button onClick={handleTestConnection} disabled={dbTesting}
                  style={{
                    padding:'10px 20px', borderRadius:9, border:'1px solid var(--border)',
                    background:'var(--surface2)', color:'var(--text)', fontSize:13, fontWeight:700,
                    cursor: dbTesting ? 'default' : 'pointer', fontFamily:'Cairo,sans-serif',
                    opacity: dbTesting ? 0.6 : 1, width:'fit-content',
                    display:'flex', alignItems:'center', gap:8,
                  }}>
                  {dbTesting ? '...جارٍ الاختبار' : '🔄 اختبار الاتصال'}
                </button>
              </div>
            </div>
          </SectionBoundary>
        )}

        {/* ══ تبديل/تراجع قاعدة البيانات (Admin فقط) — Phase 2C-3C Part 4 ══════ */}
        {isAdmin && (
          <SectionBoundary label="Database Switch">
            <div className="card">
              <div className="card-header">
                <div className="card-title">🔁 تبديل/استعادة قاعدة البيانات</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  تبديل القاعدة النشطة إلى نسخة مُستعادة مُتحقَّق منها، أو التراجع عن تبديل سابق
                </div>
              </div>
              <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <p style={{ fontSize:13, color:'var(--text2)', lineHeight:1.7 }}>
                  إجراء حسّاس يوقف تطبيق Studix مؤقتاً أثناء التنفيذ. لا تستخدمه إلا بعد التأكد من وجود
                  نسخة مُرشَّحة مُتحقَّق منها جاهزة للتبديل.
                </p>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  <button className="btn btn-primary" disabled={switchBusy}
                    onClick={() => setConfirmSwitchAction('switch')}>
                    🔁 تبديل قاعدة البيانات
                  </button>
                  <button disabled={switchBusy} onClick={() => setConfirmSwitchAction('rollback')}
                    style={{
                      padding:'10px 20px', borderRadius:9, border:'1px solid var(--red)',
                      background:'rgba(239,68,68,.08)', color:'var(--red)', fontSize:13, fontWeight:700,
                      cursor: switchBusy ? 'default' : 'pointer', fontFamily:'Cairo,sans-serif',
                      opacity: switchBusy ? 0.6 : 1,
                    }}>
                    ↩ التراجع عن التبديل
                  </button>
                </div>
              </div>
            </div>
          </SectionBoundary>
        )}

      </div>

      {/* مودال: تبديل/تراجع قاعدة البيانات — واحد مُعاد استخدامه لكلا الإجراءين */}
      <ConfirmModal
        isOpen={!!confirmSwitchAction}
        onClose={() => { if (!switchBusy) setConfirmSwitchAction(null); }}
        onConfirm={() => handleDatabaseSwitchAction(confirmSwitchAction)}
        loading={switchBusy}
        title={confirmSwitchAction === 'switch' ? 'تبديل قاعدة البيانات' : 'التراجع عن التبديل'}
        message={
          confirmSwitchAction === 'switch'
            ? 'سيتم إيقاف تطبيق Studix مؤقتاً وتبديل قاعدة البيانات النشطة إلى النسخة المُرشَّحة المُتحقَّق منها. هل أنت متأكد؟'
            : 'سيتم إيقاف تطبيق Studix مؤقتاً والتراجع عن آخر عملية تبديل، واستعادة قاعدة البيانات السابقة. هل أنت متأكد؟'
        }
        confirmLabel={confirmSwitchAction === 'switch' ? 'نعم، بدِّل' : 'نعم، تراجع'}
      />

      {/* مودال: مسح بيانات الطباعة */}
      <ConfirmModal
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleReset}
        title="مسح بيانات الطباعة"
        message="هل تريد مسح بيانات الطباعة بالكامل (الاسم، اللوجو، العنوان، الهواتف)؟"
        confirmLabel="نعم، امسح"
      />

      {/* مودال: مسح جميع بيانات النظام */}
      <ConfirmModal
        isOpen={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        onConfirm={handleClearAll}
        title="⚠ مسح جميع بيانات النظام"
        message="سيتم مسح جميع البيانات نهائياً (طلاب، مدفوعات، حضور، مستخدمين...) وإعادة تحميل النظام. لا يمكن التراجع. هل أنت متأكد؟"
        confirmLabel="نعم، امسح كل شيء"
      />
    </div>
  );
}
