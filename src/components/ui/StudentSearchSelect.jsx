// src/components/ui/StudentSearchSelect.jsx
// Searchable student combobox — replaces a native <select> full of every student (slow to
// scroll/search once a center has 1,000+ students) with a compact type-to-filter picker.
// Purely presentational: receives the student list + current value from the caller (same
// pattern PaymentForm.jsx already uses for its native <select>) — no store access, no
// side effects beyond calling onChange(studentId). Only renders the (capped) filtered
// results as DOM rows, never the full list, so it stays cheap regardless of dataset size.
import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_RESULTS = 30;

function norm(v) {
  return (v ?? '').toString().trim().toLowerCase();
}

function studentLabel(s) {
  return s?.name || '';
}

export default function StudentSearchSelect({
  students = [], value = '', onChange, name = 'studentId',
  placeholder = 'ابحث عن الطالب...', invalid = false, disabled = false,
}) {
  const selected = useMemo(() => students.find((s) => s.id === value) || null, [students, value]);
  const [query, setQuery] = useState(studentLabel(selected));
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useRef(`student-search-listbox-${Math.random().toString(36).slice(2)}`).current;

  // القيمة المؤكَّدة (value) قد تتغيّر من خارج المكوّن (مثال: prefilledStudentId في
  // PaymentForm.jsx) — نُزامن النص المعروض حينها. لا يمسّ هذا ما يكتبه المستخدم حالياً
  // لأن الكتابة نفسها لا تغيّر value إطلاقاً (فقط اختيار نتيجة فعلي يغيّره).
  useEffect(() => {
    setQuery(studentLabel(selected));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmedQuery = query.trim();
  const results = useMemo(() => {
    const q = norm(trimmedQuery);
    if (!q) return [];
    return students
      .filter((s) => {
        const name = norm(s.name);
        const code = norm(s.code);
        const phone = norm(s.phone);
        return name.includes(q) || code.includes(q) || phone.includes(q);
      })
      .slice(0, MAX_RESULTS);
  }, [students, trimmedQuery]);

  useEffect(() => { setHighlight(0); }, [trimmedQuery, isOpen]);

  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setQuery(studentLabel(selected));
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [selected]);

  const commit = (student) => {
    setQuery(studentLabel(student));
    setIsOpen(false);
    onChange?.(student.id);
  };

  const handleFocus = (e) => {
    setIsOpen(true);
    e.target.select(); // أول ضغطة تكتب فوق النص الحالي مباشرة — بلا حاجة لمسحه يدوياً
  };

  const handleBlur = () => {
    // لا نُغلق فوراً هنا لو كان سبب الـ blur نقرة على نتيجة — الصفوف تمنع الـ mousedown
    // من نقل التركيز أصلاً (onMouseDown={preventDefault} أدناه)، فـ blur هنا يعني فعلاً
    // خروجاً بلا اختيار. نُعيد النص لآخر اختيار مؤكَّد بدل ترك كتابة معلَّقة بلا قيمة.
    setIsOpen(false);
    setQuery(studentLabel(selected));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery(studentLabel(selected));
      return;
    }
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setIsOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      if (isOpen && results[highlight]) { e.preventDefault(); commit(results[highlight]); }
    }
  };

  const BASE = {
    background: 'var(--surface2)', border: `1px solid ${invalid ? 'var(--red)' : 'var(--border)'}`,
    borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontFamily: 'Cairo,sans-serif',
    fontSize: '0.875rem', outline: 'none', width: '100%', direction: 'rtl',
    transition: 'border-color .15s, box-shadow .15s',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        name={name}
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={BASE}
      />

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', right: 0, left: 0,
            maxHeight: 260, overflowY: 'auto', margin: 0, padding: 4, listStyle: 'none',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9,
            boxShadow: '0 8px 24px rgba(0,0,0,.18)',
          }}
        >
          {trimmedQuery === '' ? (
            <li style={{ padding: '10px 12px', fontSize: '0.78rem', color: 'var(--text3)' }}>
              اكتب اسم الطالب أو الكود أو رقم الهاتف للبحث...
            </li>
          ) : results.length === 0 ? (
            <li style={{ padding: '10px 12px', fontSize: '0.78rem', color: 'var(--text3)' }}>
              لا يوجد طالب مطابق للبحث
            </li>
          ) : (
            results.map((s, i) => (
              <li
                key={s.id}
                role="option"
                aria-selected={s.id === value}
                onMouseDown={(e) => e.preventDefault()} // يمنع الـ blur قبل onClick
                onClick={() => commit(s)}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.82rem',
                  background: i === highlight ? 'var(--surface2)' : 'transparent',
                  display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 700 }}>{s.name}</span>
                {s.code && <span style={{ color: 'var(--text3)', fontSize: '0.72rem' }}>#{s.code}</span>}
                {s.phone && <span style={{ color: 'var(--text3)', fontSize: '0.72rem' }}>{s.phone}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
