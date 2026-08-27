// src/modules/Dashboard.jsx
import { useMemo } from 'react';
import { useAppStore } from '../store/app.store';
import { useUI }        from '../store/ui.context';
import { SectionBoundary } from '../components/ErrorBoundary';
import { PageHeader } from '../components/shared';
import { KpiCard, KpiGrid } from '../components/ui';
import { formatCurrency } from '../utils/helpers';
import { getNetRevenue } from '../services/paymentService';

// ── Mini bar chart component ─────────────────────────────────
function BarRow({ label, value, max, color = 'var(--accent)' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
      <span style={{ width:110, fontSize:'0.78rem', color:'var(--text2)', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
      <div style={{ flex:1, height:7, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99, transition:'width 0.8s cubic-bezier(0.4,0,0.2,1)' }}/>
      </div>
      <span style={{ fontSize:'0.72rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif', width:32, textAlign:'left', flexShrink:0 }}>{pct}%</span>
    </div>
  );
}

// ── Heat cell ────────────────────────────────────────────────
function HeatCell({ status }) {
  const colors = { present:'var(--green)', absent:'var(--red)', late:'var(--orange)', none:'var(--surface3)' };
  return (
    <div title={status === 'present' ? 'حاضر' : status === 'absent' ? 'غائب' : status === 'late' ? 'متأخر' : '—'}
      style={{ width:12, height:12, borderRadius:2, background:colors[status]||colors.none, flexShrink:0, cursor:'default' }}/>
  );
}

// ── Notification item ────────────────────────────────────────
function NotifItem({ notif }) {
  const ICONS = { absence:'🚫', payment:'💰', exam:'📝', announcement:'📢', system:'⚙' };
  return (
    <div style={{
      display:'flex', alignItems:'flex-start', gap:10,
      padding:'11px 18px', borderBottom:'1px solid var(--border)',
      background: notif.read ? 'transparent' : 'rgba(13,148,136,0.04)',
      borderRight: notif.read ? '3px solid transparent' : '3px solid var(--accent)',
      transition:'background 0.15s', cursor:'pointer',
    }}
      onMouseOver={e  => e.currentTarget.style.background = 'var(--surface2)'}
      onMouseOut={e   => e.currentTarget.style.background = notif.read ? 'transparent' : 'rgba(13,148,136,0.04)'}
    >
      <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--surface3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.85rem', flexShrink:0 }}>
        {ICONS[notif.type] || '📢'}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:'0.82rem', fontWeight: notif.read ? 500 : 700, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{notif.title}</div>
        <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{notif.body}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:3, fontFamily:'Cairo,sans-serif' }}>{notif.time}</div>
      </div>
      {!notif.read && <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--accent)', marginTop:5, flexShrink:0 }}/>}
    </div>
  );
}

// ── Timeline event ───────────────────────────────────────────
function TimelineEvent({ icon, iconBg, iconColor, title, description, time, isLast }) {
  return (
    <div style={{ display:'flex', gap:12, paddingBottom: isLast ? 0 : 14, position:'relative' }}>
      {!isLast && (
        <div style={{ position:'absolute', right:11, top:28, bottom:0, width:1, background:'var(--border)' }}/>
      )}
      <div style={{ width:24, height:24, borderRadius:'50%', background:iconBg, color:iconColor, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', flexShrink:0, zIndex:1 }}>
        {icon}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:'0.82rem', fontWeight:600, marginBottom:1 }}>{title}</div>
        <div style={{ fontSize:'0.74rem', color:'var(--text2)' }}>{description}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:2, fontFamily:'Cairo,sans-serif' }}>{time}</div>
      </div>
    </div>
  );
}

