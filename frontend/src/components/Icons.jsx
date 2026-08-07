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

// Centrifugal pump, drawn the way the BƠM cells in front_require/2.jpg show it:
// a volute (round housing) on the suction side with its inlet flange, the
// discharge pipe rising out of the top of the volute, the finned motor block
// behind it, and the whole assembly sitting on a base plate. The old glyph was
// a circle with two hands and read as a stopwatch at every size it is used at.
export const IconPump = (p) => (
  <Svg {...p}>
    {/* discharge pipe out of the top of the volute, capped by its flange */}
    <path d="M6.2 3.4h5.4" strokeWidth="2.3" />
    <path d="M7.3 3.8v4.8M10.5 3.8v4.8" />
    {/* volute: an arc that closes onto the motor block, with the impeller hub */}
    <path d="M11.4 9a4.7 4.7 0 1 0 0 8" />
    <circle cx="8.9" cy="13" r="1.5" />
    {/* suction stub + inlet flange face */}
    <path d="M4.2 13H2.6" />
    <path d="M2.4 10.7v4.6" strokeWidth="2.3" />
    {/* motor block with its cooling fins */}
    <path d="M11.4 9h7.8a1.4 1.4 0 0 1 1.4 1.4v5.2a1.4 1.4 0 0 1-1.4 1.4h-7.8" />
    <path d="M13.4 10.9h6.4M13.4 13h6.4M13.4 15.1h6.4" />
    {/* feet + base plate */}
    <path d="M8.9 17.6v1.7M17.2 17v2.3" />
    <path d="M5.4 19.3h14" strokeWidth="2.3" />
  </Svg>
);

