// src/modules/id-cards/components/PaymentReceipt.jsx
// Prints an 80mm thermal receipt — works with any browser print dialog
// Set paper size to 80mm x auto in printer settings

import { useCallback } from 'react';
import { useAppStore } from '../../../store/app.store';
import { formatDate, formatCurrency } from '../../../utils/helpers';
import { qrToSVG }     from '../../../utils/qrcode';
import { sanitizeSVG, escapeHTML } from '../../../utils/sanitize';
import { PAYMENT_TYPES } from '../../../services/paymentService';

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ── Receipt preview (on-screen) ──────────────────────────────
export function ReceiptPreview({ payment, student, group, operator }) {
  const profile     = useAppStore(s => s.centerProfile);
  const methodLabel = { cash:'نقداً', transfer:'تحويل', check:'شيك' }[payment.method] || payment.method;
  const typeLabel   = PAYMENT_TYPES[payment.payType] || payment.notes || 'دفع';
  const receiptNo   = `RCP-${payment.id?.slice(-6)?.toUpperCase() || Date.now().toString().slice(-6)}`;
  const now         = new Date();

  // Mini QR for receipt
  const qrSvg = sanitizeSVG(qrToSVG(
    JSON.stringify({ type:'receipt', receiptNo, studentId:student?.id, amount:payment.amount, date:payment.date }),
    { size:60, fg:'#000', bg:'#fff', quiet:2 }
  ));

  return (
    <div style={{
      width: 280,
      background: '#fff',
      fontFamily: 'monospace',
      fontSize: 12,
      color: '#111',
      padding: '16px 14px',
      borderRadius: 4,
      border: '1px dashed #ccc',
      lineHeight: 1.5,
    }}>
      {/* Header — بيانات المركز من الإعدادات */}
      <div style={{ textAlign:'center', borderBottom:'1px dashed #ccc', paddingBottom:10, marginBottom:10 }}>
        {profile.logoUrl && (
          <img src={profile.logoUrl} alt="logo"
            style={{ width:50, height:50, objectFit:'contain', marginBottom:4 }}/>
        )}
        <div style={{ fontFamily:'Cairo,monospace', fontWeight:900, fontSize:16, letterSpacing:-0.5, marginBottom:2 }}>
          {profile.name || 'Studix'}
        </div>
        {profile.slogan && (
          <div style={{ fontSize:9, color:'#666', letterSpacing:1, marginBottom:2 }}>{profile.slogan}</div>
        )}
        {profile.address && (
          <div style={{ fontSize:8.5, color:'#888' }}>📍 {profile.address}</div>
        )}
        {(profile.phone1 || profile.phone2) && (
          <div style={{ fontSize:8.5, color:'#888', marginTop:2 }}>
            {profile.phone1}{profile.phone1 && profile.phone2 ? ' | ' : ''}{profile.phone2}
          </div>
        )}
        <div style={{ fontSize:9, color:'#999', marginTop:4, borderTop:'1px dashed #eee', paddingTop:4 }}>إيصال دفع رسمي</div>
      </div>

      {/* Receipt number + date */}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:8, color:'#555' }}>
        <span>رقم: <strong style={{ color:'#111' }}>{receiptNo}</strong></span>
        <span>{formatDate(payment.date, {day:'numeric',month:'numeric',year:'2-digit'})}</span>
      </div>
      <div style={{ fontSize:10, color:'#666', marginBottom:10 }}>
        الوقت: {now.toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'})}
      </div>

      {/* Divider */}
      <div style={{ borderTop:'1px dashed #ccc', marginBottom:10 }}/>

      {/* Student info */}
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ color:'#666', fontSize:10 }}>الطالب</span>
          <strong style={{ textAlign:'left', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{student?.name || '—'}</strong>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ color:'#666', fontSize:10 }}>الكود</span>
          <span style={{ fontFamily:'Cairo,sans-serif', fontSize:11 }}>{student?.code || '—'}</span>
        </div>
        {group && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#666', fontSize:10 }}>المجموعة</span>
            <span style={{ fontSize:11 }}>{group.name}</span>
          </div>
        )}
      </div>

      <div style={{ borderTop:'1px dashed #ccc', marginBottom:10 }}/>

      {/* Payment details */}
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ color:'#666', fontSize:10 }}>نوع الدفع</span>
          <strong>{typeLabel}</strong>
        </div>
        {payment.month && (
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
            <span style={{ color:'#666', fontSize:10 }}>الشهر</span>
            <span>{MONTHS_AR[(payment.month||1)-1]}</span>
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ color:'#666', fontSize:10 }}>طريقة الدفع</span>
          <span>{methodLabel}</span>
        </div>
        {operator && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#666', fontSize:10 }}>الموظف</span>
            <span style={{ fontSize:11 }}>{operator}</span>
          </div>
        )}
      </div>

      <div style={{ borderTop:'1px solid #111', borderBottom:'1px solid #111', padding:'10px 0', margin:'0 0 10px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:13, fontWeight:700 }}>المبلغ المدفوع</span>
        <span style={{ fontSize:18, fontWeight:900, fontFamily:'Cairo,sans-serif' }}>{formatCurrency(payment.amount)}</span>
      </div>

      {/* Notes */}
      {payment.notes && (
        <div style={{ fontSize:10, color:'#666', marginBottom:10, fontStyle:'italic' }}>
          ملاحظة: {payment.notes}
        </div>
      )}

      {/* QR + signature */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginTop:6 }}>
        <div>
          <div style={{ fontSize:9, color:'#999', marginBottom:4 }}>توقيع الموظف</div>
          <div style={{ width:80, height:24, borderBottom:'1px solid #ccc' }}/>
          <div style={{ fontSize:9, color:'#999', marginTop:3 }}>{operator || '___________'}</div>
        </div>
        {qrSvg && (
          <div>
            <div dangerouslySetInnerHTML={{ __html:qrSvg }} style={{ lineHeight:0 }}/>
            <div style={{ fontSize:8, color:'#bbb', textAlign:'center', marginTop:2 }}>تحقق</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop:'1px dashed #ccc', marginTop:10, paddingTop:8, textAlign:'center', fontSize:9, color:'#aaa', lineHeight:1.6 }}>
        شكراً لثقتك في Studix
        <br/>هذا الإيصال دليل دفع رسمي
        <br/>احتفظ به للرجوع إليه
      </div>
    </div>
  );
}

