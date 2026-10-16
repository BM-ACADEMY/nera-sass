import React, { useState, useEffect } from 'react';
import { Table, Tag, Button, Input, Modal, Form, Select, message, Space, Card } from 'antd';
import { SearchOutlined, EditOutlined, ReloadOutlined, BankOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../api/axiosClient';

const WA_STATUS_TAGS = {
  verified: { color: 'success', label: 'Verified' },
  verification_pending: { color: 'warning', label: 'Pending' },
  verification_failed: { color: 'error', label: 'Failed' },
  not_configured: { color: 'default', label: 'Not Configured' },
};

const ClientsManagement = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editClient, setEditClient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get('/admin/clients', { params: { search: search || undefined } });
      setClients(res.data?.clients || []);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to load client brands');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [search]);

  const handleEdit = (client) => {
    setEditClient(client);
    form.setFieldsValue({
      name: client.name,
      city: client.city,
      phone: client.phone,
      contact_person: client.contact_person,
      whatsapp_number: client.whatsapp_number,
      phone_number_id: client.phone_number_id,
      wa_business_id: client.wa_business_id,
      industry: client.industry,
      status: client.status || 'active',
    });
  };

  const handleSave = async (values) => {
    if (!editClient) return;
    setSaving(true);
    try {
      await axiosClient.patch(`/admin/clients/${editClient.id}`, values);
      message.success(`Brand "${values.name}" updated successfully`);
      setEditClient(null);
      fetchClients();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update brand profile');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: 'Brand / Client Name',
      key: 'name',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 13.5 }}>{r.name}</div>
          <div style={{ fontSize: 11.5, color: '#64748b' }}>
            ID: #{r.id} · Workspace: <Tag color="blue" style={{ fontSize: 11, borderRadius: 10 }}>{r.tenant_name}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: 'WhatsApp Connection',
      key: 'whatsapp',
      render: (_, r) => {
        const tag = WA_STATUS_TAGS[r.whatsapp_status] || WA_STATUS_TAGS.not_configured;
        return (
          <div>
            <Tag color={tag.color} style={{ borderRadius: 12, fontWeight: 600, fontSize: 11 }}>
              <FaWhatsapp style={{ marginRight: 4, verticalAlign: -1 }} />
              {tag.label}
            </Tag>
            {r.whatsapp_number && <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>{r.whatsapp_number}</div>}
          </div>
        );
      },
    },
    {
      title: 'Contact Person & Phone',
      key: 'contact',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#334155' }}>{r.contact_person || '—'}</div>
          <div style={{ fontSize: 11.5, color: '#64748b' }}>{r.phone || r.city || '—'}</div>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (st) => (
        <Tag color={st === 'active' ? 'green' : 'default'} style={{ borderRadius: 12, fontWeight: 600 }}>
          {String(st || 'active').toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_, r) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>
          Edit Brand
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Client Brand Management</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Manage client profiles, WhatsApp configurations, and business metadata across all workspaces.
          </div>
        </div>
        <Space>
          <Input
            placeholder="Search brands or phone..."
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240, borderRadius: 8 }}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={fetchClients} loading={loading}>
            Refresh
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        dataSource={clients}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}
      />

      <Modal
        title={editClient ? `Edit Brand: ${editClient.name}` : 'Edit Brand'}
        open={Boolean(editClient)}
        onCancel={() => setEditClient(null)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Brand / Business Name" rules={[{ required: true }]}>
            <Input size="large" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="contact_person" label="Contact Person">
              <Input size="large" placeholder="Name" />
            </Form.Item>
            <Form.Item name="phone" label="Contact Phone">
              <Input size="large" placeholder="+91..." />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="whatsapp_number" label="WhatsApp Phone Number">
              <Input size="large" placeholder="+91..." />
            </Form.Item>
            <Form.Item name="phone_number_id" label="Meta Phone Number ID">
              <Input size="large" placeholder="10634..." />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="city" label="City">
              <Input size="large" placeholder="City" />
            </Form.Item>
            <Form.Item name="status" label="Brand Status">
              <Select size="large" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            </Form.Item>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <Button onClick={() => setEditClient(null)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              Save Brand Changes
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ClientsManagement;
