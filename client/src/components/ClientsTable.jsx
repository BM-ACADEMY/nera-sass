import { useState, useEffect, Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import { C } from '../constants/theme.js';

export const ClientsTable = ({ clients, onDashboard, onManage }) => {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const totalRecords = clients.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pageClients = clients.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(current => Math.min(current, totalPages));
  }, [totalPages]);

  const changePage = nextPage => {
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
    setExpandedId(null);
  };
  const cell = { padding: 13, borderBottom: `1px solid ${C.border}`, fontSize: 10 };
  const details = client => [
    ['WhatsApp Number', client.whatsapp_number],
    ['Phone Number ID', client.phone_number_id], ['WABA ID', client.wa_business_id],
    ['Website', client.wa_website], ['Email', client.wa_email], ['Address', client.wa_address],
    ['Meta Verified Name', client.meta_verified_name], ['Meta Category', client.meta_profile_vertical],
    ['Meta About', client.meta_profile_about], ['Meta Description', client.meta_profile_description],
    ['Meta Profile Email', client.meta_profile_email], ['Meta Profile Address', client.meta_profile_address],
    ['Meta Websites', Array.isArray(client.meta_profile_websites) ? client.meta_profile_websites.join(', ') : client.meta_profile_websites],
    ['Meta Quality', client.meta_quality_rating], ['Meta Connection', client.meta_connection_status],
    ['WhatsApp Verified', client.whatsapp_verified_at ? new Date(client.whatsapp_verified_at).toLocaleString() : null],
  ];

  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
      <thead><tr>{['', 'Brand', 'Leads', 'Converted', 'Conversion', 'WhatsApp', 'Status', 'Action'].map(label =>
        <th key={label} style={{ ...cell, color: C.muted, fontSize: 8, textAlign: ['Leads','Converted','Conversion'].includes(label) ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: .6 }}>{label}</th>
      )}</tr></thead>
      <tbody>{pageClients.map(client => {
        const leads = Number(client.lead_count ?? client.leads ?? 0);
        const converted = Number(client.converted_count ?? client.conv ?? 0);
        const expanded = expandedId === client.id;
        const waLabel = client.whatsapp_status === 'verified' ? 'Verified · Enabled' : client.whatsapp_status === 'verification_pending' ? 'Verification Pending' : client.whatsapp_status === 'verification_failed' ? 'Verification Failed' : 'Not Configured';
        return <Fragment key={client.id}>
          <tr onClick={() => setExpandedId(expanded ? null : client.id)} style={{ cursor: 'pointer', background: expanded ? C.surface : 'transparent', opacity: client.status === 'inactive' ? .65 : 1 }}>
            <td style={cell}><ChevronDown size={13} color={C.muted} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /></td>
            <td style={cell}><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>{client.meta_profile_picture_url ? <img src={client.meta_profile_picture_url} alt={`${client.name} logo`} style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', border: `1px solid ${C.border}` }} /> : <div style={{ width: 30, height: 30, borderRadius: 8, background: `${C.accent}20`, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{client.name?.[0] || '?'}</div>}<div><strong style={{ color: C.text, fontSize: 11 }}>{client.name}</strong><small style={{ display: 'block', color: C.muted, fontSize: 8, marginTop: 2 }}>{client.joined_at || client.created_at ? new Date(client.joined_at || client.created_at).toLocaleDateString() : '—'}</small></div></div></td>
            <td style={{ ...cell, color: C.blue, textAlign: 'right', fontWeight: 700 }}>{leads}</td>
            <td style={{ ...cell, color: C.green, textAlign: 'right', fontWeight: 700 }}>{converted}</td>
            <td style={{ ...cell, color: C.purple, textAlign: 'right', fontWeight: 700 }}>{leads ? Math.round(converted / leads * 100) : 0}%</td>
            <td style={{ ...cell, color: client.whatsapp_status === 'verified' ? C.green : client.whatsapp_status === 'verification_failed' ? C.red : C.muted, fontSize: 9, fontWeight: 700 }}>{waLabel}</td>
            <td style={cell}><span style={{ color: client.status === 'active' ? C.green : C.muted, background: client.status === 'active' ? '#0a2018' : C.surface, borderRadius: 12, padding: '3px 8px', fontSize: 9 }}>{client.status === 'active' ? 'Active' : 'Inactive'}</span></td>
            <td style={cell}><button onClick={event => { event.stopPropagation(); onManage(client); }} style={{ background: `${C.accent}20`, border: `1px solid ${C.accentDim}`, borderRadius: 6, color: C.accent, padding: '5px 9px', fontSize: 9, fontWeight: 700 }}>Manage</button></td>
          </tr>
          {expanded && <tr><td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}><div style={{ padding: 18, background: C.bg }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9, marginBottom: 12 }}>{details(client).map(([label,value]) => <div key={label} style={{ background: C.surface, borderRadius: 7, padding: 10 }}><div style={{ color: C.muted, fontSize: 8, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div><div style={{ color: C.text, fontSize: 10, wordBreak: 'break-word' }}>{value || 'Not configured'}</div></div>)}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button onClick={() => onDashboard(client)} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '6px 11px', fontSize: 9, fontWeight: 700 }}>Open Dashboard</button><button onClick={() => onManage(client)} style={{ background: C.accent, border: 0, borderRadius: 6, color: '#fff', padding: '6px 11px', fontSize: 9, fontWeight: 700 }}>Manage Brand</button></div>
          </div></td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '15px 16px', borderTop: `1px solid ${C.border}`, background: C.surface, flexWrap: 'wrap' }}>
      <span style={{ color: C.muted, fontSize: 9 }}>
        {totalRecords === 0 ? 'Showing 0 entries' : `Showing ${pageStart + 1} to ${Math.min(pageStart + pageSize, totalRecords)} of ${totalRecords} entries`}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => changePage(page - 1)} disabled={page === 1} aria-label="Previous page" style={{ height: 34, padding: '0 13px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? .4 : 1, fontSize: 10, fontWeight: 600 }}>Previous</button>
        <strong style={{ color: C.text, fontSize: 10, whiteSpace: 'nowrap' }}>Page {page} of {totalPages}</strong>
        <button type="button" onClick={() => changePage(page + 1)} disabled={page === totalPages} aria-label="Next page" style={{ height: 34, padding: '0 13px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? .4 : 1, fontSize: 10, fontWeight: 600 }}>Next</button>
      </div>
    </div>
  </div>;
};
