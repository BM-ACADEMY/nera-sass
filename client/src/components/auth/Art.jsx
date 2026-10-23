import { useId } from 'react';

// Flat vector illustrations for the sign-in and security screens. Gradient ids
// come from useId so several pictures can share a page.

const Backdrop = ({ id, from, to }) => (
  <>
    <defs>
      <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={from} stopOpacity="0.35" />
        <stop offset="100%" stopColor={to} stopOpacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="120" cy="92" rx="104" ry="78" fill={`url(#${id}-glow)`} />
    <ellipse cx="120" cy="158" rx="70" ry="7" fill="#0f172a" opacity="0.08" />
  </>
);

// Phone showing a shield and a six-digit code.
export const AuthenticatorArt = ({ className = 'h-36 w-auto' }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden>
      <Backdrop id={id} from="#22c55e" to="#22c55e" />
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`${id}-screen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0fdf4" />
          <stop offset="100%" stopColor="#dcfce7" />
        </linearGradient>
        <linearGradient id={`${id}-shield`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <circle cx="44" cy="40" r="5" fill="#86efac" />
      <circle cx="198" cy="58" r="4" fill="#a7f3d0" />
      <circle cx="190" cy="126" r="6" fill="#bbf7d0" />
      <path d="M36 112 l6 0 M39 109 l0 6" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" />
      <rect x="84" y="14" width="72" height="140" rx="14" fill={`url(#${id}-body)`} />
      <rect x="90" y="24" width="60" height="120" rx="8" fill={`url(#${id}-screen)`} />
      <rect x="110" y="18" width="20" height="3" rx="1.5" fill="#334155" />
      <path d="M120 40 l20 7 v13 c0 13 -9 21 -20 25 c-11 -4 -20 -12 -20 -25 v-13 z" fill={`url(#${id}-shield)`} />
      <path d="M111 61 l6 6 l12 -13" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="96" y="96" width="48" height="16" rx="5" fill="#fff" stroke="#bbf7d0" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={102 + i * 7.2} cy="104" r="2.2" fill="#059669" />
      ))}
      <rect x="100" y="120" width="40" height="5" rx="2.5" fill="#86efac" />
      <rect x="100" y="120" width="26" height="5" rx="2.5" fill="#16a34a" />
      <g transform="translate(150 98)">
        <circle r="17" fill="#fff" stroke="#e2e8f0" />
        <circle r="12" fill="none" stroke="#dcfce7" strokeWidth="3" />
        <path d="M0 -12 a12 12 0 0 1 10.4 6" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" />
        <path d="M0 -5 v5 l4 3" fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
};

// Envelope with a code card coming out of it.
export const EmailCodeArt = ({ className = 'h-36 w-auto' }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden>
      <Backdrop id={id} from="#3b82f6" to="#3b82f6" />
      <defs>
        <linearGradient id={`${id}-env`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id={`${id}-flap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <circle cx="46" cy="50" r="5" fill="#bfdbfe" />
      <circle cx="200" cy="44" r="4" fill="#93c5fd" />
      <circle cx="40" cy="122" r="6" fill="#dbeafe" />
      <path d="M190 112 l6 0 M193 109 l0 6" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />
      <path d="M174 30 l26 -10 l-10 26 l-5 -11 z" fill="#fff" stroke="#93c5fd" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M150 52 q12 -6 22 -18" fill="none" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 4" />
      <rect x="62" y="70" width="116" height="78" rx="10" fill={`url(#${id}-env)`} />
      <rect x="78" y="28" width="84" height="74" rx="8" fill="#fff" stroke="#e2e8f0" />
      <rect x="90" y="40" width="40" height="5" rx="2.5" fill="#cbd5e1" />
      <rect x="90" y="50" width="58" height="4" rx="2" fill="#e2e8f0" />
      <rect x="88" y="62" width="64" height="20" rx="6" fill="#eff6ff" stroke="#bfdbfe" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <text key={i} x={95 + i * 10} y="76.5" fontSize="11" fontWeight="700" fill="#1d4ed8" fontFamily="ui-monospace, monospace">{'482915'[i]}</text>
      ))}
      <path d="M62 80 l58 40 l58 -40 v58 a10 10 0 0 1 -10 10 h-96 a10 10 0 0 1 -10 -10 z" fill={`url(#${id}-flap)`} />
      <path d="M62 148 l46 -38 M178 148 l-46 -38" stroke="#1d4ed8" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="170" cy="76" r="11" fill="#22c55e" stroke="#fff" strokeWidth="3" />
      <path d="M165 76 l3.5 3.5 l6.5 -7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// Shield with a padlock: the general "account security" picture.
export const ShieldArt = ({ className = 'h-36 w-auto' }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden>
      <Backdrop id={id} from="#6366f1" to="#6366f1" />
      <defs>
        <linearGradient id={`${id}-sh`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id={`${id}-in`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eef2ff" />
          <stop offset="100%" stopColor="#e0e7ff" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="84" r="66" fill="none" stroke="#c7d2fe" strokeDasharray="2 7" />
      <circle cx="58" cy="44" r="6" fill="#a5b4fc" />
      <circle cx="186" cy="118" r="5" fill="#c7d2fe" />
      <circle cx="190" cy="46" r="3.5" fill="#818cf8" />
      <path d="M120 20 l50 18 v34 c0 33 -22 55 -50 66 c-28 -11 -50 -33 -50 -66 v-34 z" fill={`url(#${id}-sh)`} />
      <path d="M120 32 l38 14 v27 c0 26 -17 43 -38 52 c-21 -9 -38 -26 -38 -52 v-27 z" fill={`url(#${id}-in)`} />
      <path d="M108 74 v-8 a12 12 0 0 1 24 0 v8" fill="none" stroke="#4f46e5" strokeWidth="5" strokeLinecap="round" />
      <rect x="100" y="72" width="40" height="32" rx="7" fill="#4f46e5" />
      <circle cx="120" cy="85" r="4.5" fill="#fff" />
      <rect x="118.4" y="86" width="3.2" height="9" rx="1.6" fill="#fff" />
      <g transform="translate(160 112)">
        <circle r="13" fill="#22c55e" stroke="#fff" strokeWidth="3" />
        <path d="M-5.5 0 l4 4 l7.5 -8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
};
