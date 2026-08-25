// src/modules/LoginScreen.jsx
import { useState } from 'react';

export default function LoginScreen({ onLogin }) {
  const [userId,   setUserId]   = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!userId.trim() || !password.trim()) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setLoading(true);
    try {
      const result = await onLogin(userId.trim(), password);
      if (!result?.success) setError(result?.message || 'بيانات غير صحيحة');
    } catch { setError('حدث خطأ — يرجى المحاولة مجدداً'); }
    finally  { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: '#070e1a',
      fontFamily: 'Cairo, sans-serif',
      direction: 'rtl',
      overflow: 'hidden',
      position: 'relative',
    }}>

      {/* ── Background decoration ── */}
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {/* Grid pattern */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(13,148,136,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(13,148,136,0.04) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}/>
        {/* Glow orbs */}
        <div style={{ position:'absolute', top:'-10%', right:'-5%',  width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(13,148,136,.12) 0%, transparent 70%)', filter:'blur(40px)' }}/>
        <div style={{ position:'absolute', bottom:'-5%', left:'-10%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(59,130,246,.08) 0%, transparent 70%)',  filter:'blur(60px)' }}/>
        <div style={{ position:'absolute', top:'40%', left:'30%',     width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle, rgba(139,92,246,.06) 0%, transparent 70%)', filter:'blur(50px)' }}/>
      </div>

      {/* ── Left panel — Branding ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 40px',
        position: 'relative',
        display: 'none',
      }}/>

      {/* ── Center — Login card ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            {/* Studix mark */}
            <div style={{
              width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
              background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #065f52 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 1px rgba(13,148,136,.3), 0 20px 60px rgba(13,148,136,.25), 0 0 80px rgba(13,148,136,.1)',
              position: 'relative',
            }}>
              <span style={{
                fontFamily: 'Cairo, sans-serif',
                fontWeight: 900, fontSize: 22, color: '#fff', letterSpacing: -1,
              }}>Sx</span>
              {/* Glow ring */}
              <div style={{ position:'absolute', inset:-3, borderRadius:23, border:'1px solid rgba(13,148,136,.2)' }}/>
            </div>

            {/* Brand name */}
            <div style={{
              fontFamily: 'Cairo, sans-serif',
              fontSize: 32, fontWeight: 900,
              color: '#f0fdfa',
              letterSpacing: -1.5,
              lineHeight: 1,
              marginBottom: 8,
            }}>
              Studix
            </div>
            <div style={{
              fontFamily: 'Cairo, sans-serif',
              fontSize: 12, fontWeight: 500,
              color: '#0d9488',
              letterSpacing: 3,
              textTransform: 'uppercase',
            }}>
              Learn · Track · Succeed
            </div>
          </div>

          {/* Card */}
          <div style={{
            background: 'rgba(15, 32, 64, 0.8)',
            border: '1px solid rgba(30, 58, 110, 0.6)',
            borderRadius: 20,
            padding: '32px 28px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 40px rgba(0,0,0,.4), 0 0 0 1px rgba(13,148,136,.08)',
          }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e2f8f6', marginBottom: 4 }}>
                مرحباً بك 👋
              </div>
              <div style={{ fontSize: 13, color: '#4a9994' }}>
                سجّل الدخول للمتابعة إلى لوحة التحكم
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Username */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#4a9994', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 7 }}>
                  اسم المستخدم
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position:'absolute', right: 12, top:'50%', transform:'translateY(-50%)', fontSize:'0.9rem', color:'#4a9994' }}>👤</span>
                  <input
                    value={userId} onChange={e => setUserId(e.target.value)}
                    placeholder="admin"
                    style={{
                      width: '100%', padding: '11px 38px 11px 13px',
                      background: 'rgba(10, 22, 40, 0.8)',
                      border: '1px solid rgba(30,58,110,.8)',
                      borderRadius: 10, color: '#e2f8f6',
                      fontFamily: 'Cairo, sans-serif', fontSize: 14,
                      outline: 'none', direction: 'rtl',
                      transition: 'border-color .15s, box-shadow .15s',
                      boxSizing: 'border-box',
                    }}
                    onFocus={e => { e.target.style.borderColor='#0d9488'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; }}
                    onBlur={e  => { e.target.style.borderColor='rgba(30,58,110,.8)'; e.target.style.boxShadow='none'; }}
                  />
                </div>
              </div>

              {/* Password */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#4a9994', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 7 }}>
                  كلمة المرور
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position:'absolute', right: 12, top:'50%', transform:'translateY(-50%)', fontSize:'0.9rem', color:'#4a9994' }}>🔒</span>
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: '100%', padding: '11px 38px 11px 40px',
                      background: 'rgba(10, 22, 40, 0.8)',
                      border: '1px solid rgba(30,58,110,.8)',
                      borderRadius: 10, color: '#e2f8f6',
                      fontFamily: 'Cairo, sans-serif', fontSize: 14,
                      outline: 'none', direction: 'rtl',
                      transition: 'border-color .15s, box-shadow .15s',
                      boxSizing: 'border-box',
                    }}
                    onFocus={e => { e.target.style.borderColor='#0d9488'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; }}
                    onBlur={e  => { e.target.style.borderColor='rgba(30,58,110,.8)'; e.target.style.boxShadow='none'; }}
                  />
                  <button type="button" onClick={() => setShowPass(p => !p)}
                    style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:'0.85rem', color:'#4a9994', padding:0 }}>
                    {showPass ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  padding: '10px 14px', marginBottom: 16, borderRadius: 9,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
                  color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  ⚠️ {error}
                </div>
              )}

              {/* Submit */}
              <button type="submit" disabled={loading}
                style={{
                  width: '100%', padding: '13px',
                  borderRadius: 10, border: 'none',
                  background: loading
                    ? 'rgba(13,148,136,.5)'
                    : 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                  color: '#fff',
                  fontFamily: 'Cairo, sans-serif', fontSize: 15, fontWeight: 800,
                  cursor: loading ? 'wait' : 'pointer',
                  transition: 'all .2s',
                  boxShadow: loading ? 'none' : '0 4px 20px rgba(13,148,136,.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
                onMouseOver={e => { if(!loading){ e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 6px 24px rgba(13,148,136,.4)'; }}}
                onMouseOut={e  => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=loading?'none':'0 4px 20px rgba(13,148,136,.3)'; }}
              >
                {loading ? (
                  <>
                    <span style={{ width:16, height:16, borderRadius:'50%', border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', animation:'spin .7s linear infinite', display:'inline-block' }}/>
                    جاري الدخول...
                  </>
                ) : (
                  <> دخول <span style={{ fontFamily:'monospace' }}>→</span></>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;900&display=swap');
      `}</style>
    </div>
  );
}
