import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Input, Avatar, Button, Modal } from 'antd';
import { 
  FiSearch,
  FiLogOut,
  FiChevronLeft,
  FiChevronRight,
  FiPlus
} from 'react-icons/fi';
import { MdOutlineDashboard } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';
import CreateUserForm from '../components/CreateUserForm';
import UsersList from '../components/UsersList';
import axiosClient from '../api/axiosClient';

const { Content, Sider, Header } = Layout;
const { Title } = Typography;

const Dashboard = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [userProfile, setUserProfile] = useState({ name: 'System Admin', email: '' });
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserProfile({ 
          name: payload.name || 'System Admin', 
          email: payload.email || 'admin@admin.com' 
        });
      } catch (e) {
        console.error("Could not decode token");
      }
    }
    fetchUsers();
  }, []);

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
            <div className="sider-header">
              <div className="search-container" style={{ padding: collapsed ? '24px 0' : '24px 20px 16px', display: 'flex', justifyContent: 'center' }}>
                 {collapsed ? <FiSearch size={22} className="search-icon-collapsed" onClick={() => setCollapsed(false)} style={{ cursor: 'pointer', color: '#94a3b8' }} /> : (
                   <Input 
                     prefix={<FiSearch style={{ color: '#bfbfbf', fontSize: '18px' }} />} 
                     placeholder="Search" 
                     className="custom-search" 
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
              <Avatar src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${userProfile.name}`} size={44} style={{ backgroundColor: '#13c2c2', flexShrink: 0 }} />
              {!collapsed && (
                <div className="user-details" style={{ flex: 1, overflow: 'hidden' }}>
                  <strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userProfile.name}</strong>
                  <span style={{ display: 'block', fontSize: '12px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userProfile.email}</span>
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
              <Title level={5} style={{ marginBottom: 24, color: '#1e293b' }}>Active Users & Workspaces</Title>
              <UsersList users={users} loading={loading} />
            </div>

          </div>
        </Content>
      </Layout>

      <Modal 
        title="Add New Client" 
        open={isModalOpen} 
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        destroyOnClose
        centered
        width={600}
      >
        <CreateUserForm onUserCreated={handleUserCreated} />
      </Modal>

    </Layout>
  );
};

export default Dashboard;
