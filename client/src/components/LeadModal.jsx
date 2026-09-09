import { useState, useEffect, useRef } from 'react';
import { X, Send } from 'lucide-react';
import { C } from '../constants/theme.js';
import { Badge, ScoreBar } from './ui.jsx';
import { api } from '../services/api.js';

export const LeadModal = ({lead, onClose, onUpdate}) => {
  const [msg, setMsg] = useState('');
  const [fullLead, setFullLead] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!lead?.id) return;
    const fetchLeadData = async () => {
      try {
        const res = await api.getLead(lead.id);
        setFullLead(res.lead);
        setConversations(res.conversations || []);
      } catch (err) {
        console.error('Failed to load lead details', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLeadData();
    
    // Simple polling for new messages every 5s while modal is open
    const interval = setInterval(fetchLeadData, 5000);
    return () => clearInterval(interval);
  }, [lead?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversations]);

  if (!lead) return null;

  const displayLead = fullLead || lead;

  const handleSend = async () => {
    if (!msg.trim() || sending) return;
    setSending(true);
    try {
      await api.sendWhatsAppMessage(displayLead.id, msg);
      setMsg('');
      // Immediately refresh conversations
      const res = await api.getLead(lead.id);
      setConversations(res.conversations || []);
    } catch (err) {
      alert('Failed to send message: ' + err.message);
    } finally {
      setSending(false);
    }
  };


  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(3px)'}} onClick={onClose}>
      <div style={{background:C.surface,border:'1px solid '+C.border,borderRadius:18,width:840,maxHeight:'84vh',overflow:'hidden',display:'flex',flexDirection:'column'}} onClick={(e) => e.stopPropagation()}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:13}}>
            <div style={{width:42,height:42,borderRadius:'50%',background:C.accent+'22',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,fontWeight:700,color:C.accent}}>{displayLead.name?.[0]}</div>
            <div>
              <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,color:C.text}}>{displayLead.name}</h3>
              <p style={{color:C.muted,fontSize:11}}>{displayLead.phone} - {displayLead.brand_name || displayLead.brand} - {displayLead.source}</p>
            </div>
          </div>
          <div style={{display:'flex',gap:9,alignItems:'center'}}>
            <Badge status={displayLead.status} />
            <ScoreBar score={displayLead.score || 0} />
            <button onClick={onClose} style={{width:30,height:30,borderRadius:7,background:C.card,border:'1px solid '+C.border,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <X size={13} color={C.muted} />
            </button>
          </div>
        </div>
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>
          <div style={{flex:1,display:'flex',flexDirection:'column',borderRight:'1px solid '+C.border}}>
            <div style={{padding:'10px 14px',background:C.accent+'10',borderBottom:'1px solid '+C.border}}>
              <p style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:0.8}}>WHATSAPP CONVERSATION {loading && '(Loading...)'}</p>
            </div>
            <div ref={scrollRef} style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10}}>
              {conversations.length === 0 && !loading && <div style={{textAlign:'center',padding:20,color:C.muted}}>No messages yet</div>}
              {conversations.map((m) => {
                const isLead = m.sender === 'lead' || m.direction === 'inbound';
                return (
                  <div key={m.id} style={{display:'flex',justifyContent:isLead ? 'flex-start' : 'flex-end'}}>
                    <div style={{maxWidth:'73%',background:isLead ? C.card : C.accent+'20',border:'1px solid '+(isLead ? C.border : C.accentDim),borderRadius:isLead ? '4px 12px 12px 12px' : '12px 4px 12px 12px',padding:'9px 12px'}}>
                      {!isLead && (m.is_ai === true || m.sender === 'ai') && <p style={{fontSize:8,color:C.accent,fontWeight:700,letterSpacing:0.8,marginBottom:4}}>AI AGENT</p>}
                      {!isLead && !(m.is_ai === true || m.sender === 'ai') && <p style={{fontSize:8,color:C.blue,fontWeight:700,letterSpacing:0.8,marginBottom:4}}>HUMAN</p>}
                      <p style={{fontSize:12,color:C.text,whiteSpace:'pre-wrap',lineHeight:1.6}}>{m.content || m.message}</p>
                      <p style={{fontSize:9,color:C.muted,marginTop:3,textAlign:'right'}}>{(() => {
                        const raw = m.timestamp || m.sent_at || m.time || m.created_at;
                        if (!raw) return '';
                        const d = new Date(raw);
                        return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                      })()}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:10,borderTop:'1px solid '+C.border,display:'flex',gap:7}}>
              <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Manual reply..." style={{flex:1,background:C.card,border:'1px solid '+C.border,borderRadius:9,padding:'9px 12px',color:C.text,fontSize:12,outline:'none'}} />
              <button onClick={handleSend} disabled={sending} style={{background:C.accent,border:'none',width:38,height:38,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',opacity:sending?0.5:1,cursor:'pointer'}}>
                <Send size={13} color="#fff" />
              </button>
            </div>
          </div>
          <div style={{width:220,overflowY:'auto',padding:14}}>
            <p style={{fontSize:9,color:C.muted,letterSpacing:0.8,fontWeight:600,marginBottom:11}}>LEAD DETAILS</p>
            {[['Interest', displayLead.interest || 'Unknown'], ['Assigned', displayLead.assigned_name || displayLead.assigned || 'Unassigned'], ['Last Contact', displayLead.last_contact ? new Date(displayLead.last_contact).toLocaleString() : 'Never'], ['Source', displayLead.source || 'Unknown']].map(([k,v]) => (
              <div key={k} style={{marginBottom:11}}>
                <p style={{fontSize:9,color:C.dim,marginBottom:2}}>{k}</p>
                <p style={{fontSize:12,color:C.text,fontWeight:500}}>{v}</p>
              </div>
            ))}

          </div>
        </div>
      </div>
    </div>
  );
};
