// src/components/forms/FormField.jsx
// Wraps any input with a label, helper text, and error message

export default function FormField({ label, error, helper, required, children, className = '' }) {
  return (
    <div className={`form-group ${className}`}>
      {label && (
        <label className="form-label">
          {label}
          {required && <span style={{ color: 'var(--red)', marginRight: 3 }}>*</span>}
        </label>
      )}
      {children}
      {helper && !error && (
        <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{helper}</span>
      )}
      {error && (
        <div className="form-error">⚠ {error}</div>
      )}
    </div>
  );
}
