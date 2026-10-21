import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AcceptInvite from './pages/AcceptInvite';

const PrivateRoute = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('adminToken');
  return isAuthenticated ? children : <Navigate to="/login" />;
};

const PublicRoute = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('adminToken');
  return isAuthenticated ? <Navigate to="/dashboard" /> : children;
};

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/dashboard/:tab?/:itemId?" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Router>
  );
};

export default App;
