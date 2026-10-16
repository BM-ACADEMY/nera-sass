import React, { useState } from 'react';
import { Form, Input, Button, Select, message } from 'antd';
import { UserOutlined, MailOutlined } from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

const sectionLabelStyle = {
  fontSize: 11.5,
  fontWeight: 700,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: 12,
};

// Invites a user into an existing workspace. The invited person receives a
// one-time link and sets their own password; staff never choose or see it.
const CreateUserForm = ({ onUserCreated, onCancel, tenants = [] }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const res = await axiosClient.post('/admin/users', {
        tenant_id: values.tenant_id,
        name: values.name,
        email: values.email,
        role: values.role,
      });
      if (res.data?.delivery?.delivered === false) {
        message.warning('Invitation created, but the email could not be sent. Resend it from the workspace once email is configured.');
      } else {
        message.success(`Invitation sent to ${values.email}`);
      }
      form.resetFields();
      if (onUserCreated) onUserCreated();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 18, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <UserOutlined style={{ fontSize: 20, color: '#2563eb' }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Invite Workspace User</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>The user receives an email link and sets their own password. The workspace's plan user limit applies.</div>
        </div>
      </div>

      <Form
        form={form}
        name="inviteUser"
        onFinish={onFinish}
        layout="vertical"
        initialValues={{ role: 'agent' }}
      >
        <Form.Item
          name="tenant_id"
          rules={[{ required: true, message: 'Choose the workspace this user belongs to' }]}
          label={<span style={sectionLabelStyle}>Workspace</span>}
        >
          <Select
            size="large"
            placeholder={tenants.length ? 'Select workspace' : 'Create a workspace first'}
            disabled={!tenants.length}
            options={tenants.map(t => ({ value: t.id, label: `${t.name} (ID: #${t.id})` }))}
          />
        </Form.Item>

        <Form.Item name="name" label={<span style={sectionLabelStyle}>Name</span>}>
          <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="Full name (optional)" size="large" />
        </Form.Item>

        <Form.Item name="email" rules={[{ required: true, message: 'Email is required!', type: 'email' }]} label={<span style={sectionLabelStyle}>Email</span>}>
          <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} placeholder="Enter email address" size="large" />
        </Form.Item>

        <Form.Item name="role" label={<span style={sectionLabelStyle}>Workspace Role</span>}>
          <Select
            size="large"
            options={[
              { value: 'owner', label: 'Owner (Full Access & Billing)' },
              { value: 'admin', label: 'Admin (Workspace Management)' },
              { value: 'manager', label: 'Manager (Team Management)' },
              { value: 'agent', label: 'Agent (Standard Access)' },
            ]}
          />
        </Form.Item>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
          {onCancel && <Button size="large" onClick={onCancel}>Cancel</Button>}
          <Button type="primary" htmlType="submit" loading={loading} size="large" disabled={!tenants.length}>
            Send Invitation
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default CreateUserForm;
