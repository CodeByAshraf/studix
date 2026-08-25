// src/components/forms/SearchBar.jsx
import { useRef } from 'react';

export default function SearchBar({
  placeholder = 'بحث...',
  defaultValue = '',
  onChange,
  filters = [],   // [{ label, value, options: [{value, label}], onChange }]
  onClear,
  showClear = true,
}) {
  const inputRef = useRef(null);
  const hasActiveFilter = filters.some(f => f.value);

  return (
    <div className="filter-bar">
      {/* Search input */}
      <div className="search-input-wrap" style={{ flex: 1, minWidth: 200 }}>
        <span style={{ color: 'var(--text3)', fontSize: 14 }}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder={placeholder}
          defaultValue={defaultValue}
          onChange={e => onChange?.(e.target.value)}
        />
      </div>

      {/* Dynamic filter selects */}
      {filters.map((f, i) => (
        <select
          key={i}
          className="form-select"
          style={{ width: 'auto', minWidth: 140 }}
          value={f.value}
          onChange={e => f.onChange?.(e.target.value)}
        >
          <option value="">{f.label}</option>
          {f.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}

      {/* Clear button */}
      {showClear && (defaultValue || hasActiveFilter) && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = '';
            onClear?.();
          }}
        >
          × مسح
        </button>
      )}
    </div>
  );
}
