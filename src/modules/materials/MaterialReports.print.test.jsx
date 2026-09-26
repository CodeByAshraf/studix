// src/modules/materials/MaterialReports.print.test.jsx
// New feature — wires a "🖨 طباعة تقرير المذكرة" print action into the existing materials
// reporting screen (MaterialReports.jsx), reusing its existing material/subject filters —
// no duplicate materials-report screen was created. The button only appears once a specific
// material is chosen (the report's required primary filter) and calls the new
// openMaterialReportPrint builder with the exact data this screen already holds.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MaterialReports from './MaterialReports';
import { useAppStore } from '../../store/app.store';

const MATERIAL = { id: 'm1', name: 'مذكرة الجبر', subject: 'رياضيات', grade: 'الأول الثانوي', price: 100 };
const STUDENT  = { id: 's1', name: 'أحمد علي', code: 'C001', groupId: 'g1', status: 'active', grade: 'الأول الثانوي' };

function seed() {
  useAppStore.setState({
    invMaterials: [MATERIAL],
    students: [STUDENT],
    inventoryTxn: [],
    centerProfile: { name: 'م خالد جمعه' },
  });
}

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

describe('MaterialReports — print action wiring', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('no print button until a specific material is selected', () => {
    seed();
    render(<MaterialReports onDistribute={() => {}} />);
    expect(screen.queryByText('🖨 طباعة تقرير المذكرة')).not.toBeInTheDocument();
  });

  it('selecting a material shows the print button; clicking it opens the real report with this screen\'s data', () => {
    seed();
    render(<MaterialReports onDistribute={() => {}} />);

    fireEvent.change(screen.getByDisplayValue('كل المذكرات'), { target: { value: 'm1' } });
    const printBtn = screen.getByText('🖨 طباعة تقرير المذكرة');
    expect(printBtn).toBeInTheDocument();

    fireEvent.click(printBtn);
    expect(window.open).toHaveBeenCalled();
    expect(writtenHtml).toContain('مذكرة الجبر');
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('م خالد جمعه'); // centerProfile.name يصل فعلياً كـ profile
  });
});
