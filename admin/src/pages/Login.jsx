import React, { useState } from 'react';
import { toast } from 'sonner';
import { FiMail, FiLock, FiZap } from 'react-icons/fi';
import { useLocation, useNavigate } from 'react-router-dom';
import axiosClient from '../api/axiosClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Login = () => {
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const [values, setValues] = useState({ email: location.state?.email || '', password: '' });

  const navigate = useNavigate();

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axiosClient.post('/auth/login', values);
      if (res.data.token) {
        const user = res.data.user;
        const isStaff = Boolean(user?.is_platform_staff || user?.staff_role);
        if (!isStaff) {
          toast.error('Access restricted to platform staff. Customer accounts cannot sign in to the platform admin panel.');
          return;
        }
        localStorage.setItem('adminToken', res.data.token);
        navigate('/dashboard');
      } else if (res.data.mfa_setup_required || res.data.mfa_required) {
        toast.warning('MFA is required for this account.');
      } else {
        toast.error('Authentication response missing session token');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <Card className="w-full max-w-[440px] gap-8 py-10">
        <CardHeader className="flex-col justify-center gap-2 text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
            <FiZap size={24} />
          </div>
          <CardTitle className="text-xl">Sign in to your account</CardTitle>
          <CardDescription>Welcome back! Please enter your details.</CardDescription>
        </CardHeader>

        <CardContent className="px-8">
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <FiMail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="Enter your email"
                  value={values.email}
                  onChange={handleChange}
                  className="h-11 pl-9"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <FiLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={values.password}
                  onChange={handleChange}
                  className="h-11 pl-9"
                />
              </div>
            </div>

            <Button type="submit" size="lg" disabled={loading} className="mt-3 h-11 w-full font-semibold">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center border-t border-border px-8 pt-6 text-[13px] text-muted-foreground">
          Protected by&nbsp;<a href="#" className="text-primary hover:underline">Privacy Policy</a>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Login;
