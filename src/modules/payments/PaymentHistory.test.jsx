// src/modules/payments/PaymentHistory.test.jsx
// Scalability Architecture Phase 4 (متابعة) — PaymentHistory.jsx الآن يجلب صفحته عبر
// pgGetPaymentsHistory (GET /api/payments/search) بدل قراءة مصفوفة payments الكاملة من
// الـ store. يغطّي: التحميل، النجاح، البحث (مُهذَّب زمنياً)، تغيّر الفلاتر، التنقّل بين
// الصفحات، الحالة الفارغة، حالة الخطأ، إجمالي المبلغ، إجمالي عدد النتائج، والحفاظ على
// السلوك المرئي القائم (زر "استرداد كامل"، زر "تسجيل أول دفعة" في الحالة الفارغة بلا فلاتر).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentHistory from './PaymentHistory';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetPaymentsHistory: vi.fn() };
});
import { pgGetPaymentsHistory } from '../../services/api';

const STUDENT = { id: 's1', name: 'أحمد علي', groupId: 'g1' };
const GROUP = { id: 'g1', name: 'مجموعة أ' };

function page(items, overrides = {}) {
  return {
    items,
    page: 1,
    totalPages: 1,
    total: items.length,
    totalAmount: items.reduce((s, p) => s + p.amount, 0),
    hasPrev: false,
    hasNext: false,
    ...overrides,
  };
}

function makePayment(overrides = {}) {
  return {
    id: 'p1', studentId: STUDENT.id, groupId: GROUP.id, month: 1, year: 2026,
    amount: 300, method: 'cash', date: '2026-01-05', status: 'paid', ...overrides,
  };
}

function renderPaymentHistory(props = {}) {
  return render(
    <ToastProvider>
      <PaymentHistory {...props} />
    </ToastProvider>
  );
}

