// Hand-rolled stroke icons, 20x20 viewBox, stroke-based
const Ic = ({ children, size = 18, strokeWidth = 1.6, className = '' }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

const Icon = {
  Logo: (p) => (
    <Ic {...p}>
      <path d="M4 6.5 L10 3 L16 6.5 L16 13.5 L10 17 L4 13.5 Z" />
      <path d="M10 3 L10 10 L16 13.5" />
      <path d="M10 10 L4 13.5" />
    </Ic>
  ),
  Search: (p) => (
    <Ic {...p}>
      <circle cx="9" cy="9" r="5" />
      <path d="m13 13 4 4" />
    </Ic>
  ),
  Plus: (p) => (
    <Ic {...p}>
      <path d="M10 4v12M4 10h12" />
    </Ic>
  ),
  Sun: (p) => (
    <Ic {...p}>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
    </Ic>
  ),
  Moon: (p) => (
    <Ic {...p}>
      <path d="M16 11.5A6.5 6.5 0 1 1 8.5 4a5 5 0 0 0 7.5 7.5z" />
    </Ic>
  ),
  Bell: (p) => (
    <Ic {...p}>
      <path d="M6 9a4 4 0 0 1 8 0c0 3 1.5 4.5 2 5H4c.5-.5 2-2 2-5z" />
      <path d="M8.5 16a1.7 1.7 0 0 0 3 0" />
    </Ic>
  ),
  Mic: (p) => (
    <Ic {...p}>
      <rect x="8" y="3" width="4" height="9" rx="2" />
      <path d="M5 10a5 5 0 0 0 10 0" />
      <path d="M10 15v3M7.5 18h5" />
    </Ic>
  ),
  MicOff: (p) => (
    <Ic {...p}>
      <path d="M3 3l14 14" />
      <path d="M12 4v3M8 7.8V10a2 2 0 0 0 3.5 1.3" />
      <path d="M5 10a5 5 0 0 0 7.8 4.1M15 10a5 5 0 0 1-.4 2" />
      <path d="M10 15v3M7.5 18h5" />
    </Ic>
  ),
  Cam: (p) => (
    <Ic {...p}>
      <rect x="2" y="5" width="12" height="10" rx="2" />
      <path d="m14 9 4-2v6l-4-2" />
    </Ic>
  ),
  CamOff: (p) => (
    <Ic {...p}>
      <path d="M3 3l14 14" />
      <path d="M14 9l4-2v6l-4-2V9z" />
      <path d="M2 7v6a2 2 0 0 0 2 2h8" />
    </Ic>
  ),
  Screen: (p) => (
    <Ic {...p}>
      <rect x="2" y="3" width="16" height="11" rx="2" />
      <path d="M7 17h6M10 14v3" />
    </Ic>
  ),
  Headset: (p) => (
    <Ic {...p}>
      <path d="M3 12v-2a7 7 0 1 1 14 0v2" />
      <rect x="2" y="11" width="4" height="5" rx="1" />
      <rect x="14" y="11" width="4" height="5" rx="1" />
    </Ic>
  ),
  Chat: (p) => (
    <Ic {...p}>
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2z" />
    </Ic>
  ),
  Users: (p) => (
    <Ic {...p}>
      <circle cx="7" cy="7" r="3" />
      <path d="M2 16c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
      <circle cx="14" cy="8" r="2.3" />
      <path d="M13 12c2 0 3.5 1 4 3" />
    </Ic>
  ),
  Activity: (p) => (
    <Ic {...p}>
      <path d="M2 10h3l2-6 4 12 2-6h5" />
    </Ic>
  ),
  Pin: (p) => (
    <Ic {...p}>
      <path
        d="M9 3h5l-1 2 2 4-4 1v4l-2 2-2-2v-4L3 9l2-4-1-2z"
        transform="rotate(30 10 10)"
      />
    </Ic>
  ),
  Maximize: (p) => (
    <Ic {...p}>
      <path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
    </Ic>
  ),
  More: (p) => (
    <Ic {...p}>
      <circle cx="4" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="16" cy="10" r="1.2" />
    </Ic>
  ),
  Send: (p) => (
    <Ic {...p}>
      <path d="M3 10 17 3l-4 14-3-6-7-1z" />
    </Ic>
  ),
  Smile: (p) => (
    <Ic {...p}>
      <circle cx="10" cy="10" r="7" />
      <path d="M7 8v.01M13 8v.01" />
      <path d="M7 12a4 4 0 0 0 6 0" />
    </Ic>
  ),
  Gif: (p) => (
    <Ic {...p}>
      <rect x="2" y="5" width="16" height="10" rx="2" />
      <path d="M7 8.5A1.5 1.5 0 0 0 5.5 10v.5a1.5 1.5 0 0 0 2.5 1.1V10.5H6.8" />
      <path d="M10.5 8v4" />
      <path d="M13 12V8h2.5M13 10.2h2" />
    </Ic>
  ),
  Gear: (p) => (
    <Ic {...p}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
    </Ic>
  ),
  Close: (p) => (
    <Ic {...p}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Ic>
  ),
  Hash: (p) => (
    <Ic {...p}>
      <path d="M7 3 5 17M15 3l-2 14M3 7h14M3 13h14" />
    </Ic>
  ),
  Lock: (p) => (
    <Ic {...p}>
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
    </Ic>
  ),
  Eye: (p) => (
    <Ic {...p}>
      <path d="M2 10s2.5-5 8-5 8 5 8 5-2.5 5-8 5-8-5-8-5z" />
      <circle cx="10" cy="10" r="2.2" />
    </Ic>
  ),
  Phone: (p) => (
    <Ic {...p}>
      <path d="M5 3h3l2 4-2 1a8 8 0 0 0 4 4l1-2 4 2v3a2 2 0 0 1-2 2A12 12 0 0 1 3 5a2 2 0 0 1 2-2z" />
    </Ic>
  ),
  Leave: (p) => (
    <Ic {...p}>
      <path
        d="M5 3h3l2 4-2 1a8 8 0 0 0 4 4l1-2 4 2v3a2 2 0 0 1-2 2A12 12 0 0 1 3 5a2 2 0 0 1 2-2z"
        transform="rotate(135 10 10)"
      />
    </Ic>
  ),
  Sparkle: (p) => (
    <Ic {...p}>
      <path d="M10 3v5M10 12v5M3 10h5M12 10h5" />
    </Ic>
  ),
  Bolt: (p) => (
    <Ic {...p}>
      <path d="M11 2 4 11h5l-1 7 7-9h-5l1-7z" />
    </Ic>
  ),
  Broadcast: (p) => (
    <Ic {...p}>
      <circle cx="10" cy="10" r="2" />
      <path d="M6 6a6 6 0 0 0 0 8M14 6a6 6 0 0 1 0 8M4 4a9 9 0 0 0 0 12M16 4a9 9 0 0 1 0 12" />
    </Ic>
  ),
  Logout: (p) => (
    <Ic {...p}>
      <path d="M12 14v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v2" />
      <path d="M8 10h10M15 7l3 3-3 3" />
    </Ic>
  ),
  Check: (p) => (
    <Ic {...p}>
      <path d="m4 10 4 4 8-8" />
    </Ic>
  ),
  ArrowRight: (p) => (
    <Ic {...p}>
      <path d="M4 10h12m-4-4 4 4-4 4" />
    </Ic>
  ),
  Trend: (p) => (
    <Ic {...p}>
      <path d="M3 14l5-5 3 3 6-6M13 6h4v4" />
    </Ic>
  ),
  Dot: (p) => (
    <Ic {...p}>
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </Ic>
  ),
  Crown: (p) => (
    <Ic {...p}>
      <path d="M3 6l2 9h10l2-9-4 3-3-5-3 5z" />
    </Ic>
  ),
  Folder: (p) => (
    <Ic {...p}>
      <path d="M3 6a1 1 0 0 1 1-1h3l2 2h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </Ic>
  ),
}

Object.assign(window, { Icon })
