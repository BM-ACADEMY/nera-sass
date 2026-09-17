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
      message.success('User created successfully!');
      form.resetFields();
      if (onUserCreated) onUserCreated();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create user');
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
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Create Client User</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Create a client user account. Workspace and project assignments can be managed separately.</div>
        </div>
      </div>

      <Form form={form} name="createUser" onFinish={onFinish} layout="vertical">
        <Form.Item name="name" rules={[{ required: true, message: 'Username is required!' }]} label={<span style={sectionLabelStyle}>Username</span>}>
          <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="Enter username" size="large" />
        </Form.Item>

        <Form.Item name="email" rules={[{ required: true, message: 'Email is required!', type: 'email' }]} label={<span style={sectionLabelStyle}>User Email</span>}>
          <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} placeholder="Enter email address" size="large" />
        </Form.Item>

        <Form.Item name="phone" label={<span style={sectionLabelStyle}>User Phone Number</span>}>
          <Input prefix={<PhoneOutlined style={{ color: '#94a3b8' }} />} placeholder="Enter phone number" size="large" />
        </Form.Item>

        <Form.Item name="password" rules={[{ required: true, message: 'Password is required!' }]} label={<span style={sectionLabelStyle}>User Password</span>}>
          <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder="Enter password" size="large" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          {onCancel && <Button size="large" onClick={onCancel}>Cancel</Button>}
          <Button type="primary" htmlType="submit" loading={loading} size="large">
            Create User
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default CreateUserForm;
