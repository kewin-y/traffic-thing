import type { ComponentKind } from "../lib/components";

// Small isometric-ish glyphs for the toolbox; colours match the 3D components.
const GLYPHS: Partial<Record<ComponentKind, React.ReactNode>> = {
  car_lane: (
    <>
      <rect x="3" y="2" width="18" height="20" rx="1" fill="#4b5058" />
      <path d="M12 4v4M12 11v3M12 17v3" stroke="#f4f1e8" strokeWidth="1.4" />
    </>
  ),
  road: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="1" fill="#4b5058" />
      <path d="M11.4 3v18M12.6 3v18" stroke="#f2c230" strokeWidth="0.9" />
      <path d="M3.6 3v18M20.4 3v18" stroke="#f4f1e8" strokeWidth="0.9" />
    </>
  ),
  streetlight: (
    <>
      <rect x="7" y="4" width="1.8" height="18" fill="#3a3d42" />
      <path d="M8 4.8h8" stroke="#3a3d42" strokeWidth="1.6" />
      <rect
        x="13.5"
        y="5.2"
        width="5"
        height="2.2"
        rx="0.8"
        fill="#fff3b0"
        stroke="#3a3d42"
        strokeWidth="0.6"
      />
      <path
        d="M14.5 9.5l-1 2.5M17.5 9.5l1 2.5M16 9.5v2.8"
        stroke="#f2c230"
        strokeWidth="0.7"
      />
    </>
  ),
  bike_lane: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="1" fill="#4f8a5b" />
      <circle
        cx="9.5"
        cy="15"
        r="2.2"
        fill="none"
        stroke="#f4f1e8"
        strokeWidth="1.1"
      />
      <circle
        cx="14.5"
        cy="15"
        r="2.2"
        fill="none"
        stroke="#f4f1e8"
        strokeWidth="1.1"
      />
      <path
        d="M9.5 15 12 10.5h2.5L14.5 15M11 10.5h2"
        stroke="#f4f1e8"
        strokeWidth="1.1"
        fill="none"
      />
    </>
  ),
  streetcar_lane: (
    <>
      <rect x="3" y="2" width="18" height="20" rx="1" fill="#585c63" />
      <path d="M8.5 2v20M15.5 2v20" stroke="#25272b" strokeWidth="1.6" />
      <path d="M7 6h10M7 11h10M7 16h10" stroke="#8a8f96" strokeWidth="1" />
    </>
  ),
  sidewalk: (
    <>
      <path d="M3 9 12 4l9 5-9 5z" fill="#e0dbd0" />
      <path d="M3 9v3l9 5v-3zM21 9v3l-9 5v-3z" fill="#b5afa3" />
    </>
  ),
  crosswalk: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="1" fill="#4b5058" />
      <path
        d="M5 6v12M9 6v12M13 6v12M17 6v12"
        stroke="#f4f1e8"
        strokeWidth="2"
      />
    </>
  ),
  streetcar: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="2.5" fill="#d6281f" />
      <rect x="4" y="9" width="16" height="3.5" rx="0.6" fill="#2b3540" />
      <path d="M9 9v3.5M15 9v3.5" stroke="#d6281f" strokeWidth="1" />
      <path d="M10 7l2-3 2 3" stroke="#3a3d42" strokeWidth="1" fill="none" />
      <circle cx="6.5" cy="18" r="1.3" fill="#25272b" />
      <circle cx="17.5" cy="18" r="1.3" fill="#25272b" />
    </>
  ),
  transit_shelter: (
    <>
      <rect x="3" y="5" width="18" height="2" fill="#3a3d42" />
      <rect x="5" y="7" width="14" height="11" fill="#a9cfe0" opacity="0.8" />
      <rect x="7" y="13" width="10" height="1.6" fill="#a8743f" />
      <path d="M5 7v12M19 7v12" stroke="#3a3d42" strokeWidth="1.4" />
    </>
  ),
  traffic_light: (
    <>
      <rect x="11" y="13" width="2" height="9" fill="#3a3d42" />
      <rect x="8" y="2" width="8" height="12" rx="1.5" fill="#1f2124" />
      <circle cx="12" cy="4.8" r="1.4" fill="#e5392f" />
      <circle cx="12" cy="8" r="1.4" fill="#f2b134" />
      <circle cx="12" cy="11.2" r="1.4" fill="#3fcf6a" />
    </>
  ),
  stop_sign: (
    <>
      <rect x="11.2" y="13" width="1.6" height="9" fill="#3a3d42" />
      <path
        d="M9 2h6l4 4v6l-4 4H9l-4-4V6z"
        fill="#e5392f"
        stroke="#fff"
        strokeWidth="0.8"
      />
      <text
        x="12"
        y="10.6"
        textAnchor="middle"
        fontSize="4.2"
        fontWeight="700"
        fill="#fff"
      >
        STOP
      </text>
    </>
  ),
  speed_sign: (
    <>
      <rect x="11.2" y="15" width="1.6" height="7" fill="#3a3d42" />
      <rect
        x="6.5"
        y="1.5"
        width="11"
        height="14"
        rx="1"
        fill="#fff"
        stroke="#111"
        strokeWidth="0.9"
      />
      <text
        x="12"
        y="5.8"
        textAnchor="middle"
        fontSize="3"
        fontWeight="700"
        fill="#111"
      >
        MAX
      </text>
      <text
        x="12"
        y="12.8"
        textAnchor="middle"
        fontSize="6.2"
        fontWeight="700"
        fill="#111"
      >
        40
      </text>
    </>
  ),
  tree: (
    <>
      <rect x="11" y="14" width="2" height="8" fill="#7a5534" />
      <circle cx="12" cy="10" r="7" fill="#4f9a45" />
      <circle cx="13.5" cy="7.5" r="3.5" fill="#6bb35a" />
    </>
  ),
  bench: (
    <>
      <rect x="3" y="7" width="18" height="3" rx="0.6" fill="#a8743f" />
      <rect x="2.5" y="12" width="19" height="3" rx="0.6" fill="#c08850" />
      <path d="M5 15v5M19 15v5" stroke="#3a3d42" strokeWidth="1.6" />
    </>
  ),
  building: (
    <>
      <path d="M4 8 12 4l8 4v11l-8 3-8-3z" fill="#d9c2a7" />
      <path d="M12 12v10l8-3V8z" fill="#b9a084" />
      <path d="M4 8l8 4 8-4-8-4z" fill="#efe1cd" />
      <path
        d="M6 12.5v2M9 14v2M6 16.5v2M9 18v2M14.5 15v2M17.5 14v2M14.5 19v1.5M17.5 18v1.5"
        stroke="#5b6b7a"
        strokeWidth="1.2"
      />
    </>
  ),
};

export function ToolIcon({
  kind,
  className,
}: {
  kind: ComponentKind;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {GLYPHS[kind]}
    </svg>
  );
}
