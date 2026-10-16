# Sieve

<p align="center">
  <img src="web/icons/icon128.png" alt="Sieve" width="128" />
</p>

**Heal your feed.** Sieve is a browser extension that uses AI to filter unwanted posts from your X, Threads, and LinkedIn feeds. Define filter topics in plain language — "crypto", "engagement bait", "rage politics" — and Sieve classifies and hides matching posts in real time.

## Features

- **Natural language filters** — describe what you don't want to see in your own words
- **Multiple AI backends** — run models locally on your GPU, or connect your own API keys (OpenRouter, OpenAI, Google Gemini, Anthropic)
- **On-device inference** — local models run entirely in your browser with zero data sent externally
- **Image-aware filtering** — multimodal models can classify posts based on images, not just text
- **Reasoning transparency** — see exactly why each post was filtered
- **Theme-aware UI** — adapts to light, dim, and dark modes automatically
- **Multi-platform filters** — keep separate filter lists for X, Threads, and LinkedIn

## Supported Models

| Provider | Models                                     | Requires |
|----------|--------------------------------------------|----------|
| **Local (WebGPU)** | Gemma 4 E4B (Instruct)                     | WebGPU-capable browser |
| **OpenAI** | GPT-5 Nano, gpt-oss-20b                    | API key |
| **Google Gemini** | 2.5 Flash Lite, 2.5 Flash, 3 Flash Preview | API key |
| **Anthropic** | Claude Haiku 4.5 | API key |
| **OpenRouter** | Nemotron Nano 12B VL (free), Ministral 3B | Account |

Local models are downloaded once and cached in the browser's Cache Storage.

## Quick Start

### Chrome / Edge / Brave

```bash
cd web
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `web/` folder
4. Navigate to x.com, threads.com, or LinkedIn's home feed
5. Click "Settings" in the Sieve element and add your preferred provider API key (or enable local models) and select your preferred model from the dropdown.

## How It Works

1. A MutationObserver watches supported feeds for new posts
2. A platform adapter extracts post text, images, and metadata from X, Threads, or LinkedIn
3. Posts are queued and sent to the selected AI model for classification against your filter topics
4. The model returns a category match and reasoning for each post
5. Matching posts are hidden with a fade-out animation and added to your filtered posts list
6. Click **View filtered** to review hidden posts and see why each was filtered

Results are cached so re-encountering a post doesn't require another inference call.
