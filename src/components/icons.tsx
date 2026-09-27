// Hand-rolled stroke icons, 20x20 viewBox, stroke-based.
import type { ReactNode } from "react";

export type IconProps = { size?: number; strokeWidth?: number; className?: string };

const Ic = ({
  children,
  size = 18,
  strokeWidth = 1.6,
  className = "",
}: IconProps & { children: ReactNode }) => (
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
    aria-hidden="true"
  >
    {children}
  </svg>
);

const make = (paths: ReactNode) => (p: IconProps) => <Ic {...p}>{paths}</Ic>;

export const Icon = {
  Search: make(
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="m13 13 4 4" />
    </>,
  ),
  Plus: make(<path d="M10 4v12M4 10h12" />),
  Sun: make(
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
    </>,
  ),
  Moon: make(<path d="M16 11.5A6.5 6.5 0 1 1 8.5 4a5 5 0 0 0 7.5 7.5z" />),
  Mic: make(
    <>
      <rect x="8" y="3" width="4" height="9" rx="2" />
      <path d="M5 10a5 5 0 0 0 10 0" />
      <path d="M10 15v3M7.5 18h5" />
    </>,
  ),
  MicOff: make(
    <>
      <path d="M3 3l14 14" />
      <path d="M12 4v3M8 7.8V10a2 2 0 0 0 3.5 1.3" />
      <path d="M5 10a5 5 0 0 0 7.8 4.1M15 10a5 5 0 0 1-.4 2" />
      <path d="M10 15v3M7.5 18h5" />
    </>,
  ),
  Cam: make(
    <>
      <rect x="2" y="5" width="12" height="10" rx="2" />
      <path d="m14 9 4-2v6l-4-2" />
    </>,
  ),
  CamOff: make(
    <>
      <path d="M3 3l14 14" />
      <path d="M14 9l4-2v6l-4-2V9z" />
      <path d="M2 7v6a2 2 0 0 0 2 2h8" />
    </>,
  ),
  Screen: make(
    <>
      <rect x="2" y="3" width="16" height="11" rx="2" />
      <path d="M7 17h6M10 14v3" />
    </>,
  ),
  Headset: make(
    <>
      <path d="M3 12v-2a7 7 0 1 1 14 0v2" />
      <rect x="2" y="11" width="4" height="5" rx="1" />
      <rect x="14" y="11" width="4" height="5" rx="1" />
    </>,
  ),
  Chat: make(
    <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2z" />,
  ),
  Users: make(
    <>
      <circle cx="7" cy="7" r="3" />
      <path d="M2 16c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
      <circle cx="14" cy="8" r="2.3" />
      <path d="M13 12c2 0 3.5 1 4 3" />
    </>,
  ),
  Activity: make(<path d="M2 10h3l2-6 4 12 2-6h5" />),
  Pin: make(
    <path d="M9 3h5l-1 2 2 4-4 1v4l-2 2-2-2v-4L3 9l2-4-1-2z" transform="rotate(30 10 10)" />,
  ),
  Maximize: make(<path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />),
  More: make(
    <>
      <circle cx="4" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="16" cy="10" r="1.2" />
    </>,
  ),
  Send: make(<path d="M3 10 17 3l-4 14-3-6-7-1z" />),
  Smile: make(
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M7 8v.01M13 8v.01" />
      <path d="M7 12a4 4 0 0 0 6 0" />
    </>,
  ),
  Gear: make(
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
    </>,
  ),
  Close: make(<path d="M5 5l10 10M15 5 5 15" />),
  Hash: make(<path d="M7 3 5 17M15 3l-2 14M3 7h14M3 13h14" />),
  Lock: make(
    <>
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
    </>,
  ),
  Eye: make(
    <>
      <path d="M2 10s2.5-5 8-5 8 5 8 5-2.5 5-8 5-8-5-8-5z" />
      <circle cx="10" cy="10" r="2.2" />
    </>,
  ),
  Leave: make(
    <path
      d="M5 3h3l2 4-2 1a8 8 0 0 0 4 4l1-2 4 2v3a2 2 0 0 1-2 2A12 12 0 0 1 3 5a2 2 0 0 1 2-2z"
      transform="rotate(135 10 10)"
    />,
  ),
  Sparkle: make(<path d="M10 3v5M10 12v5M3 10h5M12 10h5" />),
  Bolt: make(<path d="M11 2 4 11h5l-1 7 7-9h-5l1-7z" />),
  Broadcast: make(
    <>
      <circle cx="10" cy="10" r="2" />
      <path d="M6 6a6 6 0 0 0 0 8M14 6a6 6 0 0 1 0 8M4 4a9 9 0 0 0 0 12M16 4a9 9 0 0 1 0 12" />
    </>,
  ),
  Logout: make(
    <>
      <path d="M12 14v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v2" />
      <path d="M8 10h10M15 7l3 3-3 3" />
    </>,
  ),
  Check: make(<path d="m4 10 4 4 8-8" />),
  Clock: make(
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" />
    </>,
  ),
};

export type IconComponent = (p: IconProps) => ReactNode;
