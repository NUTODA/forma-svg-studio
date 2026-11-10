// UI glyphs (interface chrome only — never used as artwork). 16×16 grid, 1.5 stroke, currentColor.
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7" />
  </Icon>
);

export const IconRedo = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3" />
  </Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v8" />
    <path d="m4.5 7 3.5 3.5L11.5 7" />
    <path d="M2.5 13.5h11" />
  </Icon>
);

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 10.5v-8" />
    <path d="M4.5 6 8 2.5 11.5 6" />
    <path d="M2.5 13.5h11" />
  </Icon>
);

export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Icon>
);

export const IconDuplicate = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    <path d="M9.5 8v3M8 9.5h3" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h11" />
    <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    <path d="M4 4.5 4.6 13a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.5" />
  </Icon>
);

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const IconEyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a11 11 0 0 1-1.9 2.4" />
    <path d="M10.6 11.7A6.4 6.4 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.6-3.1" />
    <path d="M2.5 2.5l11 11" />
  </Icon>
);

export const IconArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const IconArrowDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);

export const IconBringFront = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity={0.15} />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" strokeDasharray="1.5 1.5" />
  </Icon>
);

export const IconSendBack = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" strokeDasharray="1.5 1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Icon>
);

export const IconRotate = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" />
    <path d="M13 2.5v2.5h-2.5" />
  </Icon>
);

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 6.5A5 5 0 0 0 3.6 5" />
    <path d="M3 9.5A5 5 0 0 0 12.4 11" />
    <path d="M3.5 2.5V5H6" />
    <path d="M12.5 13.5V11H10" />
  </Icon>
);

// A four-point sparkle with a small companion star. The old eight-ray glyph read as a loading spinner.
export const IconSparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 2.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z" />
    <path d="M12.5 10c.2 1.1.7 1.6 1.8 1.8-1.1.2-1.6.7-1.8 1.8-.2-1.1-.7-1.6-1.8-1.8 1.1-.2 1.6-.7 1.8-1.8Z" />
  </Icon>
);

/** Busy indicator: an open ring that the stylesheet rotates (`.spin`). */
export const IconSpinner = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.25a5.75 5.75 0 1 1-5.75 5.75" />
  </Icon>
);

export const IconText = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 4V3h10v1" />
    <path d="M8 3v10" />
    <path d="M6 13h4" />
  </Icon>
);

export const IconLayers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2 1.5 5.5 8 9l6.5-3.5L8 2Z" />
    <path d="m1.5 8.5 6.5 3.5 6.5-3.5" />
    <path d="m1.5 11 6.5 3.5 6.5-3.5" opacity={0.5} />
  </Icon>
);

export const IconPalette = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5c.9 0 1.4-.6 1.4-1.3 0-.9-.8-1.2-.8-2 0-.8.6-1.2 1.4-1.2h1.6a2.7 2.7 0 0 0 2.65-2.7c0-3-2.8-5.3-6.25-5.3Z" />
    <circle cx="4.75" cy="7.5" r=".75" fill="currentColor" />
    <circle cx="6.75" cy="4.75" r=".75" fill="currentColor" />
    <circle cx="10" cy="4.75" r=".75" fill="currentColor" />
  </Icon>
);

export const IconBackground = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="m2.5 11 3.5-3.5 3 3 1.5-1.5 3 3" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 8.5 3 3 7-7" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2 1.5 13.5h13L8 2Z" />
    <path d="M8 6.5v3" />
    <path d="M8 11.5v.01" />
  </Icon>
);

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.5v3.5" />
    <path d="M8 5v.01" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);

export const IconKeyboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4.5 9.5h7" />
  </Icon>
);

export const IconRatioSquare = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
  </Icon>
);

export const IconRatioPortrait = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="2" width="8" height="12" rx="1.5" />
  </Icon>
);

export const IconRatioLandscape = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.5" y="4.25" width="13" height="7.5" rx="1.5" />
  </Icon>
);

export const IconMove = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.5v13M1.5 8h13" />
    <path d="m6 3.5 2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
  </Icon>
);

export const IconFile = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 1.75H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.25L9 1.75Z" />
    <path d="M9 1.75v3.5h3.5" />
  </Icon>
);