// Globe valve. The handwheel is what makes it a valve rather than a pipe
// fitting, and in the design (VAN cells, front_require/2.jpg) it is roughly a
// third of the artwork, so it is drawn full width here.
export const IconValve = (p) => (
  <Svg {...p}>
    {/* handwheel seen slightly from above, then the stem */}
    <ellipse cx="12" cy="4.2" rx="4.7" ry="1.9" />
    <path d="M12 6.1v2.3" />
    {/* bonnet tapering into the body */}
    <path d="M9.7 8.4h4.6l-1 2.1h-2.6Z" />
    {/* body */}
    <circle cx="12" cy="14" r="3.5" />
    {/* pipe runs with their end flanges */}
    <path d="M8.5 14H5.3M18.7 14h-3.2" />
    <path d="M4.9 11.5v5M19.1 11.5v5" strokeWidth="2.3" />
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

// The panel's home button holds a SOLID house with overhanging eaves and a
// doorway knocked out of the base — see the header of every design image. An
// outline house read far lighter than the design's mark at 30px.
export const IconHome = (p) => (
  <Svg {...p}>
    <path
      d="M12.63 3.2a1 1 0 0 0-1.26 0l-8.8 7.1a1 1 0 0 0 .63 1.78h1.2v7.9a1 1 0 0 0 1 1h4.5v-6h4.2v6h4.5a1 1 0 0 0 1-1v-7.9h1.2a1 1 0 0 0 .63-1.78Z"
      fill="currentColor"
      stroke="none"
    />
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

// Third link state: the page never told us. Dashed arcs and a hollow dot, so
// "unknown" is carried by the SHAPE and not only by the grey it is painted in.
export const IconWifiUnknown = (p) => (
  <Svg {...p}>
    <path d="M2.6 8.6a14 14 0 0 1 18.8 0" strokeDasharray="3 2.8" />
    <path d="M5.8 12.2a9.4 9.4 0 0 1 12.4 0" strokeDasharray="3 2.8" />
    <path d="M9 15.8a4.8 4.8 0 0 1 6 0" strokeDasharray="3 2.8" />
    <circle cx="12" cy="19.2" r="1.5" />
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

export const IconArrowLeft = (p) => (
  <Svg {...p}>
    <path d="M20.2 12H3.8" />
    <path d="M10.4 5.4 3.8 12l6.6 6.6" />
  </Svg>
);

// Affordance chevron on the MENU cards. Drawn heavier than the base weight so
// it still reads as a "go" arrow at the small size the cards use it at.
export const IconChevronRight = (p) => (
  <Svg strokeWidth="2.4" {...p}>
    <path d="M8.8 4.4 16.4 12l-7.6 7.6" />
  </Svg>
);

// --- Air + rain sensor -------------------------------------------------------
// The wind strokes on the left are what separate these from their soil twins.
export const IconAirTemp = (p) => (
  <Svg {...p}>
    <path d="M13 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z" />
    <path d="M15 9v6.5" strokeWidth="2.6" />
    <circle cx="15" cy="17.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M2.8 7.4h5.4M2.8 11.2h4M2.8 15h5" opacity=".6" />
  </Svg>
);

export const IconAirHumidity = (p) => (
  <Svg {...p}>
    <path d="M14.8 4.6c2.9 3.3 4.6 5.6 4.6 7.8a4.6 4.6 0 0 1-9.2 0c0-2.2 1.7-4.5 4.6-7.8Z" />
    <path d="M12.6 13.1a2.3 2.3 0 0 0 2.2 2.4" opacity=".55" />
    <path d="M2.6 8.2h4.6M2.6 12h3.6M2.6 15.8h4.2" opacity=".6" />
  </Svg>
);

export const IconRain = (p) => (
  <Svg {...p}>
    <path d="M7.6 15.2a3.8 3.8 0 0 1 .4-7.6 5.1 5.1 0 0 1 9.6 1.2 3.2 3.2 0 0 1-.4 6.4Z" />
    <path d="M8.6 17.8 7.4 20.6M12 17.8l-1.2 2.8M15.4 17.8l-1.2 2.8" />
  </Svg>
);

// --- Menu / navigation glyphs ------------------------------------------------
// The design's DASHBOARD glyph is a "data screen", not a bare monitor: bars on
// the left, a trend line on the right, and a pie breaking out of the bezel's
// bottom-right corner.
export const IconDashboard = (p) => (
  <Svg {...p}>
    <rect x="2.8" y="3.8" width="18.4" height="12.6" rx="2" />
    <path d="M8 20.6h8M12 16.4v4.2" />
    <path d="M6.4 13.2v-2.6M8.8 13.2V8.2M11.2 13.2V9.8" />
    <path d="M13.2 11.2 15 9.1l1.5 1.4 1.8-2.3" />
    <circle cx="17.4" cy="15.6" r="3.4" />
    <path d="M17.4 12.2v3.4h3.4" />
  </Svg>
);

export const IconControl = (p) => (
  <Svg {...p}>
    <path d="M6 3.4v6M6 13.4v7.2M12 3.4v3.2M12 10.6v10M18 3.4v10M18 17.4v3.2" />
    <circle cx="6" cy="11.4" r="2" />
    <circle cx="12" cy="8.6" r="2" />
    <circle cx="18" cy="15.4" r="2" />
  </Svg>
);

export const IconGear = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M18.9 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.7-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.7h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1.1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.7-1.1v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9Z" />
  </Svg>
);

export const IconInfo = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 11v5.6" />
    <circle cx="12" cy="7.7" r="1.05" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconLock = (p) => (
  <Svg {...p}>
    <rect x="4.4" y="10.2" width="15.2" height="10.4" rx="2.2" />
    <path d="M8.2 10.2V7.4a3.8 3.8 0 0 1 7.6 0v2.8" />
    <path d="M12 14.2v2.6" />
  </Svg>
);

// Mirrored to match the design: the frame is on the LEFT, notched on its right
// edge, and the arrow comes in from the right pointing into it.
export const IconLogout = (p) => (
  <Svg {...p}>
    <path d="M9.4 3.6H5.8a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h3.6" />
    <path d="M14.6 16.4 10.2 12l4.4-4.4" />
    <path d="M10.2 12h10.2" />
  </Svg>
);

// Account management (admin). Added by the integration agent for the link that
// reaches /users — the MENU grid has no tile for it.
export const IconUsers = (p) => (
  <Svg {...p}>
    <circle cx="9.2" cy="8.4" r="3.6" />
    <path d="M2.8 20.2a6.4 6.4 0 0 1 12.8 0" />
    <path d="M16.4 5.2a3.6 3.6 0 0 1 0 6.7" />
    <path d="M18.2 14.6a6.4 6.4 0 0 1 3 5.6" />
  </Svg>
);

// --- Operating-mode glyphs (CONTROL page) ------------------------------------
export const IconSliders = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M8.4 6.6v1.8M8.4 11.6v5.8" />
    <path d="M12 6.6v5.8M12 15.6v1.8" />
    <path d="M15.6 6.6v2.8M15.6 12.6v4.8" />
    <circle cx="8.4" cy="10" r="1.6" />
    <circle cx="12" cy="14" r="1.6" />
    <circle cx="15.6" cy="11" r="1.6" />
  </Svg>
);

// 'A' in a ring, wrapped by the broken cycle arrow that is the only thing
// separating "automatic" from a generic letter badge in the design.
export const IconAuto = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12.9" r="5.4" />
    <path d="M9.9 15.5 12 10.2l2.1 5.3" />
    <path d="M10.7 14.2h2.6" />
    <path d="M3 13.4a9 9 0 0 1 15.1-7.4" />
    <path d="M18.9 1.8v4.6h-4.6" />
  </Svg>
);

// --- System actions ----------------------------------------------------------
export const IconRestart = (p) => (
  <Svg {...p}>
    <path d="M20.4 12a8.4 8.4 0 1 1-2.7-6.2" />
    <path d="M20.6 3.8v4.8h-4.8" />
  </Svg>
);