// ── Student row in table ─────────────────────────────────────
function StudentRow({ student, groups, navigate, attendance }) {
  const group = groups.find(g => g.id === student.groupId);
  const letters = student.name.split(' ').map(w => w[0]).slice(0, 2).join('');
  const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4'];
  const bgs    = ['rgba(59,130,246,.15)','rgba(16,185,129,.15)','rgba(245,158,11,.15)','rgba(139,92,246,.15)','rgba(239,68,68,.15)','rgba(6,182,212,.15)'];
  const idx = (student.name.charCodeAt(0) + (student.name.charCodeAt(1)||0)) % 6;

  // حضور حقيقي: آخر 10 سجلات لهذا الطالب مرتّبة بالتاريخ (بدل بيانات عشوائية).
  const heat = (attendance || [])
    .filter(a => a.studentId === student.id)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-10)
    .map(a => a.status);
  const rated = heat.filter(h => h === 'present' || h === 'late').length;
  const pct = heat.length ? Math.round(rated / heat.length * 100) : null;

  return (
    <tr style={{ cursor:'pointer', transition:'background 0.12s' }}
      onClick={() => navigate('students')}
      onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background = 'var(--surface2)')}
      onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background = '')}
    >
      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:'50%', background:bgs[idx], color:colors[idx], display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>
            {letters}
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:'0.88rem', color:'var(--accent)' }}>{student.name}</div>
            <div style={{ fontSize:'0.7rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student.code}</div>
          </div>
        </div>
      </td>
      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.82rem', color:'var(--text2)' }}>
        {group?.name || '—'}
      </td>
      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.8rem', color:'var(--text2)' }}>
        {student.grade}
      </td>
      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ display:'flex', gap:2 }}>
            {heat.length ? heat.map((h, i) => <HeatCell key={i} status={h}/>) : <span style={{ fontSize:'0.72rem', color:'var(--text3)' }}>لا يوجد سجل</span>}
          </div>
          {pct !== null && (
            <span style={{ fontSize:'0.72rem', fontFamily:'Cairo,sans-serif', color: pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--orange)' : 'var(--red)', fontWeight:700 }}>
              {pct}%
            </span>
          )}
        </div>
      </td>
      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
        <span style={{
          display:'inline-flex', alignItems:'center', gap:4,
          padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:600, border:'1px solid',
          background: student.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
          color:      student.status === 'active' ? 'var(--green)' : 'var(--orange)',
          borderColor:student.status === 'active' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)',
        }}>
          {student.status === 'active' ? '● نشط' : '○ موقوف'}
        </span>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════
