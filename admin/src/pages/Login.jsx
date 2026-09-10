import React, { useState } from 'react';
import { Form, Input, Button, Alert, Typography } from 'antd';
import { MailOutlined, LockOutlined, ApiOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import axiosClient from '../api/axiosClient';

const { Title, Text } = Typography;

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axiosClient.post('/auth/login', values);
      if (res.data.token) {
        localStorage.setItem('adminToken', res.data.token);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh', 
      backgroundColor: '#f8fafc' 
    }}>
      <div style={{
        background: '#ffffff',
        padding: '40px 32px',
        borderRadius: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
        width: '100%',
        maxWidth: '440px',
        textAlign: 'center',
        border: '1px solid #f1f5f9'
      }}>
        <div style={{ marginBottom: '24px' }}>
          <ApiOutlined style={{ fontSize: '42px', color: '#f97316', marginBottom: '16px' }} />
          <Title level={3} style={{ margin: 0, fontWeight: 600, color: '#0f172a' }}>Sign in to your account</Title>
          <Text style={{ color: '#64748b' }}>Welcome back! Please enter your details.</Text>
        </div>
        
        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 24, textAlign: 'left' }} />}
        
        <Form name="login" onFinish={onFinish} layout="vertical" style={{ textAlign: 'left' }}>
          <Form.Item 
            label={<span style={{ fontWeight: 500, color: '#334155' }}>Email</span>}
            name="email" 
            rules={[{ required: true, message: 'Please input your Email!' }]}
          >
            <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} placeholder="Enter your email" size="large" />
          </Form.Item>
          
          <Form.Item 
            label={<span style={{ fontWeight: 500, color: '#334155' }}>Password</span>}
            name="password" 
            rules={[{ required: true, message: 'Please input your Password!' }]}
          >
            <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder="••••••••" size="large" />
          </Form.Item>
          
          <Form.Item style={{ marginTop: '32px', marginBottom: '24px' }}>
            <Button type="primary" htmlType="submit" loading={loading} block size="large" style={{ fontWeight: 600, height: '44px' }}>
              Sign in
            </Button>
          </Form.Item>
        </Form>

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
          <Text style={{ color: '#94a3b8', fontSize: '13px' }}>
            Protected by <a href="#" style={{ color: '#2563eb' }}>Privacy Policy</a>
          </Text>
        </div>
      </div>
    </div>
  );
};

export default Login;
