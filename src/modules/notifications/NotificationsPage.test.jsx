// src/modules/notifications/NotificationsPage.test.jsx
// Product Completion Phase 1 — Issue 4 (Option A). NotificationsPage.jsx itself is
// unchanged (its shape expectations already match what deriveNotifications produces) —
// this confirms the page renders real content once ui.context.jsx derives it from real
// store data, and still shows the existing honest empty state when there's nothing to
// report. No fetch/network involved — this is a pure Zustand + UIProvider render.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
  useAppStore.setState({ communications: [], commTasks: [] });
});

describe('NotificationsPage — derived from reminderService.js (Product Completion Phase 1, Issue 4)', () => {
  it('shows the existing honest empty state when there is nothing to report', () => {
    renderPage();
    expect(screen.getByText('لا توجد إشعارات')).toBeInTheDocument();
  });

  it('renders a real overdue follow-up as a system-type notification', () => {
    useAppStore.setState({
      communications: [
        { id: 'c1', status: 'open', followupDate: pastStr(3), studentName: 'أحمد علي', phone: '201000000000', result: 'followupRequired' },
      ],
      commTasks: [],
    });
    renderPage();
    expect(screen.getByText('متابعة متأخرة')).toBeInTheDocument();
    expect(screen.getByText(/أحمد علي/)).toBeInTheDocument();
    expect(screen.queryByText('لا توجد إشعارات')).not.toBeInTheDocument();
  });

  it('renders a payment promise due today as a payment-type notification', () => {
    useAppStore.setState({
      communications: [
        { id: 'c2', status: 'open', followupDate: todayStr(), result: 'promiseToPay', studentName: 'سارة محمد', phone: '201000000001' },
      ],
      commTasks: [],
    });
    renderPage();
    expect(screen.getByText('وعد دفع مستحق اليوم')).toBeInTheDocument();
  });

  it('renders a repeated-no-answer parent as a system-type notification', () => {
    const phone = '201123456789';
    useAppStore.setState({
      communications: [1, 2, 3].map((i) => ({
        id: `c${i}`, status: 'open', result: 'noAnswer', phone, parentName: 'ولي أمر محمود',
      })),
      commTasks: [],
    });
    renderPage();
    expect(screen.getByText('عدم رد متكرر')).toBeInTheDocument();
    expect(screen.getByText(/3 مرات/)).toBeInTheDocument();
  });

  it('mark-read still works end-to-end: clicking a notification marks it read and drops the unread dot', () => {
    useAppStore.setState({
      communications: [
        { id: 'c3', status: 'open', followupDate: pastStr(1), studentName: 'محمود سيد', phone: '201000000002', result: 'followupRequired' },
      ],
      commTasks: [],
    });
    renderPage();
    expect(screen.getByText('1 غير مقروء')).toBeInTheDocument();

    fireEvent.click(screen.getByText('متابعة متأخرة'));
    expect(screen.getByText('0 غير مقروء')).toBeInTheDocument();
  });

  it('prunes a stale read-id once its underlying condition resolves, instead of accumulating forever', () => {
    useAppStore.setState({
      communications: [
        { id: 'c-stale', status: 'open', followupDate: pastStr(1), studentName: 'قديم', phone: '2010', result: 'followupRequired' },
      ],
      commTasks: [],
    });
    renderPage();
    fireEvent.click(screen.getByText('متابعة متأخرة'));
    expect(JSON.parse(localStorage.getItem('tc_notif_read_ids'))).toEqual(['notif-overdue-c-stale']);

    // السجل يُحلّ (يُتابَع فعلياً) فيختفي من communications — نفس ما يحدث حقيقياً عند
    // اكتمال المتابعة. الآن قائمة الإشعارات المُشتقّة فارغة.
    act(() => { useAppStore.setState({ communications: [], commTasks: [] }); });

    expect(screen.getByText('لا توجد إشعارات')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('tc_notif_read_ids'))).toEqual([]);
  });

  it('mark-all-read clears every derived notification at once', () => {
    useAppStore.setState({
      communications: [
        { id: 'c4', status: 'open', followupDate: pastStr(1), studentName: 'a', phone: '2010', result: 'followupRequired' },
        // مستحق اليوم بنتيجة "وعد بالدفع" يطابق todayFollowups وpaymentPromisesDue معاً في
        // reminderService.js (الأول لا يفلتر بالنتيجة إطلاقاً) — تذكيران مشتقّان من سجل واحد،
        // سلوك متوقَّع وليس خطأً.
        { id: 'c5', status: 'open', followupDate: todayStr(), studentName: 'b', phone: '2011', result: 'promiseToPay' },
      ],
      commTasks: [],
    });
    renderPage();
    expect(screen.getByText('3 غير مقروء')).toBeInTheDocument();

    fireEvent.click(screen.getByText('✓ قراءة الكل'));
    expect(screen.getByText('0 غير مقروء')).toBeInTheDocument();
  });
});
