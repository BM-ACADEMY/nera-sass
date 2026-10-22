import axios from 'axios';
import { shouldEndSession } from './sessionPolicy';

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3600/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to add auth token
axiosClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('adminToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor to handle auth errors globally. Only an unusable session signs
// the user out (see sessionPolicy.js); a permission denial is left to the view.
axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // No answer at all: the API server is down or still starting (it waits for
    // the database). Every view shows this instead of its generic failure text.
    if (!error.response && !axios.isCancel(error)) {
      error.response = {
        status: 0,
        data: { error: 'Cannot reach the API server. It may be starting or unable to connect to the database. Wait a moment and refresh.', code: 'API_UNREACHABLE' },
      };
      return Promise.reject(error);
    }
    if (error.response && shouldEndSession(error.response.status, error.response.data)) {
      localStorage.removeItem('adminToken');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default axiosClient;
