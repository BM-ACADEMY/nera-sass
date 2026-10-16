import React, { useEffect, useState } from 'react';
import { Form, Input, Button, message, Select, Spin, Divider } from 'antd';
import { PhoneOutlined, KeyOutlined, IdcardOutlined, SafetyCertificateOutlined, CheckCircleFilled, ClockCircleFilled, CloseCircleFilled, MinusCircleFilled } from '@ant-design/icons';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../api/axiosClient';

const STATUS_META = {
  verified: { label: 'Verified · service enabled', bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d', icon: <CheckCircleFilled /> },
  verification_pending: { label: 'Verification pending', bg: '#fffbeb', border: '#fde68a', color: '#b45309', icon: <ClockCircleFilled /> },
  verification_failed: { label: 'Verification failed', bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', icon: <CloseCircleFilled /> },
  not_configured: { label: 'Not configured', bg: '#f8fafc', border: '#e2e8f0', color: '#64748b', icon: <MinusCircleFilled /> },
};

// Workspaces own their WhatsApp credentials through the same `clients` row
// (and the same /api/clients endpoints) the main LeadOS app already uses for
// its verified Meta WhatsApp flow, so this reuses that flow instead of a
// separate config store per tenant.
const WhatsAppConfigModal = ({ tenantId, tenantName, onClose }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClient] = useState(null);

  const loadClient = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get(`/admin/tenants/${tenantId}`);
      const brand = res.data.brand || null;
      setActiveClient(brand);
      form.setFieldsValue({
        whatsapp_number: brand?.whatsapp_number || '',
        phone_number_id: brand?.phone_number_id || '',
        wa_access_token: '',
        wa_business_id: brand?.wa_business_id || '',
      });
    } catch (err) {
      message.error('Failed to load workspace WhatsApp config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) loadClient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = {
        whatsapp_number: values.whatsapp_number,
        phone_number_id: values.phone_number_id,
        wa_business_id: values.wa_business_id,
      };
      if (values.wa_access_token) {
        payload.wa_access_token = values.wa_access_token;
      }
      const res = await axiosClient.put(`/admin/tenants/${tenantId}/whatsapp`, payload);
      setActiveClient(res.data.brand);
      form.setFieldsValue({ wa_access_token: '' });
      message.success('WhatsApp credentials updated and encrypted for this workspace');
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to save WhatsApp config');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await axiosClient.post(`/admin/tenants/${tenantId}/whatsapp/verify`);
      setActiveClient(res.data.brand);
      message.success('WhatsApp verified and enabled for this workspace');
    } catch (err) {
      message.error(err.response?.data?.error || 'Meta verification failed');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>;
  }

  const status = STATUS_META[activeClient?.whatsapp_status] || STATUS_META.not_configured;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <FaWhatsapp size={19} color="#25D366" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{tenantName}</div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Own credentials for this workspace — never the shared platform .env</div>
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
        background: status.bg, border: `1px solid ${status.border}`, color: status.color,
        borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 600,
      }}>
        {status.icon}
        {status.label}
      </div>

      <Form form={form} layout="vertical">
        <Form.Item name="whatsapp_number" label="WhatsApp Number" rules={[{ required: true, message: 'WhatsApp number is required' }]}>
          <Input prefix={<PhoneOutlined style={{ color: '#94a3b8' }} />} placeholder="+91 98765 43210" size="large" />
        </Form.Item>
        <Form.Item name="phone_number_id" label="Meta Phone Number ID" rules={[{ required: true, message: 'Meta Phone Number ID is required' }]}>
          <Input prefix={<IdcardOutlined style={{ color: '#94a3b8' }} />} placeholder="15-digit ID from Meta" size="large" />
        </Form.Item>
        <Form.Item
          name="wa_access_token"
          label="Meta Access Token"
          extra={activeClient?.wa_token_configured ? `Token is saved and encrypted (ends in ${activeClient.wa_token_last4 || '••••'}). Leave blank to keep current token.` : 'Enter system user access token'}
        >
          <Input.Password prefix={<KeyOutlined style={{ color: '#94a3b8' }} />} placeholder={activeClient?.wa_token_configured ? '••••••••••••••••' : 'EAAG...'} size="large" />
        </Form.Item>
        <Form.Item name="wa_business_id" label="WABA ID" rules={[{ required: true, message: 'WABA ID is required' }]}>
          <Input prefix={<SafetyCertificateOutlined style={{ color: '#94a3b8' }} />} placeholder="WhatsApp Business Account ID" size="large" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button onClick={onClose}>Close</Button>
          {activeClient?.phone_number_id && activeClient?.whatsapp_number && (
            <Button onClick={handleVerify} loading={verifying}>
              {activeClient.whatsapp_status === 'verified' ? 'Re-verify with Meta' : 'Verify & Enable'}
            </Button>
          )}
          <Button type="primary" onClick={handleSave} loading={saving} style={{ background: '#25D366', borderColor: '#25D366' }}>
            Save Config
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default WhatsAppConfigModal;
