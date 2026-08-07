// Line icons drawn to match the control-panel design. All stroke-based and
// inheriting `currentColor`, so a card only has to set its accent colour once.
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Svg({ children, size = 40, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      {...base}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconTemperature = (p) => (
  <Svg {...p}>
    <path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z" />
    <path d="M12 9v6.5" strokeWidth="2.6" />
    <circle cx="12" cy="17.5" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconHumidity = (p) => (
  <Svg {...p}>
    <path d="M12 3.2c3.4 3.9 5.4 6.6 5.4 9.2a5.4 5.4 0 0 1-10.8 0c0-2.6 2-5.3 5.4-9.2Z" />
    <path d="M9.4 13.4a2.7 2.7 0 0 0 2.6 2.8" opacity=".55" />
  </Svg>
);

export const IconPh = (p) => (
  <Svg {...p}>
    <path d="M9.5 3h5M10.5 3v5.4L6.4 17a2.4 2.4 0 0 0 2.1 3.5h7a2.4 2.4 0 0 0 2.1-3.5l-4.1-8.6V3" />
    <path d="M7.6 14.6h8.8" />
    <circle cx="10.6" cy="17.3" r="1" fill="currentColor" stroke="none" opacity=".6" />
    <circle cx="13.6" cy="18.2" r=".7" fill="currentColor" stroke="none" opacity=".6" />
  </Svg>
);

export const IconEc = (p) => (
  <Svg {...p}>
    <rect x="10" y="2.8" width="4" height="10.4" rx="2" />
    <path d="M12 13.2v3" />
    <path d="M7.5 17.5a6 6 0 0 1 9 0" opacity=".75" />
    <path d="M5.2 20.4a9.2 9.2 0 0 1 13.6 0" opacity=".45" />
  </Svg>
);

export const IconNutrient = (p) => (
  <Svg {...p}>
    <path d="M8.2 3.4c2.4 2.8 3.8 4.7 3.8 6.5a3.8 3.8 0 0 1-7.6 0c0-1.8 1.4-3.7 3.8-6.5Z" />
    <path d="M20 11.4c-3.6.3-6 1.7-7.2 4.2-1.2 2.5-.7 4.8.4 5.9 1.6-.3 3.6-1.6 4.8-4 1.2-2.5 1.9-4.2 2-6.1Z" />
    <path d="M13.2 21.5c.6-2.9 1.9-5.4 3.8-7.4" opacity=".55" />
  </Svg>
);

export const IconPump = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="13" r="5.2" />
    <path d="M11 7.8V13l3.6 2.6" />
    <path d="M11 3.4v2.6M6.4 5.6l1.6 2.1" opacity=".7" />
    <path d="M16.2 13H21v4.6h-4.2" />
    <path d="M3.2 19.6h15.6" opacity=".5" />
  </Svg>
);

export const IconValve = (p) => (
  <Svg {...p}>
    <path d="M2.8 12h4M17.2 12h4" />
    <rect x="6.8" y="8.6" width="10.4" height="6.8" rx="1.6" />
    <path d="M12 8.6V4.4M9 4.4h6" />
    <path d="M9.6 12h4.8" opacity=".6" />
  </Svg>
);

export const IconLora = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="1.9" fill="currentColor" stroke="none" />
    <path d="M8.6 5.6a4.8 4.8 0 0 0 0 6.8M15.4 5.6a4.8 4.8 0 0 1 0 6.8" />
    <path d="M6.2 3.2a8.2 8.2 0 0 0 0 11.6M17.8 3.2a8.2 8.2 0 0 1 0 11.6" opacity=".5" />
    <path d="M10.6 12.4 9.2 21h5.6l-1.4-8.6" />
  </Svg>
);

export const IconTanks = (p) => (
  <Svg {...p}>
    <rect x="3" y="4.4" width="18" height="15.2" rx="2" />
    <path d="M3.4 10.5c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0l2 .1" />
    <path d="M3.4 15c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0l2 .1" opacity=".55" />
  </Svg>
);

export const IconHome = (p) => (
  <Svg {...p}>
    <path d="M3.6 10.6 12 3.8l8.4 6.8V20a1 1 0 0 1-1 1h-4.6v-6H10.2v6H5.6a1 1 0 0 1-1-1Z" />
  </Svg>
);

export const IconWifi = (p) => (
  <Svg {...p}>
    <path d="M2.6 8.6a14 14 0 0 1 18.8 0" />
    <path d="M5.8 12.2a9.4 9.4 0 0 1 12.4 0" />
    <path d="M9 15.8a4.8 4.8 0 0 1 6 0" />
    <circle cx="12" cy="19.2" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconWifiOff = (p) => (
  <Svg {...p}>
    <path d="M2.6 8.6a14 14 0 0 1 5.2-3.3" />
    <path d="M16.4 5.6a14 14 0 0 1 5 3M5.8 12.2a9.4 9.4 0 0 1 3-1.9" opacity=".8" />
    <path d="M9 15.8a4.8 4.8 0 0 1 4.6-.4" />
    <path d="M3.5 3.5l17 17" strokeWidth="1.9" />
  </Svg>
);

export const IconClock = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2V12l3.2 1.9" />
  </Svg>
);

export const IconCalendar = (p) => (
  <Svg {...p}>
    <rect x="3.4" y="5" width="17.2" height="15.6" rx="2" />
    <path d="M3.4 9.6h17.2M8.4 3.2v3.6M15.6 3.2v3.6" />
  </Svg>
);

// Per-tank glyphs, matching the fertigation rig: potassium, nitrogen, water, mix.
export const TANK_ICON = {
  dist1: IconPh,
  dist2: IconNutrient,
  dist3: IconHumidity,
  dist4: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2.1" />
      <path d="M12 9.9c.6-3 2.2-4.6 4.3-4.2 1.6.3 2 2.1.6 3.3-1.1 1-2.8 1.3-4.9.9Z" />
      <path d="M12 14.1c-.6 3-2.2 4.6-4.3 4.2-1.6-.3-2-2.1-.6-3.3 1.1-1 2.8-1.3 4.9-.9Z" />
      <path d="M10.4 11.2c-2.6-1.6-3.4-3.7-2-5.2 1.1-1.2 2.7-.3 3.2 1.5.3 1.4 0 2.8-1.2 3.7Z" opacity=".6" />
    </Svg>
  ),
};
