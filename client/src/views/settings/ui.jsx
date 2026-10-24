import { C } from '../../constants/theme.js';
import { inputStyle } from './styles.js';

// Small building blocks shared by the Settings tabs (same look as before).
export const SectionTitle = ({ children }) => (
  <h3 style={{ fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 16 }}>{children}</h3>
);

export const SubTitle = ({ children }) => (
  <h4 style={{ fontFamily: "'Inter',sans-serif", fontSize: 12, fontWeight: 700, color: C.text, margin: '4px 0 12px' }}>{children}</h4>
);

export const Divider = () => <div style={{ height: 1, background: C.border, margin: '20px 0' }} />;

export const Field = ({ label, children, hint }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: 'block', fontSize: 9, color: C.muted, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</label>
    {children}
    {hint && <p style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{hint}</p>}
  </div>
);

export const ReadOnly = ({ label, value }) => (
  <Field label={label}>
    <div style={{ ...inputStyle(false), minHeight: 36 }}>{value || '—'}</div>
  </Field>
);

export const Button = ({ children, busy, variant = 'primary', ...props }) => {
  const primary = variant === 'primary';
  const danger = variant === 'danger';
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      style={{
        background: primary ? C.accent : 'transparent',
        border: primary ? 'none' : '1px solid ' + (danger ? C.red : C.border),
        color: primary ? '#fff' : danger ? C.red : C.text,
        borderRadius: 7, padding: '8px 18px', fontSize: 12, fontWeight: 700,
        cursor: props.disabled || busy ? 'not-allowed' : 'pointer', opacity: props.disabled || busy ? 0.6 : 1,
        ...props.style,
      }}
    >
      {children}
    </button>
  );
};

const NOTICE_COLORS = { info: C.accent, ok: C.green, error: C.red, muted: C.muted };

export const Notice = ({ tone = 'info', children }) => (
  <div style={{ border: '1px solid ' + NOTICE_COLORS[tone] + '55', background: NOTICE_COLORS[tone] + '12', color: C.text, borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 14 }}>
    {children}
  </div>
);

export const Actions = ({ children }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18, paddingTop: 18, borderTop: '1px solid ' + C.border }}>{children}</div>
);
