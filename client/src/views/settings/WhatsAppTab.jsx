import { connectWhatsApp, whatsappSummary } from './settingsPolicy.js';
import { useNavigate } from 'react-router-dom';
import { SectionTitle, ReadOnly, Button, Notice } from './ui.jsx';

// WhatsApp: connection status only. No credential is shown or entered here.
// "Connect WhatsApp" is the entry point for secure customer-owned signup and
// stays disabled until the server reports that signup is enabled.
export const WhatsAppTab = ({ brand, tenantInfo, signupConfig }) => {
  const summary = whatsappSummary(brand);
  const connect = connectWhatsApp({ permissions: tenantInfo?.permissions, signupConfig });
  const navigate = useNavigate();

  return (
    <div>
      <SectionTitle>WhatsApp</SectionTitle>
      <Notice tone="muted">Status, quality and your WhatsApp business profile are on the WhatsApp Number page.</Notice>
      <div style={{ margin: '10px 0 18px' }}>
        <Button type="button" onClick={() => navigate('/whatsapp')}>Open WhatsApp Number</Button>
      </div>
      <ReadOnly label="Connection" value={summary.status} />
      <ReadOnly label="WhatsApp number" value={summary.number} />
      <ReadOnly label="Phone Number ID" value={summary.phoneId} />
      <ReadOnly label="WhatsApp Business Account" value={summary.wabaId} />
      <ReadOnly label="Access credential" value={summary.credential} />
      {connect.visible && (
        <div style={{ marginTop: 18 }}>
          {!connect.enabled && <Notice tone="muted">{connect.reason}</Notice>}
          <Button type="button" disabled={!connect.enabled} title={connect.enabled ? '' : connect.reason}>
            Connect WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
};
