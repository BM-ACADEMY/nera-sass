import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';
import { ClientModal } from '../components/ClientModal.jsx';
import { ClientDashboardModal } from '../components/ClientDashboardModal.jsx';
import { ClientsTable } from '../components/ClientsTable.jsx';

export const ClientsView = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [dashboardClient, setDashboardClient] = useState(null);

  const fetchClients = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getClients();
      setClients(data.clients || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const displayClients = clients || [];

  const activeClients = displayClients.filter(c => c.status === 'active' || c.status === 'Live');
  
  const totalLeads = displayClients.reduce((a, b) => a + parseInt(b.lead_count || b.leads || 0), 0);
  const totalConverted = displayClients.reduce((a, b) => a + parseInt(b.converted_count || b.conv || 0), 0);
  const avgConv = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) + '%' : '0%';
  
  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Inter',sans-serif", fontSize: 21, fontWeight: 800, color: C.text }}>Client Management</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>External businesses using LeadOS via BM TechX {loading && '(loading...)'}</p>
        </div>
        <button onClick={() => { setSelectedClient(null); setIsModalOpen(true); }} style={{ background: C.accent, border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Plus size={12} />Onboard Client</button>
      </div>
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 22 }}>
        {[
          ['Active', activeClients.length.toString(), C.green],
          ['Total Leads Managed', totalLeads.toString(), C.blue],
          ['Avg Conversion', avgConv, C.purple]
        ].map(([l, v, col]) => (
          <div key={l} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 11, padding: '14px 18px', flex: 1 }}>
            <p style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>{l}</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: col, fontFamily: "'Inter',sans-serif" }}>{v}</p>
          </div>
        ))}
      </div>
      <ClientsTable clients={displayClients} onDashboard={cl => { setDashboardClient(cl); setIsDashboardOpen(true); }} onManage={cl => { setSelectedClient(cl); setIsModalOpen(true); }} />
      {false && <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {displayClients.map((cl) => {
          const leads = cl.lead_count ?? cl.leads ?? 0;
          const converted = cl.converted_count ?? cl.conv ?? 0;
          return (
            <div key={cl.id} style={{ background: C.card, border: '1px solid ' + (cl.status === 'active' ? C.border : C.dim), borderRadius: 14, padding: 20, opacity: cl.status === 'inactive' ? 0.65 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: C.accent + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: C.accent }}>{cl.name[0]}</div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{cl.name}</p>
                    <p style={{ fontSize: 10, color: C.muted }}>{cl.type || 'Business'} - {new Date(cl.joined_at || cl.created_at || Date.now()).toLocaleDateString()}</p>
                  </div>
                </div>
                <span style={{ background: cl.status === 'active' ? '#0a2018' : '#1a1a1a', color: cl.status === 'active' ? C.green : C.muted, padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: 600 }}>{cl.status === 'active' ? 'Active' : 'Inactive'}</span>
              </div>
              <div style={{ display: 'flex', gap: 11, marginBottom: 14 }}>
                {[['Leads', leads, C.blue], ['Converted', converted, C.green], ['Conversion', leads > 0 ? Math.round((converted / leads) * 100) + '%' : '0%', C.purple]].map(([l, v, col]) => (
                  <div key={l} style={{ flex: 1, background: C.surface, borderRadius: 7, padding: '9px 11px', textAlign: 'center' }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: col, fontFamily: "'Inter',sans-serif" }}>{v}</p>
                    <p style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{l}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, borderRadius: 7, padding: '8px 11px' }}>
                <span style={{ color: C.muted, fontSize: 10 }}>WhatsApp</span>
                <span style={{ color: cl.whatsapp_status === 'verified' ? C.green : cl.whatsapp_status === 'verification_failed' ? C.red : C.muted, fontSize: 10, fontWeight: 700 }}>
                  {cl.whatsapp_status === 'verified' ? 'Verified · Enabled' : cl.whatsapp_status === 'verification_pending' ? 'Verification Pending' : cl.whatsapp_status === 'verification_failed' ? 'Verification Failed' : 'Not Configured'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button onClick={() => { setDashboardClient(cl); setIsDashboardOpen(true); }} style={{ flex: 1, background: 'transparent', border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '6px', fontSize: 11, fontWeight: 600 }}>Dashboard</button>
                <button onClick={() => { setSelectedClient(cl); setIsModalOpen(true); }} style={{ flex: 1, background: C.accent + '20', border: '1px solid ' + C.accentDim, borderRadius: 7, color: C.accent, padding: '6px', fontSize: 11, fontWeight: 600 }}>Manage</button>
              </div>
            </div>
          );
        })}
      </div>}
      {isModalOpen && (
        <ClientModal
          client={selectedClient}
          onClose={() => setIsModalOpen(false)}
          onUpdate={fetchClients}
        />
      )}
      {isDashboardOpen && (
        <ClientDashboardModal
          client={dashboardClient}
          onClose={() => setIsDashboardOpen(false)}
        />
      )}
    </div>
  );
};
