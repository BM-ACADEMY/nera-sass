import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Button, Space } from 'antd';
import { 
  LogoutOutlined, 
  UsergroupAddOutlined, 
  DashboardOutlined, 
  SettingOutlined 
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import CreateUserForm from '../components/CreateUserForm';
import UsersList from '../components/UsersList';
import axiosClient from '../api/axiosClient';

const { Header, Content, Sider } = Layout;
const { Title } = Typography;

const Dashboard = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

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
    fetchUsers();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider 
        collapsible 
        collapsed={collapsed} 
        onCollapse={(value) => setCollapsed(value)}
        theme="dark"
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <Title level={4} style={{ color: 'white', margin: 0 }}>
            {collapsed ? 'SaaS' : 'SaaS Admin'}
          </Title>
        </div>
        <Menu 
          theme="dark" 
          defaultSelectedKeys={['1']} 
          mode="inline" 
          items={[
            { key: '1', icon: <DashboardOutlined />, label: 'Dashboard' },
            { key: '2', icon: <UsergroupAddOutlined />, label: 'Users & Workspaces' },
            { key: '3', icon: <SettingOutlined />, label: 'Settings' }
          ]} 
        />
      </Sider>

      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
          <Space>
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>Log Out</Button>
          </Space>
        </Header>
        
        <Content style={{ padding: '24px', overflowY: 'auto' }}>
          <Title level={3} style={{ marginBottom: 32 }}>Overview</Title>
          
          <div className="dashboard-content">
            <div className="panel-card">
              <Title level={5} style={{ marginBottom: 24, color: '#1e293b' }}>Create Tenant & User</Title>
              <CreateUserForm onUserCreated={fetchUsers} />
            </div>

            <div className="panel-card">
              <Title level={5} style={{ marginBottom: 24, color: '#1e293b' }}>Active Users & Workspaces</Title>
              <UsersList users={users} loading={loading} />
            </div>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default Dashboard;
