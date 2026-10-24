# DESIGN.md — ShaderMesh design system (master)

Single source of truth for the web interface. Every color, size, radius, and
duration used in `src/` comes from the tokens below, defined in
`src/app/globals.css` and exposed through `tailwind.config.ts`. No other hex
values belong in components.

## Theses

**Visual.** A light-first, product-editorial interface. Warm off-white paper and
ink-black type, with an equal deep-charcoal dark theme. Amber is the only
chromatic accent and marks primary actions, the active state, and live signals.
Geist with strong size contrast for headings, Geist Mono for every hash, address,
and amount. Airy 8px rhythm on the landing page, tighter rhythm in app tables.
Flat surfaces with hairline borders, 6px controls and 8px cards, shadows only on
overlays. Hand-built SVG protocol diagrams are the hero visuals.

**Interaction.** Calm and quick. 150 to 250ms with `cubic-bezier(0.2, 0, 0, 1)`.
Hover shifts border and surface tone and underlines links, never scales.
One-shot 8px fade-up reveals with a 40ms stagger on the landing page only.
Motion conveys state only: the current lease state lights up, flow dashes travel
along active token edges, heartbeat ticks land in real time. Forbidden: bounce or
elastic easing, parallax, scroll-jacking, glows, and decorative infinite loops
(the single live indicator dot is the exception). `prefers-reduced-motion`
disables all motion.

## Color tokens

Light is the default. Dark applies with `data-theme="dark"` on `<html>`, chosen by
the theme toggle and remembered per browser.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FBFAF7` | `#0F0E0C` | Page field (paper) |
| `--chrome` | `#F6F4EF` | `#13120F` | Sidebar, header |
| `--surface` | `#FFFFFF` | `#181714` | Cards |
| `--panel` | `#F3F1EC` | `#1E1C19` | Insets within cards |
| `--hover` | `#EFECE6` | `#24221E` | Hover fill |
| `--active` | `#E7E3DB` | `#2C2A25` | Pressed fill |
| `--border` | `#E6E2DA` | `#2A2824` | Hairlines |
| `--border-strong` | `#D3CEC4` | `#3A3732` | Inputs, emphasis |
| `--ink` | `#1A1814` | `#F3F1EC` | Primary text |
| `--ink2` | `#3A362F` | `#D6D2CA` | Secondary text |
| `--muted` | `#5E5950` | `#A8A39A` | Labels |
| `--faint` | `#6F6A60` | `#8E897F` | Captions, meta |
| `--accent` | `#D97706` | `#F59E0B` | Fills, rings, active marks |
| `--accent-hover` | `#B45309` | `#FBBF24` | Primary hover |
| `--accent-text` | `#A34A06` | `#F59E0B` | Accent text (AA on paper) |
| `--accent-weak` | `#FDF3E1` | `#2A2011` | Selected rows, chips |
| `--accent-ink` | `#1A1205` | `#1A1205` | Text on amber fills |
| `--success` | `#137535` | `#4CC38A` | Healthy, settled |
| `--warning` | `#B45309` | `#FBBF24` | Pending, at risk |
| `--danger` | `#B91C1C` | `#F87171` | Slashed, failed |

Each semantic color has a `-weak` fill for chips. `text-accent` maps to
`--accent-text`, so amber text stays at 4.5:1 or better on paper. All text pairs
meet WCAG AA on `--bg`, `--chrome`, and `--surface` in both themes.

Diagram roles reuse the same tokens: requester and escrow edges in `--ink2`,
provider payout in `--success`, slashes in `--danger`, the live edge in
`--accent`.

## Typography

- UI and display: Geist (fallback system-ui, Segoe UI). Mono: Geist Mono
  (fallback ui-monospace, Consolas), for hashes, addresses, ids, and amounts.
- Scale (px): 12, 13, 14, 16, 18, 24, 36, 56. Landing hero is 56 (36 on mobile),
  section headings 36 (24 on mobile), app page titles 18, card titles 15.
- Weights: 400 body, 500 labels, 600 headings. Headings tracking `-0.02em`.
- Line height: 1.1 display, 1.3 headings, 1.6 prose, 1.5 UI.
- Numeric data uses tabular figures and slashed zero.

## Spacing, shape, elevation

- 4px grid, 8px rhythm. Landing sections pad 96px vertically (64px on mobile).
  Cards pad 20px. Table cells 12px by 16px.
- Radius: `--radius-control` 6px, `--radius-card` 8px. Chips may be fully round,
  buttons never are.
- Borders: 1px hairlines are the main separation device.
- Elevation: one overlay shadow token. Cards are flat.

## Motion tokens

- `--ease-out: cubic-bezier(0.2, 0, 0, 1)`
- `--dur-fast: 150ms` (hover, press), `--dur: 200ms` (state change),
  `--dur-slow: 250ms` (reveals)
- `--stagger: 40ms` between revealed siblings
- Flow dashes travel at one dash length per 1.2s, only on active edges.

## Components

Button (primary, secondary, ghost, danger), Input, Select, Card and CardHead,
Stat, StatusTag, CopyValue, Note, Empty, Skeleton, Table primitives, ThemeToggle.

Every interactive element defines default, hover, focus, active, disabled, and
loading. Focus is a 2px amber ring with 2px offset. Loading uses skeletons.

Protocol diagrams (`src/components/diagrams.tsx`): LeaseLifecycle, TokenFlow,
EscrowIntervals, HeartbeatStrip, ChallengeTrack. Each is inline SVG drawn with
`currentColor` and tokens, labelled for screen readers, and captioned like a
figure.

## Layout

- `/` is the landing page with a top bar and no sidebar.
- App routes use a left sidebar and a top bar. Content max width 1280px.
- Breakpoints: 375, 768, 1024, 1440. The sidebar collapses to a scrolling tab row
  below 768. Tables scroll horizontally inside their card.

## Prohibited

Neon colors, violet or purple gradients, glassmorphism, large glows, decorative
multicolor gradients, pill-shaped buttons, emoji, and em dashes in copy.
