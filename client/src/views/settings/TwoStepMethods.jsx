import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../../services/api.js';
import { C } from '../../constants/theme.js';
import { MethodTile, METHOD_META } from '../../components/auth/MfaBrandIcons.jsx';
import { Field, Button, Notice } from './ui.jsx';
import { inputStyle } from './styles.js';

// Two-step verification in Settings: three methods (authenticator app, email
// code, WhatsApp code) as cards. Turning a method on or off and new recovery
// codes first confirm it is really the user: password, plus a current code
// when two-step verification is already on (the server refuses otherwise).
const METHODS = ['totp', 'email', 'whatsapp'];
const TEXT = {
  totp: 'A new code every 30 seconds in Google Authenticator, even offline.',
  email: 'A 6-digit code is emailed to you at each sign-in.',
  whatsapp: 'A 6-digit code is sent to your WhatsApp number at each sign-in.',
};

const Badge = ({ tone, children }) => {
  const colors = { ok: [C.green, '#ecfdf3'], muted: [C.muted, '#f1f5f9'], info: [C.accent, '#eef4ff'], warn: ['#b45309', '#fffbeb'] }[tone];
  return <span style={{ fontSize: 10, fontWeight: 700, color: colors[0], background: colors[1], borderRadius: 999, padding: '2px 8px' }}>{children}</span>;
};

const codeInput = (value, onChange, placeholder = '6-digit code') => (
  <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={placeholder} value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} style={inputStyle()} />
);

// Password + current code. onSubmit(proof) does the change; errors stay here.
const ConfirmIdentity = ({ me, intro, action, children, onSubmit, onCancel }) => {
  const usable = me?.mfa_methods || [];
  const hasMfa = Boolean(me?.mfa_enabled);
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState(usable.includes('totp') ? 'totp' : usable[0] || 'recovery');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async () => {
    setError('');
    try {
      const res = await api.sendReauthCode(method);
      setSentTo(res.sent_to);
      toast.success(`Code sent to ${res.sent_to}`);
    } catch (err) {
      setError(err.message || 'The code could not be sent');
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!password) return setError('Enter your current password');
    if (hasMfa && !code.trim()) return setError('Enter a current verification code or a recovery code');
    setBusy(true);
    setError('');
    try {
      const proof = !hasMfa ? { password }
        : method === 'recovery' ? { password, recovery_code: code.trim() } : { password, code_method: method, code };
      await onSubmit(proof);
    } catch (err) {
      setError(err.message || 'Something went wrong');
      if (method !== 'recovery') setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ border: '1px solid ' + C.border, borderRadius: 10, padding: 14, marginTop: 14 }}>
      {error && <Notice tone="error">{error}</Notice>}
      <p style={{ fontSize: 12, marginBottom: 12 }}>{intro} {hasMfa ? 'Enter your password and a current verification code.' : 'Enter your current password.'}</p>
      {children}
      <Field label="Current password">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle()} />
      </Field>
      {hasMfa && (
        <Field label="Current code">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {[...usable, 'recovery'].map((m) => (
              <button key={m} type="button" onClick={() => { setMethod(m); setCode(''); setSentTo(''); }}
                style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', border: '1px solid ' + (method === m ? C.accent : C.border), background: method === m ? C.accent + '12' : 'transparent', color: C.text }}>
                {m === 'recovery' ? 'Recovery code' : METHOD_META[m].title}
              </button>
            ))}
          </div>
          {method === 'recovery'
            ? <input autoComplete="off" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle(), fontFamily: 'monospace' }} />
            : codeInput(code, setCode)}
          {(method === 'email' || method === 'whatsapp') && (
            <div style={{ marginTop: 8 }}>
              <Button type="button" variant="secondary" onClick={sendCode}>{sentTo ? 'Send again' : `Send me a code by ${method === 'email' ? 'email' : 'WhatsApp'}`}</Button>
              {sentTo && <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>Sent to {sentTo}</span>}
            </div>
          )}
        </Field>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <Button type="submit" busy={busy}>{busy ? 'Checking…' : action}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
};

