// src/hooks/useAsyncData.js
// Scalability Architecture Phase 4 Cutover 1 — نمط جلب واحد مُعاد استخدامه عبر كل
// مستهلكي payments المهاجَرين لـ pgGetPayments/pgGetPaymentAggregates (بدل تكرار
// useEffect + علم "cancelled" يدوياً في كل ملف). يتجاهل استجابة وصلت متأخرة بعد تغيّر
// deps مجدداً (سباق حالة كلاسيكي) أو بعد إزالة المكوّن — لا خصوصية لأي مستهلك هنا.
import { useEffect, useRef, useState } from 'react';

export function useAsyncData(fetcher, deps, initialValue) {
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef.current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
