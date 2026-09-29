// src/hooks/useCashboxOptions.js
// M2/F1 — cashbox choices for the payment flows (regular payment, admission deposit, material
// payment), fetched from GET /api/cashboxes/options (id/name/active; readable with payments,
// admissions, materials or treasury) instead of the Treasury-only cashboxes store collection.
// Returns only the ACTIVE cashboxes — the same filter every picker applied before; the server
// still re-validates the chosen cashbox on every payment.
import { useMemo } from 'react';
import { useAsyncData } from './useAsyncData';
import { pgGetCashboxOptions } from '../services/api';

export function useCashboxOptions() {
  const { data, loading, error } = useAsyncData(() => pgGetCashboxOptions(), [], []);
  const activeCashboxes = useMemo(() => (data || []).filter((cb) => cb.active), [data]);
  return { activeCashboxes, loading, error };
}
