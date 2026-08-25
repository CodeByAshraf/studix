// src/modules/attendance/QRAttendance.jsx
// QR Attendance — future feature preview + infrastructure

export default function QRAttendance() {
  return (
    <div style={{ maxWidth:560, margin:'0 auto' }}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
        {/* Header */}
        <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid var(--border)', background:'var(--surface2)', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:'1.4rem' }}>📱</span>
          <div>
            <div style={{ fontSize:'1rem', fontWeight:800 }}>حضور QR</div>
            <div style={{ fontSize:'0.75rem', color:'var(--text3)' }}>تسجيل الحضور بمسح الكود</div>
          </div>
          <span style={{ marginRight:'auto', background:'rgba(245,158,11,.1)', color:'#f59e0b', border:'1px solid rgba(245,158,11,.2)', borderRadius:99, padding:'3px 10px', fontSize:'0.68rem', fontWeight:700 }}>
            قريباً
          </span>
        </div>

        <div style={{ padding:'28px 24px' }}>
          {/* QR code placeholder */}
          <div style={{ display:'flex', justifyContent:'center', marginBottom:24 }}>
            <div style={{ width:160, height:160, borderRadius:14, border:'2px dashed var(--border2)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, color:'var(--text3)' }}>
              <div style={{ fontSize:48, opacity:.3 }}>◉</div>
              <div style={{ fontSize:'0.72rem', fontWeight:600, textAlign:'center' }}>QR Code<br/>يُنشأ تلقائياً</div>
            </div>
          </div>

          {/* Features list */}
          <div style={{ fontSize:'0.85rem', color:'var(--text2)', marginBottom:24 }}>
            <div style={{ fontWeight:700, marginBottom:12, color:'var(--text)' }}>المميزات القادمة:</div>
            {[
              { icon:'📲', text:'مسح كود QR من هاتف الطالب' },
              { icon:'⚡', text:'تسجيل فوري بدون تدخل يدوي' },
              { icon:'🔐', text:'كود يتجدد كل حصة لمنع التزوير' },
              { icon:'📍', text:'تحقق من الموقع الجغرافي (اختياري)' },
              { icon:'📊', text:'تقارير لحظية أثناء الحصة' },
              { icon:'🔔', text:'إشعار تلقائي لولي الأمر عند الغياب' },
            ].map((f, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:'1rem' }}>{f.icon}</span>
                <span style={{ fontSize:'0.82rem' }}>{f.text}</span>
              </div>
            ))}
          </div>

          {/* Tech stack hint */}
          <div style={{ background:'var(--surface2)', borderRadius:10, padding:'12px 14px', fontSize:'0.76rem', color:'var(--text3)' }}>
            <div style={{ fontWeight:700, color:'var(--text2)', marginBottom:6 }}>📦 التقنيات المطلوبة:</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {['qrcode.react', 'react-qr-scanner', 'navigator.geolocation', 'WebSockets'].map(t => (
                <span key={t} style={{ background:'var(--surface3)', padding:'2px 8px', borderRadius:5, fontSize:'0.7rem', fontFamily:'Cairo,sans-serif', color:'var(--accent)' }}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
