import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api.js';
import { mfaErrorKind, NOTICES } from '../../services/session.js';
import { Field, Button, Notice } from './ui.jsx';
import { inputStyle } from './styles.js';

// Two-factor enrolment with the existing APIs: start, then confirm with a
// code from the authenticator app. Used from Settings (signed in) and from
// login when enrolment is required (mfaToken). A wrong code keeps the session;
// an expired session or sign-in step says so (from Settings the app has
// already gone to the login page; at login, onExpired restarts sign-in).
const describeMfaError = (err, mfaToken, fallback) => {
  const kind = mfaErrorKind(err);
  if (kind === 'expired') return mfaToken ? NOTICES.signInStepExpired : NOTICES.sessionEnded;
  if (kind === 'invalid_code') return 'That code is not valid. Check the time on your phone and try again.';
  return err?.message || fallback;
};

export const MfaEnrollment = ({ mfaToken, onDone, onCancel, onExpired }) => {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState(null); // the last request error, for expiry handling
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [session, setSession] = useState(null);
  // Each start stores a new pending secret on the server, so start exactly
  // once (React development mode runs effects twice).
  const started = useRef(false);

  const fail = (err, fallback) => {
    setFailure(err);
    setError(describeMfaError(err, mfaToken, fallback));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.startMfaSetup(mfaToken)
      .then(setSetup)
      .catch((err) => {
        setFailure(err);
        setError(describeMfaError(err, mfaToken, 'Could not start two-factor setup'));
      });
  }, [mfaToken]);

  // An expired session or sign-in step hands back to the caller.
  useEffect(() => {
    if (failure && mfaErrorKind(failure) === 'expired') onExpired?.();
  }, [failure, onExpired]);

  const confirm = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app');
    setBusy(true);
    setError('');
    try {
      const data = await api.confirmMfaSetup(code, mfaToken);
      setSession(data);
      setRecoveryCodes(data.recovery_codes || []);
      setSetup(null);
    } catch (err) {
      fail(err, 'Could not turn on two-factor authentication');
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes) {
    return (
      <div>
        <Notice tone="ok">Two-factor authentication is on.</Notice>
        <p style={{ fontSize: 12, marginBottom: 8 }}>Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They will not be shown again.</p>
        <pre style={{ ...inputStyle(), fontFamily: 'monospace', whiteSpace: 'pre-wrap', marginBottom: 12 }}>{recoveryCodes.join('\n')}</pre>
        <Button type="button" onClick={() => onDone?.(session)}>I have saved my recovery codes</Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm}>
      {error && <Notice tone="error">{error}</Notice>}
      {!setup && !error && <p style={{ fontSize: 12 }}>Preparing two-factor setup…</p>}
      {setup && (
        <>
          <p style={{ fontSize: 12, marginBottom: 10 }}>
            In your authenticator app, add an account using this setup key (or open the link on your phone), then enter the 6-digit code it shows.
          </p>
          <Field label="Setup key">
            <div style={{ ...inputStyle(), fontFamily: 'monospace', wordBreak: 'break-all' }}>{setup.secret}</div>
          </Field>
          <p style={{ fontSize: 11, marginBottom: 14 }}><a href={setup.otpauth_url}>Open in authenticator app</a></p>
          <Field label="6-digit code">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={inputStyle()} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="submit" busy={busy}>{busy ? 'Checking…' : 'Turn on'}</Button>
            {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
          </div>
        </>
      )}
      {!setup && error && onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Back</Button>}
    </form>
  );
};
