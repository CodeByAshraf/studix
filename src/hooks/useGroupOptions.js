// src/hooks/useGroupOptions.js
// M2 (Group Options) — group choices for the Admissions (confirm / activate) and Attendance
// (session) pickers, fetched from GET /api/groups/options ({ id, name, grade, max, price,
// activeCount }; readable with groups, admissions or attendance) instead of the Groups-only
// groups store collection. activeCount is computed by the server (active enrollments of
// active students), so no students data is needed for capacity either.
import { useAsyncData } from './useAsyncData';
import { pgGetGroupOptions } from '../services/api';

export function useGroupOptions() {
  const { data, loading, error } = useAsyncData(() => pgGetGroupOptions(), [], []);
  return { groupOptions: data || [], loading, error };
}
