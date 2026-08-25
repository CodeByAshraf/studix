// src/types/index.ts
// ─────────────────────────────────────────────────────────────
// Domain Types — الأنواع الأساسية للنظام
// يُستورد من أي ملف: import type { Student, Group } from '@/types'
// ─────────────────────────────────────────────────────────────

// ── Auth ──────────────────────────────────────────────────────
export type UserRole = 'admin' | 'teacher' | 'accountant' | 'reception';

export interface User {
  id:          string;
  name:        string;
  role:        UserRole;
  isAdmin:     boolean;
  active:      boolean;
  permissions: string[] | null;  // null = full access
  teacherId:   string | null;
  email:       string;
  lastLogin:   string | null;
}

// ── Students ──────────────────────────────────────────────────
export type StudentStatus = 'active' | 'inactive' | 'suspended';

export interface Student {
  id:          string;
  name:        string;
  code:        string;
  phone:       string;
  parentPhone: string;
  grade:       string;
  school:      string;
  groupId:     string;
  enrollDate:  string;   // ISO date string
  status:      StudentStatus;
  notes:       string;
  createdAt?:  string;
  updatedAt?:  string;
  // joined fields from API
  groupName?:    string | null;
  groupSubject?: string | null;
  groupPrice?:   number | null;
  groupTeacher?: string | null;
}

// ── Groups ────────────────────────────────────────────────────
export type DayCode = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';

export interface Group {
  id:         string;
  name:       string;
  subject:    string;
  grade:      string;
  teacher:    string;
  teacherId:  string | null;
  time:       string;
  days:       DayCode[];
  price:      number;
  max:        number;
  color:      string;
  notes?:     string;
  createdAt?: string;
}

// ── Payments ──────────────────────────────────────────────────
export type PaymentMethod = 'cash' | 'transfer' | 'instapay' | 'visa' | 'check';
export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'refunded';

export interface Payment {
  id:          string;
  studentId:   string;
  groupId:     string;
  month:       number;   // 1–12
  year:        number;
  amount:      number;
  method:      PaymentMethod;
  date:        string;
  status:      PaymentStatus;
  notes:       string;
  createdAt?:  string;
  // joined
  studentName?: string;
  groupName?:   string;
}

// ── Attendance ────────────────────────────────────────────────
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id:          string;
  studentId:   string;
  groupId:     string;
  date:        string;
  status:      AttendanceStatus;
  sessionTime: string;
  notes:       string;
  createdAt?:  string;
}

// ── Exams ─────────────────────────────────────────────────────
export type ExamType   = 'monthly' | 'midterm' | 'final' | 'quiz';
export type ExamStatus = 'upcoming' | 'grading' | 'done';

export interface Exam {
  id:        string;
  name:      string;
  groupId:   string;
  subject:   string;
  date:      string;
  total:     number;
  pass:      number;
  type:      ExamType;
  teacher:   string;
  status:    ExamStatus;
  createdAt?: string;
}

export interface Grade {
  id:        string;
  examId:    string;
  studentId: string;
  score:     number | null;
  absent:    boolean;
  notes:     string;
}

// ── Treasury ──────────────────────────────────────────────────
export type TxnType   = 'income' | 'expense';
export type TxnStatus = 'active' | 'reversed' | 'pending' | 'rejected';

export interface TreasuryTransaction {
  id:          string;
  date:        string;
  type:        TxnType;
  category:    string;
  description: string;
  amount:      number;
  method:      string;
  party:       string;
  notes:       string;
  refType:     string | null;
  refId:       string | null;
  status:      TxnStatus;
  reversalOf:  string | null;
  originalId:  string | null;
  history:     TxnHistoryEntry[];
  balance:     number;
  createdAt?:  string;
}

export interface TxnHistoryEntry {
  action: string;
  by:     string;
  at:     string;
  note:   string;
}

export interface TreasuryMeta {
  openingBalance: number;
  currency:       string;
}

// ── Pagination ────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page:       number;
    limit:      number;
    total:      number;
    totalPages: number;
    hasNext:    boolean;
    hasPrev:    boolean;
  };
}

// ── API ───────────────────────────────────────────────────────
export interface ApiError {
  error:  string;
  code?:  string;
  field?: string;
}

// ── Center Profile ────────────────────────────────────────────
export interface CenterProfile {
  name:    string;
  slogan:  string;
  address: string;
  phone1:  string;
  phone2:  string;
  logoUrl: string;
}