// ── Print receipt function ────────────────────────────────────
export function printReceipt(payment, student, group, operator) {
  const MONTHS_AR_L = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const methodLabel = { cash:'نقداً', transfer:'تحويل', check:'شيك', instapay:'إنستاباي', visa:'فيزا' }[payment.method] || payment.method;
  const typeLabel   = PAYMENT_TYPES[payment.payType] || payment.notes || 'دفع';
  const receiptNo   = `RCP-${payment.id?.slice(-6)?.toUpperCase() || Date.now().toString().slice(-6)}`;
  const now         = new Date();
  const timeStr     = now.toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'});
  const dateStr     = formatDate(payment.date, {day:'numeric',month:'numeric',year:'2-digit'});
  const centerName  = 'Studix';

  const qrSvg = sanitizeSVG(qrToSVG(
    JSON.stringify({ type:'receipt', receiptNo, studentId:student?.id, amount:payment.amount }),
    { size:56, fg:'#0f766e', bg:'#fff', quiet:2 }
  ));

  const html = `<!DOCTYPE html><html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>إيصال ${receiptNo}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{
    width:80mm; font-family:'Cairo',sans-serif; font-size:11px;
    color:#1e293b; padding:7mm 5mm; direction:rtl; background:#fff;
  }
  .head{ text-align:center; padding:12px 10px; margin-bottom:10px; border-radius:12px;
    background:linear-gradient(135deg,#0d948812,#0d948805); border:1px solid #0d948825; }
  .head .brand{ font-weight:900; font-size:20px; letter-spacing:-1px; color:#0f766e; }
  .head .tag{ font-size:8px; color:#0d9488; letter-spacing:2px; margin:3px 0; font-weight:700; }
  .head .doc{ font-size:9px; color:#64748b; margin-top:2px; }
  .rcpno{ display:flex; justify-content:space-between; align-items:center;
    background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:7px 12px; margin-bottom:10px; }
  .rcpno .lbl{ font-size:9px; color:#64748b; }
  .rcpno .val{ font-weight:900; color:#0f766e; font-size:12px; }
  .row{ display:flex; justify-content:space-between; align-items:center; padding:4px 2px; }
  .label{ color:#64748b; font-size:10px; }
  .val{ font-size:10px; font-weight:700; color:#1e293b; }
  .sec{ border-top:1px solid #e2e8f0; margin:8px 0; padding-top:6px; }
  .total{ display:flex; justify-content:space-between; align-items:center; padding:12px 14px; margin:12px 0;
    background:linear-gradient(135deg,#10b98115,#10b98108); border:1px solid #10b98130; border-radius:10px; }
  .total .t-lbl{ font-weight:700; font-size:13px; color:#065f46; }
  .total .t-val{ font-weight:900; font-size:18px; color:#059669; }
  .note{ font-size:9px; color:#64748b; font-style:italic; background:#f8fafc; padding:6px 10px; border-radius:7px; margin-bottom:8px; }
  .sig-row{ display:flex; justify-content:space-between; align-items:flex-end; margin-top:10px; }
  .sig-line{ width:75px; border-bottom:1px solid #cbd5e1; height:22px; }
  .qr-box{ text-align:center; padding:4px; background:#fff; border:1px solid #e2e8f0; border-radius:8px; }
  .footer{ font-size:9px; color:#94a3b8; text-align:center; line-height:1.8;
    border-top:1px dashed #cbd5e1; padding-top:8px; margin-top:12px; }
  @media print{ @page{size:80mm auto;margin:0} body{padding:4mm} .no-print{display:none} }
</style>
</head>
<body>

<div class="head">
  <div class="brand">${centerName}</div>
  <div class="tag">LEARN · TRACK · SUCCEED</div>
  <div class="doc">إيصال دفع رسمي</div>
</div>

<div class="rcpno">
  <span class="lbl">رقم الإيصال</span>
  <span class="val">${receiptNo}</span>
</div>

<div class="row"><span class="label">التاريخ</span><span class="val">${dateStr}</span></div>
<div class="row"><span class="label">الوقت</span><span class="val">${timeStr}</span></div>

<div class="sec">
  <div class="row"><span class="label">الطالب</span><span class="val" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(student?.name)||'—'}</span></div>
  <div class="row"><span class="label">الكود</span><span class="val">${escapeHTML(student?.code)||'—'}</span></div>
  ${group ? `<div class="row"><span class="label">المجموعة</span><span class="val">${escapeHTML(group.name)}</span></div>` : ''}
</div>

<div class="sec">
  <div class="row"><span class="label">نوع الدفع</span><span class="val" style="color:#0f766e">${escapeHTML(typeLabel)}</span></div>
  ${payment.month ? `<div class="row"><span class="label">الشهر</span><span class="val">${MONTHS_AR_L[(payment.month||1)-1]}</span></div>` : ''}
  <div class="row"><span class="label">طريقة الدفع</span><span class="val">${escapeHTML(methodLabel)}</span></div>
  ${operator ? `<div class="row"><span class="label">الموظف</span><span class="val">${escapeHTML(operator)}</span></div>` : ''}
</div>

<div class="total">
  <span class="t-lbl">المبلغ المدفوع</span>
  <span class="t-val">${escapeHTML(String(payment.amount))} ج.م</span>
</div>

${payment.notes ? `<div class="note">ملاحظة: ${escapeHTML(payment.notes)}</div>` : ''}

<div class="sig-row">
  <div>
    <div class="label" style="margin-bottom:4px">توقيع الموظف</div>
    <div class="sig-line"></div>
    <div style="font-size:9px;color:#94a3b8;margin-top:3px">${escapeHTML(operator)||'___________'}</div>
  </div>
  <div class="qr-box">
    ${qrSvg}
    <div style="font-size:8px;color:#94a3b8;margin-top:2px">تحقق</div>
  </div>
</div>

<div class="footer">
  شكراً لثقتك في ${centerName}<br>
  هذا الإيصال دليل دفع رسمي — احتفظ به للرجوع إليه
</div>

<button class="no-print" onclick="window.print()" style="margin-top:14px;width:100%;padding:11px;background:#0d9488;color:#fff;border:none;border-radius:9px;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;cursor:pointer">
  🖨 طباعة الإيصال
</button>

</body></html>`;

  const win = window.open('', '_blank', 'width=380,height=680');
  if (win) { win.document.write(html); win.document.close(); }
}
