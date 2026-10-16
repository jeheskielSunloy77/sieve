---
name: PostPatrol
description: Clean modern architectural monotone design system for AI feed filtering
colors:
  primary: "#09090b"
  primary-contrast: "#ffffff"
  primary-dark: "#ffffff"
  primary-dark-contrast: "#09090b"
  neutral-bg: "#ffffff"
  neutral-bg-subtle: "#f9f9fb"
  neutral-surface: "#ffffff"
  neutral-surface-subtle: "#f4f4f5"
  neutral-surface-hover: "#ececee"
  neutral-border: "#e4e4e7"
  neutral-border-subtle: "#f0f0f2"
  neutral-text: "#09090b"
  neutral-text-secondary: "#52525b"
  neutral-text-muted: "#71717a"
  dark-bg: "#09090b"
  dark-surface: "#141417"
  dark-surface-subtle: "#1c1c20"
  dark-border: "#27272a"
  dark-text: "#fafafa"
  dark-text-secondary: "#d4d4d8"
  dark-text-muted: "#a1a1aa"
  dim-bg: "#15191e"
  dim-surface: "#1c2128"
  dim-border: "#2d333b"
  dim-text: "#f0f3f6"
  dim-text-muted: "#8b949e"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-contrast}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface-subtle}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  pill-toggle:
    backgroundColor: "{colors.neutral-surface-subtle}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.full}"
    padding: "5px 12px"
---

# PostPatrol Design System

## Overview
PostPatrol uses a clean, modern, architectural monotone design system inspired by Linear and Vercel. It rejects saturated platform brand blues, greens, and oranges in favor of high-contrast, tactile grayscale utility. The UI recedes quietly into social feeds (Twitter/X, Threads, LinkedIn, YouTube) while providing razor-sharp affordances for configuring local/BYOK AI models, managing filter topics, and inspecting filtered content.

## Colors
The palette is strictly pure monotone: 100% black, white, and neutral zinc across all components, badges, switches, and states.

- **Light Mode**:
  - Ground: `#ffffff` with subtle elevated surfaces (`#f9f9fb`, `#f4f4f5`)
  - Borders: Crisp hairline `#e4e4e7` (or `rgba(0, 0, 0, 0.1)`)
  - Primary text / accents: `#09090b`
  - Secondary / muted text: `#52525b`, `#71717a`
  - Active interactive elements: solid `#09090b` fill with `#ffffff` text

- **Dark Mode**:
  - Ground: Deep `#09090b` with elevated surfaces (`#141417`, `#1c1c20`)
  - Borders: Crisp hairline `#27272a` (or `rgba(255, 255, 255, 0.12)`)
  - Primary text / accents: `#fafafa`
  - Secondary / muted text: `#d4d4d8`, `#a1a1aa`
  - Active interactive elements: solid `#ffffff` fill with `#09090b` text

- **Dim Mode** (Twitter Dim):
  - Ground: Navy-slate `#15191e` with elevated surfaces (`#1c2128`, `#242a33`)
  - Borders: `#2d333b` (or `rgba(255, 255, 255, 0.12)`)
  - Primary text / accents: `#f0f3f6`
  - Secondary / muted text: `#c9d1d9`, `#8b949e`
  - Active interactive elements: solid `#ffffff` fill with `#15191e` text

## Typography
Clean, high-legibility system sans stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`).
- Headings: Tight letter-spacing (`-0.02em`), semibold (`600`), compact line-heights.
- Labels & Badges: Uppercase micro-typography (`10px`–`11px`), tracking `0.04em`–`0.05em`.
- Body: 13px at 1.45 line-height, optimized for scanability.
- Code / Debug: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.

## Layout
- Extension Popup: 400px width standalone; 400px modal iframe container with dynamic height reporting via ResizeObserver.
- Spacing Rhythm: 4px base grid (4px, 6px, 8px, 10px, 14px, 16px). Tight group spacing with clear structural margins.
- In-Feed Filter Box: Sticky/fixed sidebar container with hairline border and frosted glass backdrop blur (`backdrop-filter: blur(16px)`).

## Elevation & Depth
- Layering via hairline 1px borders and subtle background elevation rather than heavy drop shadows.
- Modals & Dropdowns: Diffuse, low-contrast shadows (`0 4px 16px rgba(0, 0, 0, 0.08)` on light, `0 8px 30px rgba(0, 0, 0, 0.6)` on dark).
- Frosted surfaces: `backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);`

## Shapes
Smooth modern geometry:
- Outer containers, dialogs, and modals: `12px` border-radius.
- Cards, accordions, and dropdown menus: `10px` border-radius.
- Inputs, buttons, and segmented options: `6px` border-radius.
- Micro-badges, toggles, and action pills: `9999px` (pill radius).

## Components
- **Segmented Mode Selector**: Dual-state toggle card (`On-Device` vs `API BYOK`). Inactive is subtle surface, active is inverted solid contrast.
- **Toggle Switches**: 36×20px track, 16px circular thumb. Off-state is neutral gray track with elevated white/silver thumb; On-state is solid primary fill with inverted thumb.
- **Model Dropdown**: Clean hairline trigger with animated chevron. Floating menu with categorized options and inline search.
- **Status Badges**: Monotone pills with hairline border. Active/Ready states use solid primary background with inverted text.
- **Filter Tags & Pills**: Sleek inline tags with subtle dismiss transitions.
- **Reasoning Popup**: Structured card with clean tab navigation, monotone status pills ("FILTERED", "ALLOWED"), and debug inspector.
- **Filtered Posts Drawer**: Distraction-free review surface with hairline card dividers and one-click unhide actions.

## Do's and Don'ts
- **DO**: Use CSS custom properties (`--pp-*` in content script, `--*` in popup) for all color and surface definitions.
- **DO**: Ensure all active states use inverted monotone contrast (solid black on light, solid white on dark).
- **DO**: Respect the project's security rule: never write to `.innerHTML`; always sanitize via `parseHTML(...)` and `replaceChildren(...)`.
- **DON'T**: Reintroduce Twitter-blue (`#1d9bf0`), brand orange (`#ea8554`), or multi-colored status tags.
- **DON'T**: Use thick colored borders (such as 4px colored border-left on toasts or 2px green/orange borders).
- **DON'T**: Animate layout properties (`width`, `height`, `padding`, `margin`) when `transform` or `opacity` can achieve the interaction smoothly.