describe('PaymentHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ students: [STUDENT], groups: [GROUP] });
  });

  it('shows a loading state before the first response resolves', async () => {
    let resolveFetch;
    pgGetPaymentsHistory.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    renderPaymentHistory();
    expect(screen.getByText('...جارِ التحميل')).toBeInTheDocument();

    resolveFetch(page([makePayment()]));
    await waitFor(() => expect(screen.queryByText('...جارِ التحميل')).not.toBeInTheDocument());
  });

  it('renders rows from a successful response, using the store for student/group display', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([makePayment()]));

    renderPaymentHistory();

    expect(await screen.findByText('أحمد علي')).toBeInTheDocument();
    expect(screen.getAllByText('مجموعة أ').length).toBeGreaterThan(0);
  });

  it('empty state (no filters) shows the "record first payment" CTA', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([]));
    const onAddPayment = vi.fn();

    renderPaymentHistory({ onAddPayment });

    const cta = await screen.findByText('+ تسجيل أول دفعة');
    fireEvent.click(cta);
    expect(onAddPayment).toHaveBeenCalled();
  });

  it('empty state WITH filters shows "no results" instead of the CTA', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([]));

    renderPaymentHistory();
    const monthSelect = await screen.findByDisplayValue('كل الشهور');
    fireEvent.change(monthSelect, { target: { value: '2' } });

    expect(await screen.findByText('لا توجد نتائج')).toBeInTheDocument();
    expect(screen.queryByText('+ تسجيل أول دفعة')).not.toBeInTheDocument();
  });

  it('error state renders an inline message and does not crash', async () => {
    pgGetPaymentsHistory.mockRejectedValue(new Error('فشل الاتصال'));

    renderPaymentHistory();

    expect(await screen.findByText('تعذّر تحميل سجل المدفوعات')).toBeInTheDocument();
  });

  it('displays the total amount and total result count from the server response, not just the current page', async () => {
    pgGetPaymentsHistory.mockResolvedValue(
      page([makePayment({ id: 'p1', amount: 100 }), makePayment({ id: 'p2', amount: 50 })], {
        total: 25, totalAmount: 9999, totalPages: 3, hasNext: true,
      })
    );

    renderPaymentHistory();
    const monthSelect = await screen.findByDisplayValue('كل الشهور');
    fireEvent.change(monthSelect, { target: { value: '1' } }); // triggers hasFilters -> total amount chip shows

    expect(await screen.findByText(formatCurrency(9999))).toBeInTheDocument();
    expect(await screen.findByText(/من 25 دفعة/)).toBeInTheDocument();
  });

  it('month filter change calls the API with the selected month and resets to page 1', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([makePayment()]));
    renderPaymentHistory();
    await screen.findByText('أحمد علي');

    const monthSelect = screen.getByDisplayValue('كل الشهور');
    fireEvent.change(monthSelect, { target: { value: '3' } });

    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: '3', page: 1 })
      );
    });
  });

  it('group filter change calls the API with the selected groupId', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([makePayment()]));
    renderPaymentHistory();
    await screen.findByText('أحمد علي');

    const groupSelect = screen.getByDisplayValue('كل المجموعات');
    fireEvent.change(groupSelect, { target: { value: GROUP.id } });

    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupId: GROUP.id, page: 1 })
      );
    });
  });

  it('status filter change calls the API with the selected status', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([makePayment()]));
    renderPaymentHistory();
    await screen.findByText('أحمد علي');

    const statusSelect = screen.getByDisplayValue('كل الحالات');
    fireEvent.change(statusSelect, { target: { value: 'partial' } });

    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'partial', page: 1 })
      );
    });
  });

  it('search input is debounced before calling the API', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([makePayment()]));
    renderPaymentHistory();
    await screen.findByText('أحمد علي');
    pgGetPaymentsHistory.mockClear();

    const searchBox = screen.getByPlaceholderText('بحث بالاسم...');
    fireEvent.change(searchBox, { target: { value: 'أح' } });
    fireEvent.change(searchBox, { target: { value: 'أحم' } });
    fireEvent.change(searchBox, { target: { value: 'أحمد' } });

    // لا استدعاء فوري لكل ضغطة زر
    expect(pgGetPaymentsHistory).not.toHaveBeenCalled();

    await waitFor(
      () => expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'أحمد', page: 1 })
      ),
      { timeout: 2000 }
    );
    // فقط استعلام واحد نهائي بعد الاستقرار، لا واحد لكل حرف.
    expect(pgGetPaymentsHistory).toHaveBeenCalledTimes(1);
  });

  it('pagination: next/prev buttons call the API with the adjacent page', async () => {
    pgGetPaymentsHistory.mockResolvedValue(
      page([makePayment()], { page: 2, totalPages: 5, total: 50, hasPrev: true, hasNext: true })
    );
    renderPaymentHistory();
    await screen.findByText('أحمد علي');

    fireEvent.click(screen.getByText('‹'));
    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    });

    fireEvent.click(screen.getByText('›'));
    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    });
  });

  it('pagination: clicking a page number navigates directly to that page', async () => {
    pgGetPaymentsHistory.mockResolvedValue(
      page([makePayment()], { page: 1, totalPages: 3, total: 30, hasNext: true })
    );
    renderPaymentHistory();
    await screen.findByText('أحمد علي');

    fireEvent.click(screen.getByText('3'));
    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    });
  });

  it('preserves the "full refund" action button, calling onDeletePayment with the row', async () => {
    const payment = makePayment();
    pgGetPaymentsHistory.mockResolvedValue(page([payment]));
    const onDeletePayment = vi.fn();

    renderPaymentHistory({ onDeletePayment });
    await screen.findByText('أحمد علي');

    fireEvent.click(screen.getByTitle('استرداد كامل'));
    expect(onDeletePayment).toHaveBeenCalledWith(payment);
  });

  it('"× مسح" clears all filters and search, refetching page 1 with no filters', async () => {
    pgGetPaymentsHistory.mockResolvedValue(page([makePayment()]));
    renderPaymentHistory();
    await screen.findByText('أحمد علي');

    const monthSelect = screen.getByDisplayValue('كل الشهور');
    fireEvent.change(monthSelect, { target: { value: '2' } });
    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2' }));
    });

    fireEvent.click(screen.getByText('× مسح'));
    await waitFor(() => {
      expect(pgGetPaymentsHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: '', groupId: '', status: '', search: '', page: 1 })
      );
    });
  });
});
