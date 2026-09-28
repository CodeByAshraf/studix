// src/modules/attendance/absenceWhatsappService.test.js
import { describe, it, expect } from 'vitest';
import {
  buildAbsenceMessage, getAbsenceContactPhone, getSessionTeacherName, openWhatsapp, buildWhatsappUrl,
} from './absenceWhatsappService';
import { formatDate } from '../../utils/helpers';

describe('absenceWhatsappService — buildAbsenceMessage', () => {
  it('includes the student name, group name, teacher name, and formatted date (with weekday), in Arabic tone', () => {
    const msg = buildAbsenceMessage({
      studentName: 'أحمد علي',
      groupName:   'مجموعة أ',
      teacherName: 'أ. محمد سعيد',
      date:        '2026-01-05',
    });
    const expectedDate = formatDate('2026-01-05', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    expect(msg).toContain('السلام عليكم ورحمة الله وبركاته');
    expect(msg).toContain('أحمد علي');
    expect(msg).toContain('ضمن مجموعة مجموعة أ');
    expect(msg).toContain(expectedDate);
    expect(msg).toContain('👨‍🏫 المدرس: أ. محمد سعيد');
    expect(msg).toContain('نرجو التواصل مع المدرس');
    expect(msg).toContain('مع خالص التحيات');
  });

  it('omits the group-name suffix and the teacher line/closing gracefully when not provided — no "undefined"', () => {
    const msg = buildAbsenceMessage({ studentName: 'سارة محمد', date: '2026-01-05' });
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('👨‍🏫');
    expect(msg).not.toContain('ضمن مجموعة');
    expect(msg).toContain('نود إبلاغكم بتغيب سارة محمد');
    // بلا مدرّس معروف → خاتمة عامة (التواصل مع الإدارة)، لا "المدرس" بلا اسم
    expect(msg).toContain('نرجو التواصل مع الإدارة');
    expect(msg).not.toContain('نرجو التواصل مع المدرس');
  });

  it('does not invent or include payment/exam/homework data', () => {
    const msg = buildAbsenceMessage({ studentName: 'مريم', groupName: 'g', teacherName: 't', date: '2026-01-05' });
    expect(msg).not.toMatch(/ج\.م|امتحان|واجب|المدفوع/);
  });

  it('never claims the absence was "today" — this same button is reused for overdue/historical follow-ups, not just today\'s', () => {
    const msg = buildAbsenceMessage({ studentName: 'مريم', groupName: 'g', teacherName: 't', date: '2020-01-05' });
    expect(msg).not.toContain('اليوم');
    expect(msg).toContain(formatDate('2020-01-05', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
  });
});

describe('absenceWhatsappService — getAbsenceContactPhone', () => {
  it('uses the parent phone, never the student phone', () => {
    expect(getAbsenceContactPhone({ phone: '01000000000', parentPhone: '01111111111' })).toBe('01111111111');
  });

  it('never falls back to the student phone when parentPhone is missing/empty', () => {
    expect(getAbsenceContactPhone({ phone: '01000000000', parentPhone: '' })).toBe('');
    expect(getAbsenceContactPhone({ phone: '01000000000' })).toBe('');
  });

  it('returns an empty string when no parent phone is available', () => {
    expect(getAbsenceContactPhone({})).toBe('');
    expect(getAbsenceContactPhone(null)).toBe('');
    expect(getAbsenceContactPhone(undefined)).toBe('');
  });
});

describe('absenceWhatsappService — getSessionTeacherName', () => {
  it('prefers the group.teacherName (the real synced field — not group.teacher, which is unpopulated for PG-synced groups)', () => {
    expect(getSessionTeacherName({ teacherName: 'أ. محمد' }, { teacherName: 'أ. علي' })).toBe('أ. محمد');
  });

  it('falls back to centerProfile.teacherName when the group has no teacher assigned', () => {
    expect(getSessionTeacherName({ teacherName: '' }, { teacherName: 'أ. علي' })).toBe('أ. علي');
    expect(getSessionTeacherName(null, { teacherName: 'أ. علي' })).toBe('أ. علي');
  });

  it('returns an empty string when neither source has a teacher name (never invents one)', () => {
    expect(getSessionTeacherName({}, {})).toBe('');
    expect(getSessionTeacherName(null, null)).toBe('');
    expect(getSessionTeacherName(undefined, undefined)).toBe('');
  });
});

describe('absenceWhatsappService — re-exports the real studentWhatsappService implementation (no duplicated phone logic)', () => {
  it('openWhatsapp/buildWhatsappUrl are the real functions, not stubs', () => {
    expect(typeof openWhatsapp).toBe('function');
    expect(typeof buildWhatsappUrl).toBe('function');
    // نفس منطق normalizePhone الحقيقي من studentWhatsappService — رقم محلي 01xxxxxxxxx يُحوَّل لدولي مصري
    expect(buildWhatsappUrl('01012345678', 'test')).toBe('https://wa.me/201012345678?text=test');
    // رقم غير صالح → null (لا رابط)
    expect(buildWhatsappUrl('not-a-phone', 'test')).toBeNull();
  });
});
