// src/components/ui/Modal.jsx
import { useEffect, useCallback, useRef } from 'react';
import Button from './Button';

export function Modal({
  isOpen, onClose, title, children, footer,
  size = 'md', closeOnBackdrop = true,
}) {
  // Close on Escape
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose?.();
  }, [onClose]);

  // نتتبّع أين بدأت ضغطة الماوس. الإغلاق عند الضغط على الخلفية يجب أن يحدث
  // فقط إذا بدأت الضغطة وانتهت على الخلفية نفسها. بدون هذا، تحديد نص داخل
  // النافذة ثم سحب الماوس للخارج وإفلاته يُحسب كنقرة على الخلفية فتُغلق النافذة.
  const mouseDownOnBackdrop = useRef(false);

  const handleBackdropMouseDown = useCallback((e) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const handleBackdropMouseUp = useCallback((e) => {
    if (
      closeOnBackdrop &&
      mouseDownOnBackdrop.current &&
      e.target === e.currentTarget
    ) {
      onClose?.();
    }
    mouseDownOnBackdrop.current = false;
  }, [closeOnBackdrop, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const sizeMap = { sm: 420, md: 580, lg: 740, xl: 960 };
  const maxWidth = sizeMap[size] || sizeMap.md;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {children}
        </div>

        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Confirm dialog ─────────────────────────────────────────
export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'تأكيد', loading = false }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗑</div>
        <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.7 }}>{message}</p>
      </div>
    </Modal>
  );
}

export default Modal;