export const IconRestore = (p) => (
  <Svg {...p}>
    <path d="M3.6 12a8.4 8.4 0 1 0 2.7-6.2" />
    <path d="M3.4 3.8v4.8h4.8" />
    <path d="M12 8.4v3.9l2.9 1.7" />
  </Svg>
);

export const IconWarning = (p) => (
  <Svg {...p}>
    <path d="M12 3.6 21.3 19.5a1.4 1.4 0 0 1-1.2 2.1H3.9a1.4 1.4 0 0 1-1.2-2.1Z" />
    <path d="M12 9.4v4.7" />
    <circle cx="12" cy="17.4" r="1.05" fill="currentColor" stroke="none" />
  </Svg>
);

// Filled sibling of IconWarning: a solid triangle with the bar and dot knocked
// out in white, as the emergency-stop bar draws it in the design. Use it where
// the mark has to carry weight; the outline version stays for list rows.
export const IconWarningSolid = (p) => (
  <Svg {...p}>
    <path
      d="M12 3.4 21.4 19.4a1.4 1.4 0 0 1-1.2 2.1H3.8a1.4 1.4 0 0 1-1.2-2.1Z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path d="M12 9.6v4.7" stroke="#fff" strokeWidth="2.3" />
    <circle cx="12" cy="17.5" r="1.2" fill="#fff" stroke="none" />
  </Svg>
);

// Two-arrow circular sync. The design's "khôi phục cài đặt trước" button uses
// this, not the single arrow + clock hand of IconRestore (which reads as
// "history"). IconRestore is kept so nothing that imports it breaks.
export const IconSync = (p) => (
  <Svg {...p}>
    <path d="M20.4 11.4A8.4 8.4 0 0 0 6.2 6.2" />
    <path d="M3.6 12.6a8.4 8.4 0 0 0 14.2 5.2" />
    <path d="M20.8 3.6v4.6h-4.6" />
    <path d="M3.2 20.4v-4.6h4.6" />
  </Svg>
);

// Humidity droplet carrying a % mark, so the humidity threshold box does not
// share one glyph with pH separated only by hue.
export const IconHumidityPct = (p) => (
  <Svg {...p}>
    <path d="M12 3.2c3.4 3.9 5.4 6.6 5.4 9.2a5.4 5.4 0 0 1-10.8 0c0-2.6 2-5.3 5.4-9.2Z" />
    <path d="M14.3 11.3 9.7 16.4" />
    <circle cx="9.9" cy="11.5" r="1.15" />
    <circle cx="14.1" cy="16.2" r="1.15" />
  </Svg>
);

// Single leaf, for the nitrogen tank. IconNutrient (droplet + leaf) stays the
// KALI & ĐẠM card's glyph; the design does not repeat it in the tank list.
export const IconLeaf = (p) => (
  <Svg {...p}>
    <path d="M12 20.8c-4.7 0-7.8-3.4-7.8-8 0-5.4 4.6-9.6 15.6-9.6.7 10.4-3.5 17.6-7.8 17.6Z" />
    <path d="M12 20.8c0-5.8 1.7-10.4 5.6-14.6" opacity=".6" />
  </Svg>
);

// Danger-level alert. A distinct octagon so `danger` and `warning` differ by
// SHAPE, not only by the row's red-vs-amber tint.
export const IconStop = (p) => (
  <Svg {...p}>
    <path d="M8.4 2.8h7.2l5.6 5.6v7.2l-5.6 5.6H8.4l-5.6-5.6V8.4Z" />
    <path d="M8.6 12h6.8" strokeWidth="2.2" />
  </Svg>
);

export const IconSave = (p) => (
  <Svg {...p}>
    <path d="M5.2 3.4h11l4.4 4.4v11.4a1.4 1.4 0 0 1-1.4 1.4H5.2a1.4 1.4 0 0 1-1.4-1.4V4.8a1.4 1.4 0 0 1 1.4-1.4Z" />
    <path d="M7.8 3.4v5.2h7.6V3.4" />
    <rect x="7.8" y="12.6" width="8.4" height="6.4" rx="1.2" />
  </Svg>
);

// Per-tank glyphs, matching the fertigation rig: potassium, nitrogen, water, mix.
// The mixer is three identical blades at 120° about the hub — the previous
// version put two lobes on one axis and faded a third, which filled in to an
// off-centre blob at the 22px the tank rows use.
const MIX_BLADE = 'M12 10.2c-2.2-2-2.5-4.2-.9-5.2 1.3-.8 3 .2 3.1 2 .1 1.3-.6 2.5-2.2 3.2Z';

export const TANK_ICON = {
  dist1: IconPh,
  dist2: IconLeaf,
  dist3: IconHumidity,
  dist4: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2" />
      <path d={MIX_BLADE} />
      <g transform="rotate(120 12 12)">
        <path d={MIX_BLADE} />
      </g>
      <g transform="rotate(240 12 12)">
        <path d={MIX_BLADE} />
      </g>
    </Svg>
  ),
};
