# DESIGN.md — ShaderMesh Dashboard

The design system. Amber accent on a zinc neutral base. Restrained color: amber
is for primary actions, current selection, and state only, never decoration.

## Color tokens

Light theme:
- bg `#FFFFFF`, surface `#FAFAFA`, panel `#F4F4F5`, hover `#F4F4F5`
- border `#E4E4E7`, border-strong `#D4D4D8`
- ink `#18181B`, ink-2 `#3F3F46`, muted `#52525B`, faint `#71717A`
- accent `#D97706`, accent-hover `#B45309`, accent-weak `#FEF3C7`

Dark theme:
- bg `#0B0C0E`, surface `#121417`, panel `#17191D`, hover `#1D2024`
- border `#26282D`, border-strong `#33363C`
- ink `#F4F4F5`, ink-2 `#D4D4D8`, muted `#A1A1AA`, faint `#71717A`
- accent `#F59E0B`, accent-hover `#FBBF24`, accent-weak `#2A2011`

Semantic (muted, not neon), both themes tuned per surface:
- success `#15803D` (dark `#22C55E`), warning `#B45309` (dark `#F59E0B`),
  danger `#B91C1C` (dark `#F87171`), info uses neutral zinc.

## Typography

- One family for UI: Inter (fallback system-ui, Segoe UI).
- Monospace for hashes, addresses, amounts, ids: JetBrains Mono (fallback
  ui-monospace, Consolas).
- Fixed rem scale, ratio ~1.2: 12, 13, 14, 16, 20, 24, 30 px.
- Weights: 400 body, 500 labels and table headers, 600 headings. No heavier.
- Numeric data uses tabular figures.

## Shape, border, elevation

- Radius: 6px controls, 8px cards and panels. No pill shapes except small chips.
- Borders: hairline 1px as the primary separation device.
- Elevation: minimal. One small shadow token reserved for overlays only. Never
  pair a 1px border with a wide soft shadow on the same element.

## Spacing and layout

- 4px spacing grid. Sidebar plus top bar. Content max width for prose; tables
  may run dense and wide.
- Responsive behavior is structural: collapse the sidebar, make tables scroll or
  reflow, drive columns by breakpoint. No fluid heading sizes.

## State vocabulary

Every interactive element defines default, hover, focus, active, disabled,
loading, selected. Focus is a 2px amber ring with offset. Loading uses skeletons,
not center spinners. Empty states teach the interface.

## Motion

- 150 to 220 ms, ease-out. Motion conveys state (verification pulse, tile fill,
  row update), never decoration. Respect prefers-reduced-motion.
