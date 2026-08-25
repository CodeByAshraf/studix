// src/components/ErrorBoundary.jsx
// CRITICAL: Each page is individually wrapped - a crash NEVER freezes navigation
import { Component } from 'react';

// logError: يُسجَّل في localStorage + يُرسَل لـ Zustand activity log
function logError(label, error, info) {
  try {
    const entry = {
      ts:    new Date().toISOString(),
      label,
      msg:   error?.message || String(error),
      stack: info?.componentStack?.slice(0, 500) || '',
    };
    // localStorage — للـ crash reports
    const stored = JSON.parse(localStorage.getItem('tc_error_log') || '[]');
    stored.unshift(entry);
    localStorage.setItem('tc_error_log', JSON.stringify(stored.slice(0, 20)));

    // Zustand activity log — يظهر في سجل النشاط
    // نصل للـ store مباشرةً (خارج React tree — ErrorBoundary هي Class component)
    // Phase 3B-15: لا userId/userName يُرسَلان هنا إطلاقاً — الخادم يشتقّ الفاعل حصراً
    // من كوكي الجلسة (requireAuth)، بالضبط مثل أي طلب آخر؛ لا وصول لـ currentUser ممكن
    // من دالة عادية خارج شجرة React أصلاً (auth.context.jsx سياق React منفصل، لا يوجد
    // له انعكاس عام). لو كانت هناك جلسة سارية فعلاً وقت الانهيار، الخادم يسجّلها بشكل
    // صحيح؛ لو لم تكن هناك جلسة (قبل تسجيل الدخول)، الطلب يُرفَض (401) ولا يُسجَّل الحدث
    // بشكل دائم — لا مستخدم وهمي، لا نص عربي كـ user_id إطلاقاً. لا toast متاح هنا (خارج
    // شجرة React) — فشل الكتابة يبقى صامتاً هنا فقط (console.error)، بلا أي localStorage
    // fallback (لا تغيير في هذا الجزء — لم يكن موجوداً هنا أصلاً).
    try {
      const { useAppStore } = require('../store/app.store');
      useAppStore.getState().addLog({
        action:      'error',
        module:      label || 'ui',
        description: `خطأ في الواجهة: ${entry.msg.slice(0, 120)}`,
      }).catch(() => { /* لا جلسة سارية، أو فشل الخادم — best-effort فقط */ });
    } catch { /* store may not be ready */ }
  } catch { /* silent */ }
  console.error(`[TC Error][${label}]`, error?.message);
}

// ── Page-level boundary ───────────────────────────────────────
// KEY: uses `key` prop in PageRouter so it auto-resets when page changes
export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null, retryCount: 0 };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    logError(this.props.label || 'page', error, info);
  }

  retry = () => this.setState(s => ({
    hasError: false, error: null, retryCount: s.retryCount + 1,
  }));

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, retryCount } = this.state;
    const label = this.props.label || 'هذه الصفحة';

    return (
      <div style={{
        padding: '32px 28px', maxWidth: 580, margin: '32px auto',
        background: 'var(--surface)', borderRadius: 14,
        border: '1px solid rgba(239,68,68,0.25)',
        borderTop: '3px solid var(--red)',
      }}>
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:16 }}>
          <span style={{ fontSize:28 }}>⚠️</span>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:'var(--red)', marginBottom:4 }}>
              حدث خطأ في {label}
            </div>
            <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.6 }}>
              باقي النظام يعمل بشكل طبيعي — يمكنك التنقل لأي صفحة أخرى من القائمة
              {retryCount > 0 && <span style={{ color:'var(--orange)', marginRight:6 }}> (محاولة {retryCount})</span>}
            </div>
          </div>
        </div>

        <div style={{
          padding:'10px 12px', background:'rgba(239,68,68,0.06)', borderRadius:8,
          border:'1px solid rgba(239,68,68,0.15)', marginBottom:16,
          fontSize:11, color:'var(--red)', fontFamily:'Cairo,sans-serif',
          maxHeight:80, overflow:'auto',
        }}>
          {error?.message || String(error)}
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={this.retry} style={{
            padding:'9px 18px', borderRadius:8, border:'none', cursor:'pointer',
            background:'var(--accent)', color:'var(--surface)',
            fontFamily:'Cairo,sans-serif', fontWeight:800, fontSize:13,
          }}>
            🔄 إعادة المحاولة
          </button>
          <button onClick={() => window.location.reload()} style={{
            padding:'9px 18px', borderRadius:8, cursor:'pointer',
            border:'1px solid var(--border)', background:'var(--surface2)',
            color:'var(--text2)', fontFamily:'Cairo,sans-serif', fontWeight:700, fontSize:13,
          }}>
            ↺ تحديث الصفحة
          </button>
        </div>
      </div>
    );
  }
}

// ── Section-level boundary ────────────────────────────────────
// Shows inline error, doesn't block the page
export class SectionBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) { return { hasError: true, error }; }

  componentDidCatch(error, info) {
    logError(this.props.label || 'section', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        padding:'12px 16px', margin:'8px 0', borderRadius:9,
        background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)',
        display:'flex', gap:10, alignItems:'center',
      }}>
        <span style={{ fontSize:18 }}>⚠️</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--red)', marginBottom:2 }}>
            تعذّر تحميل {this.props.label || 'هذا القسم'}
          </div>
          <div style={{ fontSize:11, color:'var(--text3)' }}>
            {this.state.error?.message || 'خطأ غير متوقع'}
          </div>
        </div>
        <button
          onClick={() => this.setState({ hasError:false, error:null })}
          style={{ padding:'5px 12px', borderRadius:7, border:'none', cursor:'pointer',
            background:'var(--accent)', color:'var(--surface)',
            fontFamily:'Cairo,sans-serif', fontWeight:700, fontSize:12 }}>
          إعادة
        </button>
      </div>
    );
  }
}

// ── Widget boundary ────────────────────────────────────────────
export class WidgetBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { logError(this.props.label||'widget', error, info); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        padding:'6px 10px', borderRadius:6, fontSize:11,
        background:'rgba(239,68,68,0.08)', color:'var(--red)',
        border:'1px solid rgba(239,68,68,0.2)', fontFamily:'Cairo,sans-serif',
      }}>
        ⚠️ {this.props.fallback || 'تعذّر تحميل هذا العنصر'}
      </div>
    );
  }
}

export function withErrorBoundary(Comp, label) {
  return function WrappedWithBoundary(props) {
    return (
      <ErrorBoundary label={label || Comp.displayName || Comp.name}>
        <Comp {...props}/>
      </ErrorBoundary>
    );
  };
}