export default function Dashboard() {
  // Granular selectors — re-render مضبوط per-slice
  // بدلاً من useApp() الذي يُعيد render عند أي تغيير في الـ store
  const students      = useAppStore((s) => s.students);
  const groups        = useAppStore((s) => s.groups);
  const payments      = useAppStore((s) => s.payments);
  const treasuryTxn   = useAppStore((s) => s.treasuryTxn);
  const attendance    = useAppStore((s) => s.attendance);
  const activityLogs  = useAppStore((s) => s.activityLogs);
  const { notifications, navigate } = useUI();

  // BUG-02 (remaining part, final sweep): كانت "إيراد مارس" ثابتة على شهر مارس (month===3)
  // بغضّ النظر عن التاريخ الفعلي، وتجمع payments.amount الخام دون طرح أي استرداد فعّال —
  // نفس نمط BUG-02 المُصلَح في كل مكان آخر. الآن: الشهر الحالي فعلياً (بنفس منطق
  // ReportsPage.jsx/FinancialAnalytics.jsx)، وصافٍ عبر getNetRevenue (لا منطق استرداد
  // مكرَّر)، مع نسبة نمو حقيقية مقارنةً بالشهر السابق (نفس نمط FinancialAnalytics.jsx
  // بالضبط) بدل نص "+12%" ثابت.
  const stats = useMemo(() => {
    const now           = new Date();
    const currentMonth  = now.getMonth() + 1;
    const currentYear   = now.getFullYear();
    const lastMonthNum  = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const activeStudents = students.filter(s => s.status === 'active').length;
    const monthPayments  = payments.filter(p => p.month === currentMonth && (!p.year || p.year === currentYear));
    const monthPaid      = [...new Set(monthPayments.filter(p => p.status === 'paid').map(p => p.studentId))].length;
    const monthRev       = getNetRevenue(monthPayments, treasuryTxn);
    const lastMonthRev   = getNetRevenue(payments.filter(p => p.month === lastMonthNum && (!p.year || p.year === lastMonthYear)), treasuryTxn);
    const revGrowth      = lastMonthRev > 0 ? Math.round(((monthRev - lastMonthRev) / lastMonthRev) * 100) : null;
    const attRecs        = attendance.slice(-50);
    const attPct         = attRecs.length ? Math.round(attRecs.filter(a => a.status === 'present').length / attRecs.length * 100) : null;
    const unread         = notifications.filter(n => !n.read).length;
    return { activeStudents, monthPaid, monthRev, revGrowth, attPct, unread };
  }, [students, payments, treasuryTxn, attendance, notifications]);

  const QUICK_ACTIONS = [
    { icon:'👤', label:'تسجيل طالب',   sub:'إضافة جديد',      bg:'rgba(59,130,246,.1)',  color:'#3b82f6',  page:'students'      },
    { icon:'✅', label:'تسجيل حضور',   sub:'فتح حصة',          bg:'rgba(16,185,129,.1)', color:'var(--green)',page:'attendance'  },
    { icon:'💵', label:'استلام دفعة',   sub:'تسجيل رسوم',      bg:'rgba(245,158,11,.1)', color:'var(--orange)',page:'payments'   },
    { icon:'📢', label:'إرسال إشعار',  sub:'لأولياء الأمور',  bg:'rgba(139,92,246,.1)', color:'#8b5cf6',  page:'notifications' },
    { icon:'✎',  label:'إنشاء امتحان', sub:'تحديد المجموعة',  bg:'rgba(239,68,68,.1)',  color:'var(--red)', page:'exams'       },
    { icon:'📊', label:'عرض التقارير', sub:'تحليل البيانات',   bg:'rgba(6,182,212,.1)',  color:'#06b6d4',  page:'reports'       },
  ];

  const GROUP_STATS = groups.map(g => ({
    ...g,
    studentCount: students.filter(s => s.groupId === g.id && s.status === 'active').length,
  }));
  const maxGroupCount = Math.max(...GROUP_STATS.map(g => g.studentCount), 1);

  // سجل النشاط الحقيقي: آخر 5 عمليات فعلية (بدل بيانات ثابتة وهمية).
  const ACTION_ICON = {
    create: { icon:'➕', bg:'rgba(16,185,129,.15)', color:'var(--green)' },
    update: { icon:'✏️', bg:'rgba(59,130,246,.15)', color:'#3b82f6' },
    delete: { icon:'🗑️', bg:'rgba(239,68,68,.15)',  color:'var(--red)' },
    login:  { icon:'🔑', bg:'rgba(139,92,246,.15)', color:'#8b5cf6' },
    info:   { icon:'ℹ️', bg:'var(--surface3)',       color:'var(--text3)' },
  };
  const timeAgo = (ts) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'الآن';
    if (min < 60) return `منذ ${min} دقيقة`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `منذ ${hr} ساعة`;
    return new Date(ts).toLocaleDateString('ar-EG', { day:'numeric', month:'short' });
  };
  const TIMELINE = (activityLogs || []).slice(0, 5).map((log) => {
    const meta = ACTION_ICON[log.action] || ACTION_ICON.info;
    return {
      icon: meta.icon, iconBg: meta.bg, iconColor: meta.color,
      title: log.description || log.action,
      description: `${log.user || 'النظام'} · ${log.module || ''}`,
      time: timeAgo(log.ts),
    };
  });

  const dateStr = new Date().toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const cardStyle = {
    background:'var(--surface)',
    border:'1px solid var(--border)',
    borderRadius:14,
    overflow:'hidden',
  };
  const cardHeaderStyle = {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'15px 18px', borderBottom:'1px solid var(--border)', gap:12, flexWrap:'wrap',
  };
  const cardTitleStyle = { fontSize:'0.92rem', fontWeight:700 };
  const cardLinkStyle  = { fontSize:'0.78rem', color:'var(--accent)', fontWeight:600, cursor:'pointer' };

  return (
    <div>
      <PageHeader
        title="لوحة التحكم"
        subtitle={dateStr}
        actions={
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('reports')}>📊 التقارير</button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('students')}>+ طالب جديد</button>
          </div>
        }
      />

      {/* ── KPI Cards ─────────────────────────────────── */}
      <SectionBoundary label="KPI Cards">
        <KpiGrid>
          <KpiCard
            icon="👥" label="الطلاب النشطون"
            value={stats.activeStudents} sub={`من ${students.length} إجمالي`}
            trend="↑ +3 هذا الشهر" trendUp={true}
            onClick={() => navigate('students')}
          />
          <KpiCard
            icon="💰" label="إيراد هذا الشهر"
            value={formatCurrency(stats.monthRev)} sub={`${stats.monthPaid} طالب دفع`}
            trend={stats.revGrowth}
            onClick={() => navigate('payments')}
          />
          <KpiCard
            icon="✓" label="معدل الحضور"
            value={stats.attPct != null ? `${stats.attPct}%` : '—'} sub="متوسط آخر 50 سجل"
            trend={stats.attPct != null ? (stats.attPct > 80 ? '↑ جيد' : '↓ يحتاج متابعة') : '—'}
            trendUp={stats.attPct != null && stats.attPct > 80}
            onClick={() => navigate('attendance')}
          />
          <KpiCard
            icon="🔔" label="إشعارات جديدة"
            value={stats.unread} sub="تحتاج متابعة"
            trend={stats.unread > 0 ? '⚡ يحتاج تدخل' : '✓ لا شيء معلّق'}
            trendUp={false}
            onClick={() => navigate('notifications')}
          />
        </KpiGrid>
      </SectionBoundary>

      {/* ── Row 1: Revenue bars + Quick actions ─────── */}
      <SectionBoundary label="Charts Row">
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:18, padding:'0 28px', marginBottom:18 }}>

          {/* Group capacity bars */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <div style={cardTitleStyle}>توزيع الطلاب على المجموعات</div>
                <div style={{ fontSize:'0.74rem', color:'var(--text3)', marginTop:2 }}>نسبة الإشغال الفعلي</div>
              </div>
              <span style={cardLinkStyle} onClick={() => navigate('groups')}>إدارة المجموعات →</span>
            </div>
            <div style={{ padding:'16px 18px 8px' }}>
              {GROUP_STATS.map((g, i) => {
                const colors = ['var(--accent)','var(--blue, #3b82f6)','var(--green)','var(--purple, #8b5cf6)','var(--orange)'];
                return (
                  <BarRow
                    key={g.id}
                    label={g.name}
                    value={g.studentCount}
                    max={g.max}
                    color={colors[i % colors.length]}
                  />
                );
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={cardTitleStyle}>إجراءات سريعة</div>
            </div>
            <div style={{ padding:14, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {QUICK_ACTIONS.map(a => (
                <div
                  key={a.page}
                  onClick={() => navigate(a.page)}
                  style={{
                    display:'flex', alignItems:'center', gap:9,
                    padding:'12px 11px',
                    background:'var(--surface2)', border:'1px solid var(--border)',
                    borderRadius:10, cursor:'pointer', transition:'all 0.15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.background = 'var(--surface3)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseOut={e  => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ width:34, height:34, borderRadius:9, background:a.bg, color:a.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.95rem', flexShrink:0 }}>
                    {a.icon}
                  </div>
                  <div>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text)', lineHeight:1.2 }}>{a.label}</div>
                    <div style={{ fontSize:'0.66rem', color:'var(--text3)', lineHeight:1.2 }}>{a.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionBoundary>

      {/* ── Row 2: Students table + Right column ─────── */}
      <SectionBoundary label="Students Table">
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:18, padding:'0 28px', marginBottom:18 }}>

          {/* Table */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <div style={cardTitleStyle}>الطلاب النشطون</div>
                <div style={{ fontSize:'0.74rem', color:'var(--text3)', marginTop:2 }}>مع سجل الحضور</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input
                  style={{ padding:'6px 11px', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, fontSize:'0.78rem', color:'var(--text)', outline:'none', direction:'rtl' }}
                  placeholder="بحث..."
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e  => e.target.style.borderColor = 'var(--border)'}
                />
                <span style={cardLinkStyle} onClick={() => navigate('students')}>عرض الكل</span>
              </div>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                <thead>
                  <tr style={{ background:'var(--surface2)' }}>
                    {['الطالب','المجموعة','السنة','الحضور','الحالة'].map(h => (
                      <th key={h} style={{ padding:'10px 14px', fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.slice(0, 5).map(s => (
                    <StudentRow key={s.id} student={s} groups={groups} navigate={navigate} attendance={attendance}/>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right col */}
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>

            {/* Notifications */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div style={cardTitleStyle}>آخر الإشعارات</div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {stats.unread > 0 && (
                    <span style={{ background:'var(--accent)', color:'var(--surface)', fontSize:'0.62rem', fontWeight:700, padding:'2px 7px', borderRadius:99 }}>
                      {stats.unread} جديد
                    </span>
                  )}
                  <span style={cardLinkStyle} onClick={() => navigate('notifications')}>الكل</span>
                </div>
              </div>
              {notifications.slice(0, 4).map((n, i) => (
                <NotifItem key={n.id || i} notif={n}/>
              ))}
            </div>

            {/* Activity timeline */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div style={cardTitleStyle}>سجل النشاط</div>
                <span style={cardLinkStyle} onClick={() => navigate('activity-log')}>عرض الكل</span>
              </div>
              <div style={{ padding:'14px 16px' }}>
                {TIMELINE.length ? TIMELINE.map((e, i) => (
                  <TimelineEvent key={i} {...e} isLast={i === TIMELINE.length - 1}/>
                )) : (
                  <div style={{ textAlign:'center', color:'var(--text3)', fontSize:'0.85rem', padding:'20px 0' }}>
                    لا يوجد نشاط بعد
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </SectionBoundary>
    </div>
  );
}
