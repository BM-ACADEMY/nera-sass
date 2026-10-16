import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Form, Input, Button, message, Descriptions, Badge, Typography, Divider, Tag } from 'antd';
import { LockOutlined, SettingOutlined, SafetyCertificateOutlined, CloudServerOutlined, ThunderboltOutlined } from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

const { Title, Text } = Typography;

const AdminSettingsView = ({ userProfile }) => {
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm] = Form.useForm();

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      try {
        const res = await axiosClient.get('/admin/settings');
        setSystemInfo(res.data?.system || null);
      } catch (err) {
        // Fallback gracefully
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleChangePassword = async (values) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('New password and confirmation do not match');
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await axiosClient.post('/admin/settings/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // Changing the password signs out every other session; keep this one
      // with the fresh token the server returns.
      if (res.data?.token) localStorage.setItem('adminToken', res.data.token);
      message.success('Password updated. Other sessions have been signed out.');
      passwordForm.resetFields();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Platform Settings & System Configuration</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          Platform infrastructure diagnostics, server runtime environment, and administrator account security.
        </div>
      </div>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card
            title={<span style={{ fontWeight: 700, fontSize: 14 }}><CloudServerOutlined style={{ marginRight: 8, color: '#2563eb' }} />Server Runtime Environment</span>}
            bordered={false}
            style={{ borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 24 }}
          >
            <Descriptions bordered column={1} size="middle">
              <Descriptions.Item label="Environment">
                <Badge status={systemInfo?.environment === 'production' ? 'success' : 'processing'} text={String(systemInfo?.environment || 'development').toUpperCase()} />
              </Descriptions.Item>
              <Descriptions.Item label="Node Runtime">
                {systemInfo?.nodeVersion || 'v22.x'}
              </Descriptions.Item>
              <Descriptions.Item label="API Port">
                {systemInfo?.port || 3600}
              </Descriptions.Item>
              <Descriptions.Item label="Email Outbox Mode">
                <Tag color="cyan" style={{ borderRadius: 10 }}>{systemInfo?.emailDelivery || 'outbox'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="MFA Enforcement">
                <Badge status={systemInfo?.mfaEnforced ? 'success' : 'default'} text={systemInfo?.mfaEnforced ? 'Enabled' : 'Disabled (Dev Mode)'} />
              </Descriptions.Item>
              <Descriptions.Item label="Server Uptime">
                {systemInfo?.uptimeSeconds ? `${Math.floor(systemInfo.uptimeSeconds / 60)} minutes` : 'Active'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title={<span style={{ fontWeight: 700, fontSize: 14 }}><LockOutlined style={{ marginRight: 8, color: '#2563eb' }} />Change Administrator Password</span>}
            bordered={false}
            style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
          >
            <Form form={passwordForm} layout="vertical" onFinish={handleChangePassword}>
              <Form.Item
                name="currentPassword"
                label={<span style={{ fontSize: 12.5, fontWeight: 600 }}>Current Password</span>}
                rules={[{ required: true, message: 'Current password is required' }]}
              >
                <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" />
              </Form.Item>

              <Form.Item
                name="newPassword"
                label={<span style={{ fontSize: 12.5, fontWeight: 600 }}>New Password</span>}
                rules={[
                  { required: true, message: 'New password is required' },
                  { min: 10, message: 'Password must be at least 10 characters' },
                ]}
              >
                <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label={<span style={{ fontSize: 12.5, fontWeight: 600 }}>Confirm New Password</span>}
                rules={[{ required: true, message: 'Please confirm your new password' }]}
              >
                <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" />
              </Form.Item>

              <Button type="primary" htmlType="submit" size="large" block loading={passwordLoading} style={{ borderRadius: 8, fontWeight: 600, marginTop: 8 }}>
                Update Admin Password
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminSettingsView;
