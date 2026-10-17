import React, { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, Card, Alert, Select, Popconfirm, Modal, Input, Typography, message } from 'antd';
import { SyncOutlined, LinkOutlined, DisconnectOutlined, DeleteOutlined } from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

const { Text } = Typography;

// Platform Meta WhatsApp inventory. A customer's sending number always comes
// from the customer's own WhatsApp Business account; this view never assigns
// one. "Link" only records that an inventory number is the one a brand already
// uses, and the server refuses it otherwise.
const MetaInventoryView = () => {
  const [data, setData] = useState({ wabas: [], phone_numbers: [], template_summary: [], last_sync: null });
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedWaba, setSelectedWaba] = useState('ALL');
  const [linkTarget, setLinkTarget] = useState({});
  const [registerPhone, setRegisterPhone] = useState(null);
  const [pin, setPin] = useState('');
  const [registering, setRegistering] = useState(false);

  const errorText = (err, fallback) => err.response?.data?.error || fallback;

  const load = async () => {
    setLoading(true);
    try {
      const [inventory, clients] = await Promise.all([
        axiosClient.get('/admin/meta/whatsapp/inventory'),
        axiosClient.get('/admin/clients'),
      ]);
      setData(inventory.data);
      setBrands(clients.data?.clients || []);
    } catch (err) {
      message.error(errorText(err, 'Failed to load the Meta inventory'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await axiosClient.post('/admin/meta/whatsapp/sync');
      message.success(`Synced ${res.data.wabas} WABAs, ${res.data.phone_numbers} numbers, ${res.data.templates} templates`);
      load();
    } catch (err) {
      message.error(errorText(err, 'Meta sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  const link = async (phoneId) => {
    const clientId = linkTarget[phoneId];
    if (!clientId) return message.error('Select the brand that already uses this number');
    try {
      await axiosClient.post(`/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(phoneId)}/link`, { client_id: clientId });
      message.success('Inventory link recorded');
      load();
    } catch (err) {
      message.error(errorText(err, 'Link failed'));
    }
  };

  const unlink = async (phoneId) => {
    try {
      await axiosClient.post(`/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(phoneId)}/unlink`);
      message.success('Inventory link removed');
      load();
    } catch (err) {
      message.error(errorText(err, 'Unlink failed'));
    }
  };

  const clearCache = async (wabaId) => {
    try {
      await axiosClient.delete(`/admin/meta/whatsapp/cache/wabas/${encodeURIComponent(wabaId)}`);
      message.success('Cached inventory cleared');
      setSelectedWaba('ALL');
      load();
    } catch (err) {
      message.error(errorText(err, 'Could not clear the cache'));
    }
  };

  const register = async () => {
    if (!/^\d{6}$/.test(pin)) return message.error('Enter a valid 6-digit PIN');
    setRegistering(true);
    try {
      await axiosClient.post(`/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(registerPhone.phone_number_id)}/register`, { pin });
      message.success('Phone registered with the Cloud API');
      setRegisterPhone(null);
      setPin('');
      load();
    } catch (err) {
      message.error(errorText(err, 'Registration failed'));
    } finally {
      setRegistering(false);
    }
  };

  const phones = data.phone_numbers.filter((p) => selectedWaba === 'ALL' || p.waba_id === selectedWaba);
  const canRegister = data.can_administer && data.registration_enabled && data.credential_configured;

  const columns = [
    {
      title: 'Number',
      key: 'number',
      render: (_, p) => (
        <div>
          <strong>{p.display_phone_number || 'Unknown number'}</strong>
          <div style={{ fontSize: 12, color: '#64748b' }}>{p.verified_name || 'No display name'} · {p.waba_name || p.waba_id}</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>ID: {p.phone_number_id}</div>
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, p) => (
        <Space direction="vertical" size={2}>
          <Tag color={String(p.connection_status).toUpperCase() === 'CONNECTED' ? 'green' : 'orange'}>{p.connection_status || 'Unknown'}</Tag>
          <span style={{ fontSize: 12, color: '#64748b' }}>Quality: {p.quality_rating || 'Unknown'}</span>
        </Space>
      ),
    },
    {
      title: 'Linked brand',
      key: 'brand',
      render: (_, p) => (p.linked_brand ? (
        <div>
          <strong>{p.linked_brand.name}</strong>
          <div style={{ fontSize: 12, color: '#64748b' }}>{p.linked_brand.tenant_name || `Workspace ${p.linked_brand.tenant_id}`}</div>
          {!p.linked_brand.identity_matches && <Tag color="red">Brand now uses a different number</Tag>}
        </div>
      ) : <Text type="secondary">Not linked</Text>),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, p) => (
        <Space wrap>
          {p.linked_brand ? (
            <Popconfirm title="Remove this inventory link? The brand's own WhatsApp connection is not changed." onConfirm={() => unlink(p.phone_number_id)}>
              <Button size="small" icon={<DisconnectOutlined />}>Unlink</Button>
            </Popconfirm>
          ) : (
            <>
              <Select
                size="small"
                style={{ width: 200 }}
                placeholder="Brand using this number"
                value={linkTarget[p.phone_number_id]}
                onChange={(value) => setLinkTarget({ ...linkTarget, [p.phone_number_id]: value })}
                options={brands.map((b) => ({ value: b.id, label: b.name }))}
              />
              <Button size="small" icon={<LinkOutlined />} onClick={() => link(p.phone_number_id)}>Link</Button>
            </>
          )}
          {data.can_administer && String(p.connection_status).toUpperCase() !== 'CONNECTED' && (
            <Button size="small" disabled={!canRegister} title={canRegister ? '' : 'Registration is disabled on this platform'} onClick={() => { setRegisterPhone(p); setPin(''); }}>
              Register
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {!data.credential_configured && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Meta inventory credential not configured"
          description="Sync and registration are unavailable until a dedicated inventory credential is approved and configured. Customers connect their own WhatsApp accounts from their workspace."
        />
      )}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Select
              style={{ width: 280 }}
              value={selectedWaba}
              onChange={setSelectedWaba}
              options={[{ value: 'ALL', label: 'All WABAs' }, ...data.wabas.map((w) => ({ value: w.waba_id, label: `${w.name || w.waba_id} (${w.phone_count})` }))]}
            />
            <Text type="secondary">
              Last sync: {data.last_sync ? `${new Date(data.last_sync.completed_at || data.last_sync.created_at).toLocaleString()} (${data.last_sync.status})` : 'never'}
            </Text>
          </Space>
          <Space>
            {data.can_administer && selectedWaba !== 'ALL' && (
              <Popconfirm title="Clear the cached inventory for this WABA? Nothing is deleted from Meta." onConfirm={() => clearCache(selectedWaba)}>
                <Button danger icon={<DeleteOutlined />}>Clear cache</Button>
              </Popconfirm>
            )}
            <Button type="primary" icon={<SyncOutlined spin={syncing} />} loading={syncing} disabled={!data.credential_configured} onClick={sync}>
              Sync now
            </Button>
          </Space>
        </Space>
      </Card>
      <Card>
        <Table rowKey="phone_number_id" loading={loading} columns={columns} dataSource={phones} pagination={{ pageSize: 20 }} />
      </Card>
      <Modal
        title="Register phone with the Cloud API"
        open={Boolean(registerPhone)}
        onCancel={() => { setRegisterPhone(null); setPin(''); }}
        onOk={register}
        okText="Register"
        confirmLoading={registering}
        okButtonProps={{ disabled: pin.length !== 6 }}
      >
        <p>Number: <strong>{registerPhone?.display_phone_number || registerPhone?.phone_number_id}</strong></p>
        <p style={{ color: '#64748b' }}>Enter the 6-digit two-step verification PIN. It is sent to Meta and never stored.</p>
        <Input.Password maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      </Modal>
    </div>
  );
};

export default MetaInventoryView;
