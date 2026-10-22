import React, { useState } from 'react';
import { toast } from 'sonner';
import { FiMail, FiLock, FiZap, FiShield, FiCopy, FiArrowLeft } from 'react-icons/fi';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import axiosClient from '../api/axiosClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Sign-in is up to three steps: password, then either the authenticator code
// (MFA already on) or first-time authenticator setup, then the recovery codes.
const Login = () => {
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const [values, setValues] = useState({ email: location.state?.email || '', password: '' });
  const [step, setStep] = useState('password'); // password | verify | setup | codes
  const [mfaToken, setMfaToken] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [pending, setPending] = useState(null);

  const navigate = useNavigate();

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  const finish = (data) => {
    const user = data.user;
    if (!(user?.is_platform_staff || user?.staff_role)) {
      toast.error('Access restricted to platform staff. Customer accounts cannot sign in to the platform admin panel.');
      setStep('password');
      return;
    }
    localStorage.setItem('adminToken', data.token);
    navigate('/dashboard');
  };

  const restart = () => {
    setStep('password');
    setMfaToken('');
    setSetup(null);
    setCode('');
    setUseRecovery(false);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axiosClient.post('/auth/login', values);
      if (res.data.token) {
        finish(res.data);
      } else if (res.data.mfa_required) {
        setMfaToken(res.data.mfa_token);
        setStep('verify');
      } else if (res.data.mfa_setup_required) {
        const s = await axiosClient.post('/auth/mfa/setup', { mfa_token: res.data.mfa_token });
        setMfaToken(res.data.mfa_token);
        setSetup(s.data);
        setStep('setup');
      } else {
        toast.error('Authentication response missing session token');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = useRecovery ? { mfa_token: mfaToken, recovery_code: code.trim() } : { mfa_token: mfaToken, code: code.replace(/\s/g, '') };
      const res = await axiosClient.post('/auth/mfa/verify', body);
      finish(res.data);
    } catch (err) {
      if (err.response?.status === 401 && err.response?.data?.code !== 'INVALID_MFA_CODE') {
        toast.error('This sign-in expired. Enter your password again.');
        restart();
      } else {
        toast.error(err.response?.data?.error || 'Invalid verification code');
      }
    } finally {
      setLoading(false);
    }
  };

  const onConfirmSetup = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axiosClient.post('/auth/mfa/setup/confirm', { mfa_token: mfaToken, code: code.replace(/\s/g, '') });
      setRecoveryCodes(res.data.recovery_codes || []);
      setPending(res.data);
      setStep('codes');
    } catch (err) {
      if (err.response?.status === 401 && err.response?.data?.code !== 'INVALID_MFA_CODE') {
        toast.error('This sign-in expired. Enter your password again.');
        restart();
      } else {
        toast.error(err.response?.data?.error || 'Invalid verification code');
      }
    } finally {
      setLoading(false);
    }
  };

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {});
  };

  const codeInput = (
    <Input
      id="code"
      inputMode={useRecovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      autoFocus
      required
      maxLength={useRecovery ? 32 : 7}
      placeholder={useRecovery ? 'xxxx-xxxx' : '123 456'}
      value={code}
      onChange={(e) => setCode(e.target.value)}
      className="h-11 text-center text-lg tracking-[0.3em]"
    />
  );

  const header = {
    password: { icon: <FiZap size={24} />, title: 'Sign in to your account', text: 'Welcome back! Please enter your details.' },
    verify: { icon: <FiShield size={24} />, title: 'Two-step verification', text: useRecovery ? 'Enter one of your saved recovery codes.' : 'Enter the 6-digit code from your authenticator app.' },
    setup: { icon: <FiShield size={24} />, title: 'Set up two-step verification', text: 'Admin accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, Authy).' },
    codes: { icon: <FiShield size={24} />, title: 'Save your recovery codes', text: 'Each code works once if you lose your phone. Keep them somewhere safe.' },
  }[step];

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-[440px] gap-8 py-10">
        <CardHeader className="flex-col justify-center gap-2 text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
            {header.icon}
          </div>
          <CardTitle className="text-xl">{header.title}</CardTitle>
          <CardDescription>{header.text}</CardDescription>
        </CardHeader>

        <CardContent className="px-8">
          {step === 'password' && (
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
          )}

          {step === 'verify' && (
            <form onSubmit={onVerify} className="flex flex-col gap-4">
              <Label htmlFor="code">{useRecovery ? 'Recovery code' : 'Verification code'}</Label>
              {codeInput}
              <Button type="submit" size="lg" disabled={loading || !code.trim()} className="h-11 w-full font-semibold">
                {loading ? 'Checking…' : 'Verify'}
              </Button>
              <button type="button" className="cursor-pointer text-[13px] text-primary hover:underline" onClick={() => { setUseRecovery((v) => !v); setCode(''); }}>
                {useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
              </button>
              <Button type="button" variant="ghost" size="sm" onClick={restart}><FiArrowLeft /> Back</Button>
            </form>
          )}

          {step === 'setup' && setup && (
            <form onSubmit={onConfirmSetup} className="flex flex-col gap-4">
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
                <li>Open your authenticator app and add an account.</li>
                <li>Scan this QR code (or type the key below).</li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                <QRCodeSVG value={setup.otpauth_url} size={180} />
              </div>
              <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs">{setup.secret}</code>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => copy(setup.secret, 'Key')} aria-label="Copy key"><FiCopy /></Button>
              </div>
              <Label htmlFor="code">Verification code</Label>
              {codeInput}
              <Button type="submit" size="lg" disabled={loading || !code.trim()} className="h-11 w-full font-semibold">
                {loading ? 'Checking…' : 'Turn on and sign in'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={restart}><FiArrowLeft /> Back</Button>
            </form>
          )}

          {step === 'codes' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted p-4 font-mono text-sm">
                {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <Button type="button" variant="outline" onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')}><FiCopy /> Copy codes</Button>
              <Button type="button" size="lg" className="h-11 w-full font-semibold" onClick={() => finish(pending)}>
                I have saved them, continue
              </Button>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-center border-t border-border px-8 pt-6 text-[13px] text-muted-foreground">
          Protected by&nbsp;<a href="#" className="text-primary hover:underline">Privacy Policy</a>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Login;
