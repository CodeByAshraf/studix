// src/components/shared/PrintHeader.jsx
// ─────────────────────────────────────────────────────────────
// رأس الطباعة المشترك — يظهر في كل تقرير عند الطباعة
// مرئي على الشاشة كـ preview خفيف، ظاهر بشكل كامل عند الطباعة
// ─────────────────────────────────────────────────────────────
import { useAppStore } from '../../store/app.store';

export default function PrintHeader({ reportTitle = '', reportSubtitle = '' }) {
  const profile = useAppStore(s => s.centerProfile);

  // لو ما فيش بيانات محدودة — لا يعرض حاجة
  const hasData = profile.name || profile.logoUrl;
  if (!hasData) return null;

  return (
    <>
      {/* ── Screen preview (خفيف وأنيق) ─────────────────────── */}
      <div className="print-header-screen no-print" style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '10px 16px',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        marginBottom: 16,
        fontSize: 13,
      }}>
        {profile.logoUrl && (
          <img
            src={profile.logoUrl}
            alt="logo"
            style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{profile.name}</div>
          {profile.slogan && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{profile.slogan}</div>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'left' }}>
          {profile.phone1 && <div>📞 {profile.phone1}</div>}
          {profile.phone2 && <div>📞 {profile.phone2}</div>}
        </div>
      </div>

      {/* ── Print-only header (كامل مع كل التفاصيل) ──────────── */}
      <div className="print-header-print" style={{
        display: 'none',            /* الـ CSS class هتعرضه عند الطباعة */
        direction: 'rtl',
        fontFamily: 'Cairo, Arial, sans-serif',
        borderBottom: '2px solid #333',
        paddingBottom: 12,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Logo */}
          {profile.logoUrl && (
            <img
              src={profile.logoUrl}
              alt="logo"
              style={{ width: 70, height: 70, objectFit: 'contain', flexShrink: 0 }}
            />
          )}

          {/* Center info */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#111', lineHeight: 1.2 }}>
              {profile.name}
            </div>
            {profile.slogan && (
              <div style={{ fontSize: 12, color: '#555', marginTop: 3, fontStyle: 'italic' }}>
                {profile.slogan}
              </div>
            )}
            {profile.address && (
              <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>
                📍 {profile.address}
              </div>
            )}
            <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
              {profile.phone1 && (
                <span style={{ fontSize: 12, color: '#333' }}>📞 {profile.phone1}</span>
              )}
              {profile.phone2 && (
                <span style={{ fontSize: 12, color: '#333' }}>📞 {profile.phone2}</span>
              )}
            </div>
          </div>

          {/* Report title (right side) */}
          {reportTitle && (
            <div style={{ textAlign: 'center', borderRight: '2px solid #eee', paddingRight: 16, minWidth: 120 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{reportTitle}</div>
              {reportSubtitle && (
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{reportSubtitle}</div>
              )}
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {new Date().toLocaleDateString('ar-EG', { day:'numeric', month:'long', year:'numeric' })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Print CSS: show the hidden header, hide the screen one ── */}
      <style>{`
        @media print {
          .print-header-screen { display: none !important; }
          .print-header-print  { display: flex !important; }
        }
      `}</style>
    </>
  );
}
