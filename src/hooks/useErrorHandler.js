// src/hooks/useErrorHandler.js
import { useState, useCallback } from 'react';

// ── ترجمة رسائل الخطأ للعربي ─────────────────────────────────
const translateError = (error) => {
  const msg = error?.message || String(error);

  if (msg.includes('localStorage') || msg.includes('QuotaExceeded'))
    return 'المساحة التخزينية ممتلئة — حذف بيانات قديمة سيحل المشكلة';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch'))
    return 'خطأ في الاتصال بالشبكة — تحقق من اتصال الإنترنت';
  if (msg.includes('JSON') || msg.includes('SyntaxError'))
    return 'بيانات تالفة أو غير صالحة';
  if (msg.includes('undefined') || msg.includes('null'))
    return 'بيانات مفقودة أو غير مكتملة';
  if (msg.includes('permission') || msg.includes('Unauthorized'))
    return 'ليس لديك صلاحية لهذه العملية';

  return msg.length > 120 ? msg.slice(0, 120) + '...' : msg;
};

// ── Hook رئيسي ───────────────────────────────────────────────
export function useErrorHandler(toast) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const run = useCallback(async (fn, options = {}) => {
    const { onSuccess, successMsg, errorMsg, showLoading = true } = options;

    if (showLoading) setLoading(true);
    setError(null);

    try {
      const result = await fn();
      if (successMsg && toast) toast.success(successMsg);
      if (onSuccess) onSuccess(result);
      return result;
    } catch (err) {
      const friendly = translateError(err);
      // errorMsg قد تكون دالة (err) => string لعرض رسالة الخادم الفعلية بدل رسالة
      // ثابتة عامة — مفيد لمسارات مثل حذف الامتحان/حفظ الدرجات حيث رسالة الخادم
      // (مثال: "الامتحان غير موجود.") أكثر دقة من نص ثابت. الاستخدام القديم (نص) يبقى كما هو.
      const msg = typeof errorMsg === 'function' ? (errorMsg(err) || friendly) : (errorMsg || friendly);
      setError(msg);
      if (toast) toast.error(msg);
      console.error('[useErrorHandler]', err);
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [toast]);

  const safely = useCallback((fn, errorMsg) => {
    try {
      return fn();
    } catch (err) {
      const friendly = translateError(err);
      const msg = errorMsg || friendly;
      setError(msg);
      if (toast) toast.error(msg);
      console.error('[safely]', err);
      return null;
    }
  }, [toast]);

  const clearError = useCallback(() => setError(null), []);

  return { loading, error, run, safely, clearError };
}

// ── Safe localStorage wrapper ─────────────────────────────────
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`[storage] Failed to save "${key}":`, e.message);
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch { return false; }
  },
};

// ── Safe JSON parse ───────────────────────────────────────────
export const safeJSON = {
  parse(str, fallback = null) {
    try { return JSON.parse(str); }
    catch { return fallback; }
  },
  stringify(val, fallback = '{}') {
    try { return JSON.stringify(val); }
    catch { return fallback; }
  },
};
