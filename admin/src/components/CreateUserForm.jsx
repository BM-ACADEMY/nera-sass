import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, MailOutlined, PhoneOutlined, LockOutlined, BankOutlined } from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

const CreateUserForm = ({ onUserCreated }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await axiosClient.post('/auth/users', values);
      message.success('Account successfully provisioned!');
      form.resetFields();
      if(onUserCreated) onUserCreated();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} name="createUser" onFinish={onFinish} layout="vertical">
      <Form.Item name="tenantName" rules={[{ required: true, message: 'Workspace name is required!' }]}>
        <Input prefix={<BankOutlined />} placeholder="Workspace / Tenant Name" size="large" />
      </Form.Item>
      
      <Form.Item name="name" rules={[{ required: true, message: 'Full name is required!' }]}>
        <Input prefix={<UserOutlined />} placeholder="User Full Name" size="large" />
      </Form.Item>
      
      <Form.Item name="email" rules={[{ required: true, message: 'Email is required!', type: 'email' }]}>
        <Input prefix={<MailOutlined />} placeholder="User Email" size="large" />
      </Form.Item>
      
      <Form.Item name="phone">
        <Input prefix={<PhoneOutlined />} placeholder="Phone Number" size="large" />
      </Form.Item>
      
      <Form.Item name="password" rules={[{ required: true, message: 'Password is required!' }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="Initial Password" size="large" />
      </Form.Item>
      
      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          Provision Account
        </Button>
      </Form.Item>
    </Form>
  );
};

export default CreateUserForm;
