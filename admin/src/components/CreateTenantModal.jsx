import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Select, Switch, Alert, message } from 'antd';
import {
  BankOutlined,
  MailOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  CheckCircleFilled,
  WarningFilled,
} from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

// Creates the workspace, brand profile and subscription, and emails the Owner
// a one-time invitation. The Owner sets their own password from that email;
// staff never choose or see it.
const CreateTenantModal = ({ onTenantCreated, onCancel }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  // Plans come only from the server's catalogue; there is no built-in list.
  const [availablePlans, setAvailablePlans] = useState([]);
  const [plansState, setPlansState] = useState('loading'); // loading | ready | unavailable
  const [createdResult, setCreatedResult] = useState(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await axiosClient.get('/admin/plans');
        const plans = res.data?.plans || [];
        setAvailablePlans(plans.map(p => ({
          code: p.code,
          name: `${p.name} (₹${p.monthly_price?.toLocaleString('en-IN')}/mo · ${p.limits?.max_users === -1 ? 'unlimited' : p.limits?.max_users} users)`,
        })));
        setPlansState(plans.length ? 'ready' : 'unavailable');
      } catch (err) {
        setPlansState('unavailable');
      }
    }
    loadPlans();
  }, []);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const payload = {
        business_name: values.business_name?.trim(),
        owner_name: values.owner_name?.trim(),
        owner_email: values.owner_email?.trim().toLowerCase(),
        plan_code: values.plan_code,
        term_months: Number(values.term_months || 12),
        // A manual grant: staff record who approved it (their own login), the
        // approval/bank reference and why. Nothing is filled in automatically.
        payment_reference: values.payment_reference?.trim(),
        grant_reason: values.grant_reason?.trim(),
        is_founding_client: Boolean(values.is_founding_client),
        settings: {
          language: values.language || 'en',
          currency: values.currency || 'INR',
          tax_treatment: 'gst',
          timezone: 'Asia/Kolkata',
        },
      };

      const res = await axiosClient.post('/admin/tenants', payload);
      message.success(`Workspace "${payload.business_name}" provisioned`);
      form.resetFields();
      setCreatedResult(res.data);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to provision workspace');
    } finally {
      setLoading(false);
    }
  };

  // If the invitation email could not be sent, staff send a fresh link (the
  // previous one stops working). The Owner still sets their own password.
  const handleResendInvitation = async () => {
    if (!createdResult?.tenant?.id || !createdResult?.invitation?.id) return;
    setResending(true);
    try {
      const res = await axiosClient.post(`/admin/tenants/${createdResult.tenant.id}/invitations/${createdResult.invitation.id}/resend`);
      setCreatedResult((current) => ({ ...current, invitation: res.data.invitation, delivery: res.data.delivery }));
      if (res.data?.delivery?.delivered === false) message.warning('The invitation email still could not be sent. Check the email settings.');
      else message.success('Invitation email sent');
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to resend invitation');
    } finally {
      setResending(false);
    }
  };

  const handleFinishAndClose = () => {
    if (onTenantCreated && createdResult) {
      onTenantCreated(createdResult);
    } else if (onCancel) {
      onCancel();
    }
  };

  // Success view: the workspace exists and the Owner has been invited.
  if (createdResult) {
    const delivered = createdResult.delivery?.delivered !== false;
    return (
      <div style={{ padding: '8px 12px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: delivered ? '#f0fdf4' : '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          {delivered
            ? <CheckCircleFilled style={{ fontSize: 32, color: '#16a34a' }} />
            : <WarningFilled style={{ fontSize: 32, color: '#d97706' }} />}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>
          Workspace Provisioned
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          {delivered
            ? 'The Owner has been emailed an invitation and will set their own password.'
            : 'The workspace was created, but the invitation email could not be sent. Resend it once email delivery works.'}
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, textAlign: 'left', marginBottom: 20 }}>
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Workspace</span>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
              {createdResult.tenant?.name} <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: 12 }}>(ID: #{createdResult.tenant?.id})</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Owner Invited</span>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b', wordBreak: 'break-all' }}>{createdResult.invitation?.email}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Invitation</span>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: delivered ? '#15803d' : '#b45309' }}>
                {delivered ? 'Email sent' : 'Not sent'}
                {createdResult.invitation?.expires_at && (
                  <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#94a3b8' }}>
                    Expires {new Date(createdResult.invitation.expires_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {!delivered && (
            <Button size="large" loading={resending} onClick={handleResendInvitation} style={{ borderRadius: 8 }}>
              Resend Invitation
            </Button>
          )}
          <Button type="primary" size="large" onClick={handleFinishAndClose} style={{ borderRadius: 8, fontWeight: 600, minWidth: 100 }}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <BankOutlined style={{ fontSize: 22, color: '#2563eb' }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Provision New Workspace</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Creates the workspace, brand profile and subscription, and emails the Owner an invitation to set their own password.
          </div>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          term_months: 12,
          language: 'en',
          currency: 'INR',
          is_founding_client: false,
        }}
      >
        {plansState === 'unavailable' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            title="Plan catalogue unavailable"
            description="The plan catalogue could not be loaded, so workspaces cannot be created right now. Load the catalogue on the server, then reopen this form."
          />
        )}
        <Form.Item
          name="business_name"
          label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Business / Brand Name</span>}
          rules={[{ required: true, message: 'Business name is required' }]}
        >
          <Input prefix={<BankOutlined style={{ color: '#94a3b8' }} />} placeholder="e.g. Acme Motors" size="large" />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            name="owner_name"
            label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Owner Full Name</span>}
            rules={[{ required: true, message: 'Owner name is required' }]}
          >
            <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="e.g. Rajesh Kumar" size="large" />
          </Form.Item>

          <Form.Item
            name="owner_email"
            label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Owner Email</span>}
            rules={[{ required: true, message: 'Owner email is required', type: 'email' }]}
            extra="The Owner receives a one-time invitation link here."
          >
            <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} placeholder="owner@company.com" size="large" />
          </Form.Item>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <Form.Item
            name="plan_code"
            label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Subscription Plan</span>}
            rules={[{ required: true, message: 'Plan is required' }]}
          >
            <Select
              size="large"
              placeholder={plansState === 'loading' ? 'Loading plan catalogue…' : 'Select a plan'}
              disabled={plansState !== 'ready'}
              options={availablePlans.map(p => ({ value: p.code, label: p.name }))}
            />
          </Form.Item>

          <Form.Item
            name="term_months"
            label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Term</span>}
            rules={[{ required: true }]}
          >
            <Select
              size="large"
              options={[
                { value: 1, label: '1 Month' },
                { value: 3, label: '3 Months (5% off)' },
                { value: 6, label: '6 Months (10% off)' },
                { value: 12, label: '12 Months (15% off)' },
              ]}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="payment_reference"
          label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Manual Grant Reference</span>}
          rules={[
            { required: true, whitespace: true, message: 'Enter the approval or bank reference for this grant' },
            { min: 3, max: 120, message: 'Reference must be 3–120 characters' },
          ]}
          extra="This workspace is created as a manual grant authorized by you. Enter the approval or bank-transfer reference. Razorpay payments are recorded automatically, not here."
        >
          <Input prefix={<SafetyCertificateOutlined style={{ color: '#94a3b8' }} />} placeholder="Approval or bank reference" size="large" />
        </Form.Item>

        <Form.Item
          name="grant_reason"
          label={<span style={{ fontWeight: 600, fontSize: 12.5 }}>Reason for Manual Grant</span>}
          rules={[
            { required: true, whitespace: true, message: 'Explain why this grant is authorized' },
            { min: 10, max: 500, message: 'Reason must be 10–500 characters' },
          ]}
          extra="Recorded in the audit log with your name."
        >
          <Input.TextArea rows={2} placeholder="e.g. Pilot client approved by the founder; paid by bank transfer" maxLength={500} />
        </Form.Item>

        <Form.Item name="is_founding_client" valuePropName="checked" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>Founding Client Status</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Flag this workspace as a launch pilot founding client</div>
            </div>
            <Switch defaultChecked={false} />
          </div>
        </Form.Item>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
          {onCancel && <Button size="large" onClick={onCancel}>Cancel</Button>}
          <Button type="primary" htmlType="submit" loading={loading} disabled={plansState !== 'ready'} size="large" style={{ borderRadius: 8, fontWeight: 600 }}>
            Provision Workspace
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default CreateTenantModal;
