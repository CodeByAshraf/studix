// src/modules/communication/reminderService.test.js
// Product Completion Phase 2 — Finding 3: يتحقّق أن completedToday (getInboxCounts، مؤشر
// "اكتمل اليوم" في InboxDashboard) يعكس فعلياً سجل تواصل مكتمَل اليوم — الحساب نفسه لم
// يتغيّر (لم نلمس reminderService.js)، لكن كان دائماً 0 لأن status لم يكن يصل COMPLETED
// أبداً قبل هذه المرحلة. هذا الاختبار يثبت أن الحساب صحيح متى ما وصلته بيانات حقيقية.
import { describe, it, expect } from 'vitest';
import { getInboxCounts } from './reminderService';
import { CommType, CommStatus } from './constants';

describe('getInboxCounts — completedToday', () => {
  it('counts a communication completed today, and excludes ones completed on other days or still open', () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const records = [
      { id: 'c1', status: CommStatus.COMPLETED, updatedAt: `${today}T10:00:00.000Z`, createdAt: `${today}T09:00:00.000Z`, type: CommType.PHONE_CALL },
      { id: 'c2', status: CommStatus.COMPLETED, updatedAt: `${yesterday}T10:00:00.000Z`, createdAt: `${yesterday}T09:00:00.000Z`, type: CommType.PHONE_CALL },
      { id: 'c3', status: CommStatus.OPEN, updatedAt: `${today}T10:00:00.000Z`, createdAt: `${today}T09:00:00.000Z`, type: CommType.PHONE_CALL },
    ];

    const counts = getInboxCounts(records, [], { CommType });
    expect(counts.completedToday).toBe(1);
  });

  it('stays at 0 when no communication has ever reached status completed (pre-fix behavior)', () => {
    const today = new Date().toISOString().split('T')[0];
    const records = [
      { id: 'c1', status: CommStatus.OPEN, updatedAt: `${today}T10:00:00.000Z`, createdAt: `${today}T09:00:00.000Z`, type: CommType.PHONE_CALL },
    ];
    const counts = getInboxCounts(records, [], { CommType });
    expect(counts.completedToday).toBe(0);
  });
});
