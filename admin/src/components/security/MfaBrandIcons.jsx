// Small brand-style icons for the three two-step methods (inline SVG, no
// network): Google Authenticator, an email envelope and WhatsApp. MethodTile
// puts one in a rounded square tile with a soft background, like the other
// coloured icon tiles in Settings.

export const AuthenticatorIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="22" fill="#fff" />
    <path d="M24 2a22 22 0 0 1 19.05 11L33.5 18.5A11 11 0 0 0 24 13Z" fill="#EA4335" />
    <path d="M43.05 13A22 22 0 0 1 43.05 35L33.5 29.5a11 11 0 0 0 0-11Z" fill="#FBBC04" />
    <path d="M43.05 35A22 22 0 0 1 4.95 35L14.5 29.5a11 11 0 0 0 19 0Z" fill="#34A853" />
    <path d="M4.95 35A22 22 0 0 1 24 2v11a11 11 0 0 0-9.5 16.5Z" fill="#4285F4" />
    <circle cx="24" cy="24" r="10" fill="#fff" />
    <g stroke="#5F6368" strokeWidth="3" strokeLinecap="round">
      <path d="M24 18v12M18.8 21l10.4 6M18.8 27l10.4-6" />
    </g>
  </svg>
);

export const EmailIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <rect x="4" y="10" width="40" height="28" rx="4" fill="#fff" />
    <path d="M4 14v20a4 4 0 0 0 4 4h5V20Z" fill="#4285F4" />
    <path d="M44 14v20a4 4 0 0 1-4 4h-5V20Z" fill="#34A853" />
    <path d="M35 12.5V20l-11 8-11-8v-7.5L24 20.5Z" fill="#EA4335" />
    <path d="M4 14a4 4 0 0 1 6.4-3.2L13 12.7V20l-9-6.5Z" fill="#C5221F" />
    <path d="M44 14a4 4 0 0 0-6.4-3.2L35 12.7V20l9-6.5Z" fill="#FBBC04" />
  </svg>
);

export const WhatsAppIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
  </svg>
);

export const METHOD_META = {
  totp: { title: 'Authenticator app', Icon: AuthenticatorIcon, tile: '#eef4ff', ring: '#dbe6fe' },
  email: { title: 'Email code', Icon: EmailIcon, tile: '#fef2f2', ring: '#fde2e2' },
  whatsapp: { title: 'WhatsApp code', Icon: WhatsAppIcon, tile: '#ecfdf3', ring: '#d1fadf' },
};

// Rounded square tile with a soft background holding the brand icon.
export const MethodTile = ({ method, size = 44 }) => {
  const meta = METHOD_META[method];
  const { Icon } = meta;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: size, height: size, borderRadius: 12, background: meta.tile, boxShadow: `0 0 0 4px ${meta.ring}`,
    }}>
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
};
