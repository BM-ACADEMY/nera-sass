import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, MailOutlined, PhoneOutlined, LockOutlined, BankOutlined, PlusCircleOutlined } from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

const sectionLabelStyle = {
  fontSize: 11.5,
  fontWeight: 700,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: 12,
};

const CreateUserForm = ({ onUserCreated, onCancel }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await axiosClient.post('/auth/users', values);
      message.success('Workspace provisioned successfully!');
      form.resetFields();
      if (onUserCreated) onUserCreated();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 18, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <PlusCircleOutlined style={{ fontSize: 20, color: '#2563eb' }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Provision a New Workspace</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Creates a tenant and its first admin user in one step.</div>
        </div>
      </div>

      <Form form={form} name="createUser" onFinish={onFinish} layout="vertical">
        <div style={sectionLabelStyle}>Workspace</div>
        <Form.Item name="tenantName" rules={[{ required: true, message: 'Workspace name is required!' }]} style={{ marginBottom: 20 }}>
          <Input prefix={<BankOutlined style={{ color: '#94a3b8' }} />} placeholder="Workspace / Tenant Name" size="large" />
        </Form.Item>

        <div style={sectionLabelStyle}>Primary Admin User</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="name" rules={[{ required: true, message: 'Full name is required!' }]}>
            <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="Full Name" size="large" />
          </Form.Item>
          <Form.Item name="phone">
            <Input prefix={<PhoneOutlined style={{ color: '#94a3b8' }} />} placeholder="Phone Number" size="large" />
          </Form.Item>
        </div>

        <Form.Item name="email" rules={[{ required: true, message: 'Email is required!', type: 'email' }]}>
          <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} placeholder="Email Address" size="large" />
        </Form.Item>

        <Form.Item name="password" rules={[{ required: true, message: 'Password is required!' }]} extra="Shared with the workspace owner so they can log in for the first time.">
          <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder="Initial Password" size="large" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          {onCancel && <Button size="large" onClick={onCancel}>Cancel</Button>}
          <Button type="primary" htmlType="submit" loading={loading} size="large">
            Provision Workspace
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default CreateUserForm;