// Second step of turning a method on: the app's QR code, or the code that was
// sent by email / WhatsApp.
const FinishSetup = ({ flow, onDone, onCancel }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async (event) => {
    event.preventDefault();
    if (code.length !== 6) return setError('Enter the 6-digit code');
    setBusy(true);
    setError('');
    try {
      const reauth = { password: flow.password };
      const data = flow.method === 'totp' ? await api.confirmMfaSetup(code, null, reauth)
        : flow.method === 'email' ? await api.confirmEmailSetup(code, null, reauth)
          : await api.confirmWhatsappSetup(code, null, reauth);
      onDone(data);
    } catch (err) {
      setCode('');
      setError(err.code === 'INVALID_MFA_CODE' ? 'That code is not valid. Try again.' : err.message || 'Could not turn it on');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={confirm} style={{ border: '1px solid ' + C.border, borderRadius: 10, padding: 14, marginTop: 14 }}>
      {error && <Notice tone="error">{error}</Notice>}
      {flow.method === 'totp' ? (
        <>
          <p style={{ fontSize: 12, marginBottom: 10 }}>Scan this QR code in Google Authenticator (or type the key), then enter the 6-digit code it shows.</p>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ background: '#fff', padding: 8, borderRadius: 10, border: '1px solid ' + C.border }}><QRCodeSVG value={flow.setup.otpauth_url} size={132} /></div>
            <div style={{ ...inputStyle(), fontFamily: 'monospace', wordBreak: 'break-all', flex: 1, minWidth: 180 }}>{flow.setup.secret}</div>
          </div>
        </>
      ) : (
        <p style={{ fontSize: 12, marginBottom: 10 }}>Enter the 6-digit code we sent to {flow.sent?.sent_to}.</p>
      )}
      <Field label="6-digit code">{codeInput(code, setCode)}</Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button type="submit" busy={busy}>{busy ? 'Checking…' : 'Turn on'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
};

export const TwoStepMethods = ({ me, onChanged }) => {
  const usable = me?.mfa_methods || [];
  const enrolled = me?.mfa_methods_enrolled || usable;
  const defaultMethod = me?.mfa_default_method || null;
  const waAvailable = Boolean(me?.whatsapp_otp_available);
  // { step: 'confirm' | 'finish' | 'codes', action: 'enable' | 'disable' | 'recovery', method, ... }
  const [flow, setFlow] = useState(null);
  const [phone, setPhone] = useState('');
  const [codes, setCodes] = useState(null);
  useEffect(() => { if (!flow) setPhone(''); }, [flow]);

  const done = (data) => {
    setFlow(null);
    if (data?.recovery_codes?.length) setCodes(data.recovery_codes);
    toast.success('Two-step verification updated');
    onChanged?.();
  };

  const runConfirmed = async (proof) => {
    const { action, method } = flow;
    if (action === 'disable') {
      await api.disableMfaMethod(method, proof);
      return done();
    }
    if (action === 'recovery') {
      const res = await api.regenerateRecoveryCodes(proof);
      setFlow(null);
      setCodes(res.recovery_codes);
      return onChanged?.();
    }
    if (method === 'totp') return setFlow({ ...flow, step: 'finish', password: proof.password, setup: await api.startMfaSetup(null, proof) });
    if (method === 'email') return setFlow({ ...flow, step: 'finish', password: proof.password, sent: await api.startEmailSetup(null, proof) });
    return setFlow({ ...flow, step: 'finish', password: proof.password, sent: await api.startWhatsappSetup(phone, null, proof) });
  };

  const makeDefault = async (method) => {
    try {
      await api.setDefaultMfaMethod(method);
      toast.success(`${METHOD_META[method].title} is now your default`);
      onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not change the default');
    }
  };

  const intro = flow && ({
    enable: `Turn on ${METHOD_META[flow.method]?.title.toLowerCase()}.`,
    disable: `Turn off ${METHOD_META[flow.method]?.title.toLowerCase()}.`,
    recovery: 'Create new recovery codes (the old ones stop working).',
  })[flow.action];

  if (codes) {
    return (
      <div>
        <Notice tone="ok">Save these recovery codes somewhere safe. Each one signs you in once if you lose access to your methods. They will not be shown again.</Notice>
        <pre style={{ ...inputStyle(), fontFamily: 'monospace', whiteSpace: 'pre-wrap', marginBottom: 12 }}>{codes.join('\n')}</pre>
        <Button type="button" onClick={() => setCodes(null)}>I have saved my recovery codes</Button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {METHODS.map((method) => {
          const on = enrolled.includes(method);
          const unavailable = method === 'whatsapp' && !waAvailable;
          const isDefault = on && defaultMethod === method;
          return (
            <div key={method} style={{ border: '1px solid ' + (on ? C.green + '55' : C.border), borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <MethodTile method={method} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{METHOD_META[method].title}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {on ? <Badge tone="ok">On</Badge> : unavailable ? <Badge tone="warn">Not available yet</Badge> : <Badge tone="muted">Off</Badge>}
                    {isDefault && <Badge tone="info">Default</Badge>}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
                {TEXT[method]}
                {method === 'whatsapp' && on && me?.mfa_whatsapp_number ? ` Number: ${me.mfa_whatsapp_number}.` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                {on ? (
                  <>
                    <Button type="button" variant="danger" disabled={Boolean(flow)} onClick={() => setFlow({ step: 'confirm', action: 'disable', method })}>Turn off</Button>
                    {!isDefault && usable.includes(method) && <Button type="button" variant="secondary" onClick={() => makeDefault(method)}>Make default</Button>}
                  </>
                ) : (
                  <Button type="button" disabled={Boolean(flow) || unavailable} onClick={() => setFlow({ step: 'confirm', action: 'enable', method })}>Set up</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {flow?.step === 'confirm' && (
        <ConfirmIdentity me={me} intro={intro} action={flow.action === 'enable' ? 'Continue' : flow.action === 'disable' ? 'Turn off' : 'Create new codes'} onSubmit={runConfirmed} onCancel={() => setFlow(null)}>
          {flow.action === 'enable' && flow.method === 'whatsapp' && (
            <Field label="WhatsApp number" hint="With the country code. We send a code to it to check it is yours.">
              <input type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle()} />
            </Field>
          )}
        </ConfirmIdentity>
      )}
      {flow?.step === 'finish' && <FinishSetup flow={flow} onDone={done} onCancel={() => setFlow(null)} />}

      {me?.mfa_enabled && !flow && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.muted }}>Recovery codes left: {me?.recovery_codes_left || 0} of 10.</span>
          <Button type="button" variant="secondary" onClick={() => setFlow({ step: 'confirm', action: 'recovery' })}>Create new recovery codes</Button>
        </div>
      )}
    </div>
  );
};
