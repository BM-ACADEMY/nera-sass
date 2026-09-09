import { Plus } from 'lucide-react';
import { C } from '../constants/theme.js';

export const Badge = ({status}) => {
  const M = {
    new: {bg: '#0f1a2e', tc: '#60a5fa', l: 'New'},
    hot: {bg: '#2d1010', tc: '#ef4444', l: 'Hot'},
    warm: {bg: '#2d1f0a', tc: '#f97316', l: 'Warm'},
    cold: {bg: '#161b22', tc: '#9ca3af', l: 'Cold'},
    converted: {bg: '#0a2018', tc: '#34d399', l: 'Converted'},
    lost: {bg: '#1a0f2e', tc: '#a78bfa', l: 'Lost'},
  };
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const s = M[normalizedStatus] || (normalizedStatus
    ? { bg: '#161b22', tc: '#9ca3af', l: normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1) }
    : M.cold);
  return (
    <span style={{background:s.bg,color:s.tc,padding:'3px 9px',borderRadius:20,fontSize:11,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5}}>
      <span style={{width:5,height:5,borderRadius:'50%',background:s.tc}} />
      {s.l}
    </span>
  );
};

export const TBadge = ({status}) => {
  const M = {
    approved: {i: '✓', c: '#34d399', b: '#0a2018'},
    pending: {i: '⏳', c: '#f97316', b: '#2d1f0a'},
    rejected: {i: '✗', c: '#ef4444', b: '#2d1010'},
    draft: {i: '○', c: '#64748b', b: '#1a2744'},
  };
  const s = M[status] || M.draft;
  return <span style={{background:s.b,color:s.c,padding:'3px 9px',borderRadius:20,fontSize:11,fontWeight:600}}>{s.i} {status.charAt(0).toUpperCase()+status.slice(1)}</span>;
};

export const ScoreBar = ({score}) => {
  const col = score >= 80 ? C.green : score >= 55 ? C.accent : C.blue;
  return (
    <div style={{display:'flex',alignItems:'center',gap:7}}>
      <div style={{width:56,height:4,background:C.border,borderRadius:2,overflow:'hidden'}}>
        <div style={{width:score+'%',height:'100%',background:col,borderRadius:2}} />
      </div>
      <span style={{fontSize:11,color:col,fontWeight:600}}>{score}</span>
    </div>
  );
};

export const Stat = ({label,value,change,Icon,color}) => (
  <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:'18px 22px',flex:1,minWidth:0}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
      <div>
        <p style={{fontSize:10,color:C.muted,letterSpacing:0.8,textTransform:'uppercase',fontWeight:600,marginBottom:8}}>{label}</p>
        <p style={{fontSize:24,fontWeight:700,color:C.text,fontFamily:"'Syne',sans-serif"}}>{value}</p>
        {change != null && <p style={{fontSize:11,color:change>0 ? '#34d399' : '#ef4444',marginTop:4,fontWeight:500}}>{change>0 ? '↑' : '↓'} {Math.abs(change)}% vs last week</p>}
      </div>
      <div style={{width:38,height:38,borderRadius:10,background:color+'20',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Icon size={17} color={color} />
      </div>
    </div>
  </div>
);

export const SectionHeader = ({title, action, label}) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
    <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:C.text}}>{title}</h2>
    {label && (
      <button onClick={action} style={{background:C.accent,border:'none',color:'#fff',padding:'6px 14px',borderRadius:7,fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:5}}>
        <Plus size={12} />
        {label}
      </button>
    )}
  </div>
);
