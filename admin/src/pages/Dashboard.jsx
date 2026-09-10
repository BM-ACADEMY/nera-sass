import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Input, Button, Modal } from 'antd';
import { 
  FiSearch,
  FiLogOut,
  FiChevronLeft,
  FiChevronRight,
  FiPlus
} from 'react-icons/fi';
import { MdOutlineDashboard, MdOutlineSpaceDashboard } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';
import CreateUserForm from '../components/CreateUserForm';
import UsersList from '../components/UsersList';
import WhatsAppConfigModal from '../components/WhatsAppConfigModal';
import UserAvatar from '../components/UserAvatar';
import axiosClient from '../api/axiosClient';

const { Content, Sider, Header } = Layout;
const { Title } = Typography;

const Dashboard = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [whatsAppTarget, setWhatsAppTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await axiosClient.get('/auth/users');
      setUsers(res.data);
    } catch (err) {
      console.error('Failed to fetch users', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await axiosClient.get('/auth/me');
      setUserProfile(res.data);
    } catch (err) {
      console.error('Failed to fetch profile', err);
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchUsers();
  }, []);

  const filteredUsers = users.filter((user) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [user.name, user.email, user.tenant_name, user.role]
      .some(field => (field || '').toLowerCase().includes(q));
  });

  const workspaceCount = new Set(users.map(u => u.tenant_id)).size;

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  const handleUserCreated = () => {
    setIsModalOpen(false);
    fetchUsers();
  };

  const menuItems = [
    { key: '1', icon: <MdOutlineDashboard size={20} />, label: 'Dashboard' }
  ];

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
              <div className="brand-mark">
                <MdOutlineSpaceDashboard size={18} />
              </div>
              {!collapsed && (
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#1e293b', lineHeight: 1.2 }}>LeadOS Admin</div>
                  <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{workspaceCount} workspace{workspaceCount === 1 ? '' : 's'} · {users.length} users</div>
                </div>
              )}
            </div>

            <div className="sider-header">
              <div className="search-container" style={{ padding: collapsed ? '4px 0 20px' : '4px 20px 20px', display: 'flex', justifyContent: 'center' }}>
                 {collapsed ? <FiSearch size={22} className="search-icon-collapsed" onClick={() => setCollapsed(false)} style={{ cursor: 'pointer', color: '#94a3b8' }} /> : (
                   <Input
                     prefix={<FiSearch style={{ color: '#bfbfbf', fontSize: '18px' }} />}
                     placeholder="Search users or workspaces"
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
              defaultSelectedKeys={['1']}
              mode="inline"
              className="custom-menu"
            >
              {menuItems.map(item => (
                <Menu.Item key={item.key} icon={item.icon} className="custom-menu-item">
                  <div className="menu-item-content">
                    <span>{item.label}</span>
                  </div>
                </Menu.Item>
              ))}
            </Menu>
          </div>

          <div className="sider-bottom" style={{ transition: 'all 0.3s ease', padding: collapsed ? '20px 0' : '20px', display: 'flex', justifyContent: 'center' }}>
            <div className="user-profile" style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}>
              <UserAvatar name={userProfile?.name} role={userProfile?.role} size={44} />
              {!collapsed && (
                <div className="user-details" style={{ flex: 1, overflow: 'hidden' }}>
                  <strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userProfile?.name || 'Loading…'}</strong>
                  <span style={{ display: 'block', fontSize: '12px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userProfile?.email || ''}</span>
                </div>
              )}
              {collapsed ? (
                <FiLogOut onClick={handleLogout} style={{ marginTop: 12, cursor: 'pointer', fontSize: 20, color: '#94a3b8', flexShrink: 0 }} />
              ) : (
                <FiLogOut onClick={handleLogout} style={{ cursor: 'pointer', fontSize: 20, color: '#94a3b8', flexShrink: 0 }} />
              )}
            </div>
          </div>
        </div>
      </Sider>

      <Layout className="main-layout" style={{ background: 'transparent' }}>
        <Header style={{ background: '#fff', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <Title level={4} style={{ margin: 0, color: '#1e293b' }}>Users & Workspaces</Title>
        </Header>

        <Content style={{ padding: '32px', overflowY: 'auto' }}>
          
          <div className="dashboard-content" style={{ display: 'block' }}>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
              <Button type="primary" size="large" icon={<FiPlus />} onClick={() => setIsModalOpen(true)} style={{ borderRadius: '8px', fontWeight: 500 }}>
                Add Client
              </Button>
            </div>

            <div className="panel-card" style={{ overflowX: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Title level={5} style={{ margin: 0, color: '#1e293b' }}>Active Users & Workspaces</Title>
                {searchQuery && <span style={{ fontSize: 12, color: '#94a3b8' }}>{filteredUsers.length} of {users.length} shown</span>}
              </div>
              <UsersList users={filteredUsers} loading={loading} onConfigureWhatsApp={setWhatsAppTarget} />
            </div>

          </div>
        </Content>
      </Layout>

      <Modal
        title={null}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
        width={620}
      >
        <CreateUserForm onUserCreated={handleUserCreated} onCancel={() => setIsModalOpen(false)} />
      </Modal>

      <Modal
        title={whatsAppTarget ? `WhatsApp Config — ${whatsAppTarget.tenant_name}` : 'WhatsApp Config'}
        open={!!whatsAppTarget}
        onCancel={() => setWhatsAppTarget(null)}
        footer={null}
        destroyOnClose
        centered
        width={560}
      >
        {whatsAppTarget && (
          <WhatsAppConfigModal
            tenantId={whatsAppTarget.tenant_id}
            tenantName={whatsAppTarget.tenant_name}
            onClose={() => setWhatsAppTarget(null)}
          />
        )}
      </Modal>

    </Layout>
  );
};

export default Dashboard;
