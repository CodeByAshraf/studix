// src/modules/activity-log/ActivityLogPage.jsx
import { useAppStore } from '../../store/app.store';
import { PageHeader } from '../../components/shared';

export default function ActivityLogPage() {
  const activityLogs = useAppStore((s) => s.activityLogs);

  return (
    <div>
      <PageHeader title="سجل النشاط" subtitle={`${activityLogs.length} حدث مسجّل`}/>
      <div style={{ padding: '0 28px' }}>
        <div className="card">
          {activityLogs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-text">لا توجد أحداث مسجّلة بعد</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الوقت</th><th>المستخدم</th><th>الوحدة</th><th>الوصف</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLogs.slice(0, 200).map(log => (
                    <tr key={log.id}>
                      <td style={{ fontFamily: 'Cairo, sans-serif', fontSize: 11, color: 'var(--text3)' }}>
                        {new Date(log.ts).toLocaleString('ar-EG')}
                      </td>
                      <td style={{ fontWeight: 700, fontSize: 12 }}>{log.user}</td>
                      <td style={{ fontSize: 12 }}>{log.module}</td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{log.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
