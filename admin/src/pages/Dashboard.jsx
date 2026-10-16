import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Input, Button, Modal, message, Select } from 'antd';
import { 
  FiSearch,
  FiLogOut,
  FiChevronLeft,
  FiChevronRight,
  FiPlus,
  FiUsers,
  FiBriefcase,
  FiActivity,
  FiBarChart2,
  FiSettings
} from 'react-icons/fi';
import { MdOutlineDashboard, MdOutlineSpaceDashboard } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';
import CreateUserForm from '../components/CreateUserForm';
import CreateTenantModal from '../components/CreateTenantModal';
import WhatsAppConfigModal from '../components/WhatsAppConfigModal';
import TenantsList from '../components/TenantsList';
import UsersList from '../components/UsersList';
import UserAvatar from '../components/UserAvatar';
import StatsCards from '../components/StatsCards';
import RoleFilter from '../components/RoleFilter';
import ClientsManagement from '../components/ClientsManagement';
import WorkflowLogsView from '../components/WorkflowLogsView';
import FounderReportsView from '../components/FounderReportsView';
import AdminSettingsView from '../components/AdminSettingsView';
import axiosClient from '../api/axiosClient';

const { Content, Sider, Header } = Layout;
const { Title } = Typography;

const Dashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('tenants'); // 'tenants' | 'clients' | 'workflows' | 'founder-reports' | 'users' | 'settings'
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  // Modals
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [whatsappModalTenant, setWhatsappModalTenant] = useState(null);
  const [suspendModalTenant, setSuspendModalTenant] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);
  const [roleModalUser, setRoleModalUser] = useState(null);
  const [newRole, setNewRole] = useState('agent');
  const [isChangingRole, setIsChangingRole] = useState(false);

  const fetchTenants = async () => {
    try {
      const res = await axiosClient.get('/admin/tenants');
      setTenants(res.data?.tenants || []);
    } catch (err) {
      console.error('Failed to fetch tenants', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await axiosClient.get('/admin/users');
      setUsers(res.data?.users || []);
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await axiosClient.get('/admin/me');
      setUserProfile(res.data?.user || null);
    } catch (err) {
      console.error('Failed to fetch admin profile', err);
    }
  };

  const reloadAll = async () => {
    setLoading(true);
    await Promise.all([fetchProfile(), fetchTenants(), fetchUsers()]);
    setLoading(false);
  };

  useEffect(() => {
    reloadAll();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  // User Actions
  const handleToggleActive = async (targetUser) => {
    const action = targetUser.is_active !== false ? 'deactivate' : 'reactivate';
    try {
      await axiosClient.post(`/admin/users/${targetUser.id}/${action}`);
      message.success(`User ${action}d successfully`);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.error || `Failed to ${action} user`);
    }
  };

  const handleRevokeSessions = async (targetUser) => {
    try {
      await axiosClient.post(`/admin/users/${targetUser.id}/revoke-sessions`);
      message.success(`Sessions revoked for ${targetUser.name || 'user'}`);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to revoke sessions');
    }
  };

  const handleResetMfa = async (targetUser) => {
    try {
      await axiosClient.post(`/admin/users/${targetUser.id}/reset-mfa`);
      message.success(`MFA reset for ${targetUser.name || 'user'}`);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to reset MFA');
    }
  };

  const handleSaveRole = async () => {
    if (!roleModalUser) return;
    setIsChangingRole(true);
    try {
      await axiosClient.patch(`/admin/users/${roleModalUser.id}/role`, { role: newRole });
      message.success('User role updated successfully');
      setRoleModalUser(null);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update user role');
    } finally {
      setIsChangingRole(false);
    }
  };

  // Tenant Lifecycle Actions
  const handleConfirmSuspend = async () => {
    if (!suspendModalTenant) return;
    if (!suspendReason.trim()) {
      message.error('Please enter a reason for suspension');
      return;
    }
    setIsSuspending(true);
    try {
      await axiosClient.post(`/admin/tenants/${suspendModalTenant.id}/suspend`, { reason: suspendReason.trim() });
      message.success(`Workspace "${suspendModalTenant.name}" has been suspended`);
      setSuspendModalTenant(null);
      setSuspendReason('');
      fetchTenants();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to suspend workspace');
    } finally {
      setIsSuspending(false);
    }
  };

  const handleReinstate = async (tenant) => {
    try {
      await axiosClient.post(`/admin/tenants/${tenant.id}/reinstate`);
      message.success(`Workspace "${tenant.name}" has been reinstated`);
      fetchTenants();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to reinstate workspace');
    }
  };

  // Filtering
  const filteredUsers = users
    .filter((user) => roleFilter === 'all' || (user.staff_role || user.role) === roleFilter)
    .filter((user) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [user.name, user.email, user.role, user.staff_role]
        .some(field => String(field || '').toLowerCase().includes(q));
    });

  const filteredTenants = tenants.filter((tenant) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [tenant.name, tenant.brand?.name, tenant.owner?.name, tenant.owner?.email, tenant.brand?.whatsapp_number]
      .some(field => String(field || '').toLowerCase().includes(q));
  });

  const menuItems = [
    { key: 'tenants', icon: <MdOutlineSpaceDashboard size={19} />, label: 'Workspaces' },
    { key: 'clients', icon: <FiBriefcase size={18} />, label: 'Client Brands' },
    { key: 'workflows', icon: <FiActivity size={18} />, label: 'Workflow Logs' },
    { key: 'founder-reports', icon: <FiBarChart2 size={18} />, label: 'Founder Reports' },
    { key: 'users', icon: <FiUsers size={18} />, label: 'All Users' },
    { key: 'settings', icon: <FiSettings size={18} />, label: 'Settings' },
  ];

  const getTabTitle = () => {
    switch (activeTab) {
      case 'tenants': return 'Workspaces & Tenants';
      case 'clients': return 'Client Brands & WhatsApp Profiles';
      case 'workflows': return 'Workflow Automation Engines';
      case 'founder-reports': return 'Founder Reports & Platform MRR';
      case 'users': return 'User Directory';
      case 'settings': return 'Platform Settings & Infrastructure';
      default: return 'Platform Administration';
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <Sider 
        collapsible 
        collapsed={collapsed} 
        onCollapse={(value) => setCollapsed(value)}
        theme="light"
        width={260}
        breakpoint="md"
        className="custom-sider"
        trigger={null}
        style={{ transition: 'all 0.3s ease', position: 'relative', overflow: 'visible' }}
      >
        <Button 
          type="text" 
          icon={collapsed ? <FiChevronRight size={20} /> : <FiChevronLeft size={20} />} 
          onClick={() => setCollapsed(!collapsed)}
          style={{ 
            position: 'absolute', 
            right: -16, 
            top: 32, 
            background: '#fff', 
            border: '1px solid #e2e8f0', 
            borderRadius: '50%', 
            padding: '4px', 
            zIndex: 100, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: 32, 
            width: 32, 
            boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
            color: '#64748b'
          }}
        />
        <div className="sider-content">
          <div className="sider-top">
            <div className="sider-brand" style={{ padding: collapsed ? '22px 0 14px' : '22px 20px 14px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
              <div className="brand-mark" style={{ background: '#2563eb', color: '#fff', borderRadius: 8, padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MdOutlineSpaceDashboard size={20} />
              </div>
              {!collapsed && (
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', lineHeight: 1.2 }}>Nera Platform</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {tenants.length} workspace{tenants.length === 1 ? '' : 's'} · {users.length} users
                  </div>
                </div>
              )}
            </div>

            <div className="sider-header">
              <div className="search-container" style={{ padding: collapsed ? '4px 0 20px' : '4px 20px 20px', display: 'flex', justifyContent: 'center' }}>
                 {collapsed ? <FiSearch size={22} className="search-icon-collapsed" onClick={() => setCollapsed(false)} style={{ cursor: 'pointer', color: '#94a3b8' }} /> : (
                   <Input
                     prefix={<FiSearch style={{ color: '#bfbfbf', fontSize: '18px' }} />}
                     placeholder={activeTab === 'tenants' ? 'Search workspaces...' : activeTab === 'users' ? 'Search users...' : 'Search...'}
                     className="custom-search"
                     allowClear
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                   />
                 )}
              </div>
            </div>

            <Menu
              theme="light"
              selectedKeys={[activeTab]}
              onClick={({ key }) => { setActiveTab(key); setSearchQuery(''); }}
              mode="inline"
              className="custom-menu"
              items={menuItems}
            />
          </div>

          <div className="sider-bottom" style={{ transition: 'all 0.3s ease', padding: collapsed ? '20px 0' : '20px', display: 'flex', justifyContent: 'center' }}>
            <div className="user-profile" style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}>
              <UserAvatar name={userProfile?.name} role={userProfile?.staff_role || 'superadmin'} size={44} />
              {!collapsed && (
                <div className="user-details" style={{ flex: 1, overflow: 'hidden' }}>
                  <strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>
                    {userProfile?.name || 'Platform Admin'}
                  </strong>
                  <span style={{ display: 'block', fontSize: '11.5px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {userProfile?.email || ''}
                  </span>
                </div>
              )}
              <FiLogOut onClick={handleLogout} title="Log out" style={{ cursor: 'pointer', fontSize: 20, color: '#94a3b8', flexShrink: 0 }} />
            </div>
          </div>
        </div>
      </Sider>

      <Layout className="main-layout" style={{ background: 'transparent' }}>
        <Header style={{ background: '#fff', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <Title level={4} style={{ margin: 0, color: '#1e293b' }}>
            {getTabTitle()}
          </Title>
        </Header>

        <Content style={{ padding: '32px', overflowY: 'auto' }}>
          <div className="dashboard-content" style={{ display: 'block' }}>

            {(activeTab === 'tenants' || activeTab === 'users') && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
                  {activeTab === 'tenants' ? (
                    <Button
                      type="primary"
                      size="large"
                      icon={<FiPlus />}
                      onClick={() => setIsTenantModalOpen(true)}
                      style={{ borderRadius: '8px', fontWeight: 600, background: '#2563eb' }}
                    >
                      Provision Workspace
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      size="large"
                      icon={<FiPlus />}
                      onClick={() => setIsUserModalOpen(true)}
                      style={{ borderRadius: '8px', fontWeight: 600 }}
                    >
                      Create User
                    </Button>
                  )}
                </div>

                <StatsCards users={users} tenantCount={tenants.length} />
              </>
            )}

            {activeTab === 'tenants' && (
              <div className="panel-card" style={{ overflowX: 'auto', background: '#fff', padding: 24, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div className="panel-card-header" style={{ marginBottom: 20 }}>
                  <div>
                    <Title level={5} style={{ margin: 0, color: '#1e293b' }}>All Workspaces</Title>
                    <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
                      {filteredTenants.length} of {tenants.length} workspace{tenants.length === 1 ? '' : 's'} shown
                    </span>
                  </div>
                </div>
                <TenantsList
                  tenants={filteredTenants}
                  loading={loading}
                  onConfigureWhatsApp={(tenant) => setWhatsappModalTenant(tenant)}
                  onSuspendTenant={(tenant) => { setSuspendModalTenant(tenant); setSuspendReason(''); }}
                  onReinstateTenant={handleReinstate}
                  onViewTenant={(tenant) => setWhatsappModalTenant(tenant)}
                />
              </div>
            )}

            {activeTab === 'users' && (
              <div className="panel-card" style={{ overflowX: 'auto', background: '#fff', padding: 24, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div className="panel-card-header" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Title level={5} style={{ margin: 0, color: '#1e293b' }}>Active Users</Title>
                    <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
                      {filteredUsers.length} of {users.length} account{users.length === 1 ? '' : 's'} shown
                    </span>
                  </div>
                  <RoleFilter users={users} value={roleFilter} onChange={setRoleFilter} />
                </div>
                <UsersList
                  users={filteredUsers}
                  loading={loading}
                  onChangeRole={(user) => { setRoleModalUser(user); setNewRole(user.role || 'agent'); }}
                  onToggleActive={handleToggleActive}
                  onRevokeSessions={handleRevokeSessions}
                  onResetMfa={handleResetMfa}
                />
              </div>
            )}

            {activeTab === 'clients' && <ClientsManagement />}

            {activeTab === 'workflows' && <WorkflowLogsView />}

            {activeTab === 'founder-reports' && <FounderReportsView />}

            {activeTab === 'settings' && <AdminSettingsView userProfile={userProfile} />}

          </div>
        </Content>
      </Layout>

      {/* Provision Workspace Modal */}
      <Modal
        open={isTenantModalOpen}
        onCancel={() => setIsTenantModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
        width={640}
      >
        <CreateTenantModal
          onTenantCreated={() => { setIsTenantModalOpen(false); fetchTenants(); fetchUsers(); }}
          onCancel={() => setIsTenantModalOpen(false)}
        />
      </Modal>

      {/* Create User Modal */}
      <Modal
        open={isUserModalOpen}
        onCancel={() => setIsUserModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
        width={580}
      >
        <CreateUserForm
          tenants={tenants}
          onUserCreated={() => { setIsUserModalOpen(false); fetchUsers(); }}
          onCancel={() => setIsUserModalOpen(false)}
        />
      </Modal>

      {/* WhatsApp Configuration Modal */}
      <Modal
        open={Boolean(whatsappModalTenant)}
        onCancel={() => setWhatsappModalTenant(null)}
        footer={null}
        destroyOnClose
        centered
        width={600}
      >
        {whatsappModalTenant && (
          <WhatsAppConfigModal
            tenantId={whatsappModalTenant.id}
            tenantName={whatsappModalTenant.name}
            onClose={() => { setWhatsappModalTenant(null); fetchTenants(); }}
          />
        )}
      </Modal>

      {/* Suspend Tenant Modal */}
      <Modal
        title={`Suspend Workspace: ${suspendModalTenant?.name}`}
        open={Boolean(suspendModalTenant)}
        onCancel={() => setSuspendModalTenant(null)}
        onOk={handleConfirmSuspend}
        okText="Confirm Suspension"
        okButtonProps={{ danger: true, loading: isSuspending }}
      >
        <div style={{ margin: '16px 0' }}>
          <p style={{ color: '#475569', fontSize: 13 }}>
            Suspension blocks all customer logins for this workspace while safely retaining all leads, conversations and settings.
          </p>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Reason for suspension:</div>
          <Input.TextArea
            rows={3}
            placeholder="e.g. Non-payment beyond grace period / Terms violation"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
          />
        </div>
      </Modal>

      {/* Change Role Modal */}
      <Modal
        title={`Change Role: ${roleModalUser?.name || 'User'}`}
        open={Boolean(roleModalUser)}
        onCancel={() => setRoleModalUser(null)}
        onOk={handleSaveRole}
        confirmLoading={isChangingRole}
      >
        <div style={{ margin: '20px 0' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Select New Role:</div>
          <Select
            value={newRole}
            onChange={setNewRole}
            style={{ width: '100%' }}
            size="large"
            options={[
              { value: 'owner', label: 'Owner (Full workspace access & billing)' },
              { value: 'admin', label: 'Admin (Team management & settings)' },
              { value: 'manager', label: 'Manager (Lead & campaign operations)' },
              { value: 'agent', label: 'Agent (Inbox & customer communication)' },
            ]}
          />
        </div>
      </Modal>

    </Layout>
  );
};

export default Dashboard;
