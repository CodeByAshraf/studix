// src/modules/activity-log/ActivityLogPage.jsx
import { useEffect } from 'react';
import { PageHeader } from '../../components/shared';
import { pgGetActivityLogs } from '../../services/api';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../components/Toast';

// Scalability Architecture Phase 4 (activityLogs) — بدل مصفوفة activityLogs الكاملة من
// الـ store (لم تعد تُزامَن عند الإقلاع)، تُجلَب أحدث 200 حركة + العدّ الكلي الحقيقي عبر
// GET /api/activityLogs?limit=200 (backend/src/routes/activityLogs.js) — نفس البنية
// المعروضة بالضبط (تاريخ/مستخدم/وحدة/وصف)، فقط مصدر البيانات تغيّر.
export default function ActivityLogPage() {
  const toast = useToast();
  const { data, loading, error } = useAsyncData(
    () => pgGetActivityLogs({ limit: 200 }),
    [],
    null,
  );

  useEffect(() => {
    if (error) toast.error(error.message || 'فشل تحميل سجل النشاط');
  }, [error]);

  const items = data?.items || [];
  const total = data?.total ?? 0;

  return (
    <div>
      <PageHeader title="سجل النشاط" subtitle={`${total} حدث مسجّل`}/>
      <div style={{ padding: '0 28px' }}>
        <div className="card">
          {loading ? (
            <div className="empty-state">
              <div className="empty-text">...جارِ التحميل</div>
            </div>
          ) : error ? (
            <div className="empty-state">
              <div className="empty-icon">⚠</div>
              <div className="empty-text">تعذّر تحميل سجل النشاط</div>
            </div>
          ) : total === 0 ? (
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
                  {items.map(log => (
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
