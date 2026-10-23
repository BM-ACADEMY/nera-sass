const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export const IconUser = (p) => (<svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>)
export const IconChat = (p) => (<svg {...base} {...p}><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z" /></svg>)
export const IconCloud = (p) => (<svg {...base} {...p}><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.4 10 4 4 0 0 1 18 18H7z" /><path d="M12 11v5m-2-2 2 2 2-2" /></svg>)
export const IconSpark = (p) => (<svg {...base} {...p}><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" /></svg>)
export const IconLayers = (p) => (<svg {...base} {...p}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>)
export const IconBell = (p) => (<svg {...base} {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" /><path d="M10 21h4" /></svg>)
export const IconInbox = (p) => (<svg {...base} {...p}><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6l2-8z" /></svg>)
export const IconTag = (p) => (<svg {...base} {...p}><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>)
export const IconCheck = (p) => (<svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>)
export const IconArrow = (p) => (<svg {...base} {...p}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>)
export const IconLink = (p) => (<svg {...base} {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>)
export const IconBook = (p) => (<svg {...base} {...p}><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5z" /><path d="M4 20a2 2 0 0 0 2 2h13v-4" /></svg>)
export const IconTeam = (p) => (<svg {...base} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c0-3-1.8-5.2-4.5-5.8" /></svg>)
export const IconMail = (p) => (<svg {...base} {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>)
export const IconPhone = (p) => (<svg {...base} {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>)

export function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0f3d2a" />
      <path d="M32 14c-10 0-18 7.4-18 16.6 0 4.2 1.7 8 4.5 11L17 50l8.6-3.4c2 .7 4.1 1 6.4 1 10 0 18-7.4 18-16.6S42 14 32 14z" fill="#3ddc84" />
      <circle cx="25" cy="31" r="2.6" fill="#0f3d2a" />
      <circle cx="32" cy="31" r="2.6" fill="#0f3d2a" />
      <circle cx="39" cy="31" r="2.6" fill="#0f3d2a" />
    </svg>
  )
}
