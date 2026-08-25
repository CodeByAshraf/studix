// src/modules/id-cards/components/QRCode.jsx
// مُحدَّث: إضافة sanitizeSVG قبل dangerouslySetInnerHTML
import { useMemo } from 'react';
import { qrToSVG }    from '../../../utils/qrcode';
import { sanitizeSVG } from '../../../utils/sanitize';

export function buildQRPayload(student) {
  return JSON.stringify({
    type: 'student',
    id:   student.id,
    code: student.code,
    name: student.name,
    v:    1,
  });
}

export default function QRCode({ student, size = 120, fg = '#000000', bg = '#ffffff', quiet = 3 }) {
  const safeSvg = useMemo(() => {
    if (!student) return '';
    const payload = buildQRPayload(student);
    const raw     = qrToSVG(payload, { size, fg, bg, quiet });
    // sanitizeSVG يتحقق من أن الـ SVG المُولَّد لا يحتوي على patterns خطيرة
    // الـ SVG مُولَّد برمجياً من qrcode.js لذا الفحص سريع جداً
    return sanitizeSVG(raw);
  }, [student?.id, student?.code, size, fg, bg, quiet]);

  if (!safeSvg) return <div style={{ width: size, height: size, background: bg }}/>;

  return (
    <div
      dangerouslySetInnerHTML={{ __html: safeSvg }}
      style={{ lineHeight: 0, flexShrink: 0, borderRadius: 4 }}
    />
  );
}
