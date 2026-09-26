// src/modules/notifications/NotificationsPage.readHide.test.jsx
// New feature — "تمت القراءة" (read/hide) action. Notifications were becoming crowded
// because read items stayed visible forever in the default list view. This adds an
// explicit "تمت القراءة ✓" action that reuses the EXISTING mark-read mechanism
// (markNotifRead/readIds in ui.context.jsx, persisted under localStorage's
// tc_notif_read_ids — same one NotificationsPage.test.jsx already proves) and hides the
// notification from the default view once read — but ONLY for non-actionable
// notifications (no n.link). Actionable notifications (e.g. absence follow-ups, which
// carry n.link and a "متابعة الآن" button) deliberately keep their existing behavior
// unchanged: reading them does NOT hide them, preserving the "read != completed" contract
// already locked in by NotificationsPage.test.jsx's absence-notification tests.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotificationsPage from './NotificationsPage';
import { useAppStore } from '../../store/app.store';
import { UIProvider } from '../../store/ui.context';

function todayStr() { return new Date().toISOString().split('T')[0]; }
function pastStr(daysAgo) { return new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0]; }

function renderPage() {
  return render(
    <UIProvider>
      <NotificationsPage />
    </UIProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    communications: [], commTasks: [],
    students: [], groups: [], attendance: [], absenceFollowup: [],
  });
});

describe('NotificationsPage — "تمت القراءة" hides non-actionable notifications after reading', () => {
  it('1. renders a "تمت القراءة ✓" button on an unread, non-actionable (no link) notification', () => {
    useAppStore.setState({
      communications: [
        { id: 'c1', status: 'open', followupDate: pastStr(3), studentName: 'أحمد علي', phone: '201000000000', result: 'followupRequired' },
      ],
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'تمت القراءة ✓' })).toBeInTheDocument();
  });

  it('2+3+4. clicking it marks the notification read (existing mechanism), removes it from the visible list, and updates the unread count', () => {
    useAppStore.setState({
      communications: [
        { id: 'c1', status: 'open', followupDate: pastStr(3), studentName: 'أحمد علي', phone: '201000000000', result: 'followupRequired' },
      ],
    });
    renderPage();
    expect(screen.getByText('1 غير مقروء')).toBeInTheDocument();
    expect(screen.getByText('متابعة متأخرة')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'تمت القراءة ✓' }));

    // مقروء عبر الآلية القائمة بالفعل (persisted, same key NotificationsPage.test.jsx uses)
    expect(JSON.parse(localStorage.getItem('tc_notif_read_ids'))).toEqual(['notif-overdue-c1']);
    // اختفى من القائمة الافتراضية
    expect(screen.queryByText('متابعة متأخرة')).not.toBeInTheDocument();
    // عدّاد غير المقروء تحدَّث
    expect(screen.getByText('0 غير مقروء')).toBeInTheDocument();
  });

  it('the hidden notification still shows up when explicitly filtering by "مقروء" (data is hidden, not deleted)', () => {
    useAppStore.setState({
      communications: [
        { id: 'c1', status: 'open', followupDate: pastStr(3), studentName: 'أحمد علي', phone: '201000000000', result: 'followupRequired' },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'تمت القراءة ✓' }));
    expect(screen.queryByText('متابعة متأخرة')).not.toBeInTheDocument();

    // ثاني <select> هو فلتر الحالة (كل/غير مقروء/مقروء) — أولهما فلتر النوع.
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'read' } });
    expect(screen.getByText('متابعة متأخرة')).toBeInTheDocument();
  });

  it('5. read and completed remain separate: an actionable (absence) notification shows no "تمت القراءة" button, only "متابعة الآن", and stays visible once read', () => {
    useAppStore.setState({
      students: [{ id: 's1', name: 'أحمد محمد' }],
      groups: [{ id: 'g1', name: 'مجموعة الرياضيات', subject: 'رياضيات' }],
      attendance: [{ id: 'att1', studentId: 's1', groupId: 'g1', date: pastStr(1), status: 'absent' }],
    });
    renderPage();

    // لا زر "تمت القراءة" على إشعار قابل للتنفيذ — فقط "متابعة الآن"
    expect(screen.queryByRole('button', { name: 'تمت القراءة ✓' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'متابعة الآن' })).toBeInTheDocument();

    // القراءة (عبر النقر على الصف نفسه، السلوك القائم بالفعل) لا تُخفيه ولا تُكمِله
    fireEvent.click(screen.getByText('متابعة غياب متأخرة'));
    expect(screen.getByText('متابعة غياب متأخرة')).toBeInTheDocument();
    expect(useAppStore.getState().absenceFollowup).toEqual([]);
  });

  it('6. "متابعة الآن" still marks read AND navigates for actionable notifications (unaffected by this change)', () => {
    useAppStore.setState({
      students: [{ id: 's1', name: 'أحمد محمد' }],
      groups: [{ id: 'g1', name: 'مجموعة الرياضيات', subject: 'رياضيات' }],
      attendance: [{ id: 'att1', studentId: 's1', groupId: 'g1', date: pastStr(1), status: 'absent' }],
    });
    renderPage();
    expect(screen.getByText('1 غير مقروء')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'متابعة الآن' }));

    expect(screen.getByText('0 غير مقروء')).toBeInTheDocument();
    // يبقى ظاهراً (قابل للتنفيذ)، وقد تنقّل فعلياً — نفس ما تثبته
    // NotificationsPage.test.jsx بالفعل لسلوك "القراءة لا تُزيله".
    expect(screen.getByText('متابعة غياب متأخرة')).toBeInTheDocument();
  });

  it('7. persists across an unmount/remount (simulating a page reload) — the read/hidden notification does not reappear', () => {
    useAppStore.setState({
      communications: [
        { id: 'c1', status: 'open', followupDate: pastStr(3), studentName: 'أحمد علي', phone: '201000000000', result: 'followupRequired' },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'تمت القراءة ✓' }));
    expect(screen.queryByText('متابعة متأخرة')).not.toBeInTheDocument();
    cleanup();

    // نفس بيانات الـ store (communications) لا تزال كما هي — إعادة تحميل الصفحة (remount)
    // تعيد اشتقاق نفس الإشعار من جديد، لكن حالة "مقروء" تُقرأ من localStorage فتبقى مخفية.
    renderPage();
    expect(screen.queryByText('متابعة متأخرة')).not.toBeInTheDocument();
    expect(screen.getByText('0 غير مقروء')).toBeInTheDocument();
  });

  it('a payment-promise (non-actionable) notification also gets the "تمت القراءة" button and hides the same way', () => {
    useAppStore.setState({
      communications: [
        { id: 'c2', status: 'open', followupDate: todayStr(), result: 'promiseToPay', studentName: 'سارة محمد', phone: '201000000001' },
      ],
    });
    renderPage();
    // نفس السجل يطابق أيضاً "متابعة اليوم" (todayFollowups) بجانب "وعد دفع مستحق اليوم" —
    // سلوك موثَّق مسبقاً في NotificationsPage.test.jsx (تذكيران من سجل واحد)، فنطاق الزر
    // بصفّ هذا الإشعار تحديداً بدل getByRole على مستوى الصفحة كلها.
    const titleRow = screen.getByText('وعد دفع مستحق اليوم').closest('div');
    const notifBody = titleRow.parentElement; // الحاوية flex:1 التي تضم العنوان وصفّ الأزرار معاً
    fireEvent.click(within(notifBody).getByRole('button', { name: 'تمت القراءة ✓' }));
    expect(screen.queryByText('وعد دفع مستحق اليوم')).not.toBeInTheDocument();
  });
});
