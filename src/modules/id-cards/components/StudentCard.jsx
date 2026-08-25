// src/modules/id-cards/components/StudentCard.jsx
import QRCode from './QRCode';
import { formatDate } from '../../../utils/helpers';

const PALETTE = [
  { accent:'#1a56db', grad:'linear-gradient(135deg,#1a56db,#1e40af)' },
  { accent:'#059669', grad:'linear-gradient(135deg,#059669,#065f52)' },
  { accent:'#7c3aed', grad:'linear-gradient(135deg,#7c3aed,#5b21b6)' },
  { accent:'#d97706', grad:'linear-gradient(135deg,#d97706,#b45309)' },
  { accent:'#0d9488', grad:'linear-gradient(135deg,#0d9488,#0f766e)' },
  { accent:'#e11d48', grad:'linear-gradient(135deg,#e11d48,#be123c)' },
];

function getColors(student, group) {
  if (group?.color) return { accent:group.color, grad:`linear-gradient(135deg,${group.color},${group.color}cc)` };
  const idx = ((student.name.charCodeAt(0)||0)+(student.name.charCodeAt(1)||0)) % PALETTE.length;
  return PALETTE[idx];
}
function initials(name='') { return name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join(''); }

export function CardFront({ student, group, theme='dark' }) {
  const colors=getColors(student,group), letters=initials(student.name);
  const isDark=theme==='dark', bg=isDark?'#0f172a':'#ffffff', tx=isDark?'#f8fafc':'#0f172a', sub=isDark?'#94a3b8':'#64748b', border=isDark?'#1e293b':'#e2e8f0';
  return (
    <div style={{width:320,height:200,borderRadius:16,background:bg,border:`1px solid ${border}`,position:'relative',overflow:'hidden',fontFamily:'Cairo,sans-serif',direction:'rtl',flexShrink:0,boxShadow:isDark?'0 8px 32px rgba(0,0,0,.5)':'0 4px 20px rgba(0,0,0,.12)'}}>
      <div style={{position:'absolute',top:0,right:0,left:0,height:5,background:colors.grad}}/>
      <div style={{position:'absolute',bottom:-30,left:-20,width:120,height:120,borderRadius:'50%',background:`${colors.accent}10`,pointerEvents:'none'}}/>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px 8px'}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <div style={{width:28,height:28,borderRadius:7,background:colors.grad,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Cairo,sans-serif',fontSize:11,fontWeight:900,color:'#fff',letterSpacing:-0.5}}>Sx</div>
          <div>
            <div style={{fontSize:'0.68rem',fontWeight:800,color:colors.accent,lineHeight:1}}>Studix</div>
            <div style={{fontSize:'0.52rem',color:sub}}>Student Card</div>
          </div>
        </div>
        <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 8px',borderRadius:99,fontSize:'0.55rem',fontWeight:700,background:student.status==='active'?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)',color:student.status==='active'?'#10b981':'#f59e0b'}}>
          <span style={{width:4,height:4,borderRadius:'50%',background:'currentColor'}}/>{student.status==='active'?'نشط':'موقوف'}
        </span>
      </div>
      <div style={{display:'flex',gap:12,padding:'0 16px'}}>
        <div style={{width:58,height:58,borderRadius:13,flexShrink:0,background:colors.grad,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.25rem',fontWeight:800,color:'#fff',border:`2px solid ${colors.accent}44`,boxShadow:`0 4px 14px ${colors.accent}40`}}>
          {letters}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:900,fontSize:'0.98rem',color:tx,lineHeight:1.2,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{student.name}</div>
          <div style={{fontSize:'0.62rem',color:sub,marginBottom:5}}>{student.grade}</div>
          {group&&<div style={{display:'inline-flex',alignItems:'center',gap:4,background:`${colors.accent}18`,borderRadius:5,padding:'2px 7px',fontSize:'0.6rem',color:colors.accent,fontWeight:700,border:`1px solid ${colors.accent}28`}}>{group.name}</div>}
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 16px 10px',marginTop:8}}>
        <div>
          <div style={{fontSize:'0.52rem',color:sub,marginBottom:1}}>رقم الطالب</div>
          <div style={{fontSize:'0.78rem',fontWeight:800,color:tx,fontFamily:'Cairo,sans-serif',letterSpacing:0.4}}>{student.code}</div>
        </div>
        {student.phone&&<div style={{textAlign:'left'}}><div style={{fontSize:'0.52rem',color:sub,marginBottom:1}}>الهاتف</div><div style={{fontSize:'0.68rem',color:tx,fontFamily:'Cairo,sans-serif',direction:'ltr'}}>{student.phone}</div></div>}
      </div>
    </div>
  );
}

export function CardBack({ student, group, theme='dark' }) {
  const colors=getColors(student,group);
  const isDark=theme==='dark', bg=isDark?'#0f172a':'#ffffff', tx=isDark?'#f8fafc':'#0f172a', sub=isDark?'#94a3b8':'#64748b', border=isDark?'#1e293b':'#e2e8f0';
  return (
    <div style={{width:320,height:200,borderRadius:16,background:bg,border:`1px solid ${border}`,position:'relative',overflow:'hidden',fontFamily:'Cairo,sans-serif',direction:'rtl',flexShrink:0,boxShadow:isDark?'0 8px 32px rgba(0,0,0,.5)':'0 4px 20px rgba(0,0,0,.12)'}}>
      <div style={{position:'absolute',top:0,right:0,left:0,height:5,background:colors.grad}}/>
      <div style={{position:'absolute',inset:0,opacity:.025,backgroundImage:`radial-gradient(${colors.accent} 1px, transparent 1px)`,backgroundSize:'14px 14px'}}/>
      <div style={{display:'flex',height:'100%',paddingTop:5}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'10px 14px',gap:5,width:130}}>
          <div style={{background:'#fff',padding:5,borderRadius:10,border:`2px solid ${colors.accent}30`,boxShadow:`0 2px 12px ${colors.accent}20`}}>
            <QRCode student={student} size={90} fg="#000000" bg="#ffffff" quiet={2}/>
          </div>
          <div style={{fontSize:'0.52rem',color:sub,textAlign:'center',lineHeight:1.4}}>امسح للحضور / الانصراف</div>
        </div>
        <div style={{width:1,background:border,margin:'14px 0'}}/>
        <div style={{flex:1,padding:'10px 12px',display:'flex',flexDirection:'column',gap:7}}>
          {[
            {l:'الكود',v:student.code,mono:true},
            {l:'المدرس',v:group?.teacher||'—'},
            {l:'ولي الأمر',v:student.parentPhone||'—',mono:true,dir:'ltr'},
            {l:'تاريخ التسجيل',v:student.enrollDate?formatDate(student.enrollDate,{year:'numeric',month:'short',day:'numeric'}):'—'},
            {l:'المدرسة',v:student.school||'—'},
          ].map(item=>(
            <div key={item.l}>
              <div style={{fontSize:'0.5rem',color:sub,marginBottom:1}}>{item.l}</div>
              <div style={{fontSize:'0.68rem',fontWeight:700,color:tx,fontFamily:item.mono?'Cairo,sans-serif':'Cairo,sans-serif',direction:item.dir||'rtl',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StudentCard({ student, group, theme='dark' }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <CardFront student={student} group={group} theme={theme}/>
      <CardBack  student={student} group={group} theme={theme}/>
    </div>
  );
}
