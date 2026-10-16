# Sieve — Web Extension

The main codebase for the Sieve browser extension (Chrome MV3, Firefox, Safari desktop).

## Build

```bash
npm install
npm run build          # one-time build
npm run watch          # dev mode with file watching
npm run build:dev      # dev build (no minification)
npm run watch:dev      # dev watch mode
```

Then load the unpacked extension from this folder at `chrome://extensions` (with Developer mode enabled).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Production build via esbuild |
| `npm run watch` | Rebuild on file changes |
| `npm run test` | Run unit tests (vitest) |
| `npm run lint` | ESLint + TypeScript type checking |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run typecheck` | TypeScript only |
| `npm run cut-chrome` | Prepare Chrome Web Store build |

## Source Layout

```
src/
  background/
    index.ts             # Service worker entry: message routing, tab tracking
    pipeline.ts          # Post evaluation queue, batching, caching, error state
    local-model.ts       # LiteRT-LM engine lifecycle, inference, preemption
    inference-queue.ts   # Serial priority queue for local model tasks
    providers.ts         # API calls (OpenAI, Gemini, Anthropic, OpenRouter)
  content/
    index.ts             # MutationObserver, post detection, queue submission
    ui.ts                # Sidebar, modals, alerts, theming, filter management
    ios.ts               # iOS-specific UI (FAB button, full-screen overlay)
  shared/
    models.ts            # Model definitions and API endpoints
    prompts.ts           # System prompts for local and API models
    platforms.ts         # Platform registry and adapter configuration
    storage.ts           # Typed chrome.storage wrappers
    utils.ts             # Cache keys, response parsing, formatting

adapters/
  twitter/
    TwitterAdapter.ts    # DOM selectors, post extraction, theme detection
    twitter.css          # Twitter-specific style overrides
  threads/
    ThreadsAdapter.ts    # Semantic Threads DOM extraction and feed behavior
    threads.css          # Threads-specific banner and action styling
  linkedin/
    LinkedInAdapter.ts   # LinkedIn feed DOM extraction and feed behavior
    linkedin.css         # LinkedIn-specific style overrides
  youtube/
    YouTubeAdapter.ts    # YouTube feed DOM extraction and feed behavior
    youtube.css          # YouTube-specific style overrides

popup.html / popup.js / popup.css   # Extension settings UI
content.css                          # Content script styles
adapters/twitter/fiber-extractor.js  # Main-world X/Twitter store access
manifest.json                        # Generated browser manifest
```

## Dependencies

- **[@litert-lm/core](https://www.npmjs.com/package/@litert-lm/core)** — in-browser model inference via WebGPU
- **[DOMPurify](https://github.com/cure53/DOMPurify)** — HTML sanitization
- **[esbuild](https://esbuild.github.io/)** — bundler
- **[vitest](https://vitest.dev/)** — test runner
- **[TypeScript](https://www.typescriptlang.org/)** — type checking (no emit, esbuild handles transpilation)
