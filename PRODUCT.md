# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Social media users on X/Twitter, Threads, and LinkedIn who want to take control of their timelines by filtering out rage-bait, crypto spam, engagement traps, and AI slop using natural language topics.

## Product Purpose

PostPatrol cleans up social feeds in real time using AI. Users define filter topics in natural English, and PostPatrol hides matching posts automatically while keeping a transparent log of what was filtered and why.

## Positioning

Unlike basic keyword blockers, PostPatrol understands semantic intent and multimodal image content, running either completely private on-device via WebGPU or through user-provided AI model keys (OpenAI, Gemini, Anthropic, OpenRouter).

## Operating Context

Runs as a browser extension (Chrome, Edge, Brave, Safari, Firefox). Operates in two distinct UI spaces:
1. **Extension Popup**: Standalone or modal settings window for model selection (on-device vs BYOK APIs), platform toggles, and AI detection thresholds.
2. **In-Feed Injected UI**: Sidebar filter box, floating quick-filter pills, reasoning popups on filtered posts, and the filtered posts review drawer.

## Capabilities and Constraints

- Manifest V3 browser extension architecture.
- Security constraint: Strict ban on `.innerHTML`. All dynamic HTML insertion must use `parseHTML(...)` with `DOMPurify` and `element.replaceChildren(...)`.
- Theme adaptability: Must flawlessly support light mode, dim mode, and dark mode.
- User-bound visual identity: Monotone color palette (primary black on light mode, primary white on dark mode), architectural minimalism, razor-sharp 1px borders.
- Preserves all existing functionality: model switching, on-device download progress, provider credentials, platform toggles, filter replies, AI detection threshold sliders, sharing filter packs.

## Brand Commitments

- Name: PostPatrol ("Heal your feed").
- Aesthetic commitment: Clean, modern, architectural minimalism with a strict monotone palette (black/white/grayscale).
- Typography: Clean, high-legibility system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).

## Evidence on Hand

- Complete working extension codebase in `web/`.
- Existing UI implementations in `web/popup.html`, `web/popup.css`, `web/content.css`, `web/src/content/ui.ts`, and `web/src/popup/index.ts`.

## Product Principles

1. **Quiet Utility**: The UI recedes into the background and complements the host site without competing for attention.
2. **Total Transparency**: Every filter action has an explainable AI reasoning card and one-click unhide/restore.
3. **Architectural Restraint**: Pure monotone contrast, structured geometry, subtle hairline borders, and zero decorative color clutter.
4. **Resilient Performance**: Zero layout shifts, snappy micro-interactions, and accessible tap/click targets.

## Accessibility & Inclusion

- Meets WCAG AA contrast standards across light, dim, and dark modes using calculated monotone values.
- Keyboard navigable controls with visible focus rings.
- Proper ARIA landmarks and roles on toggles, dropdowns, and sliders.
