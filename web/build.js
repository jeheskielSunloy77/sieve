import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateManifest } from './generate-manifests.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const env = process.argv.includes('--dev') ? 'dev' : 'prod';
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : 'chrome';

const ENV_KEYS = [
  'SIEVE_ENV',
  'POSTPATROL_ENV',
  'FREE_MODELS',
];

function loadEnvFile(envName) {
  const baseEnvPath = path.join(__dirname, '.env');
  const envPath = path.join(__dirname, `.env.${envName}`);
  const result = { SIEVE_ENV: envName, POSTPATROL_ENV: envName };

  function parseEnvFile(filePath) {
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        result[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
      }
      return true;
    }
    return false;
  }

  // Read from .env if it exists, then override with .env.<envName>
  const foundBase = parseEnvFile(baseEnvPath);
  const foundEnv = parseEnvFile(envPath);

  if (!foundBase && !foundEnv) {
    console.warn(`Warning: neither .env nor ${envPath} found. Copy .env.example to .env.${envName} and fill in your values.`);
  }

  // Allow process.env overrides (for CI or Docker)
  for (const key of ENV_KEYS) {
    if (process.env[key]) result[key] = process.env[key];
    else if (!(key in result)) result[key] = '';
  }

  return result;
}

const config = loadEnvFile(env);

// Build esbuild define map — replaces process.env.X with literal strings
const define = {
  'process.env.NODE_ENV': '"production"',
  // Baked into the bundles so src/shared/platforms.ts can filter PLATFORMS
  // to the platforms that ship on this build target (keeps the popup, the
  // pipeline, and storage keys in lockstep with the generated manifest).
  'process.env.SIEVE_TARGET': JSON.stringify(target),
  'process.env.POSTPATROL_TARGET': JSON.stringify(target),
};
for (const [key, value] of Object.entries(config)) {
  define[`process.env.${key}`] = JSON.stringify(value);
}

const iosStubs = {
  '@litert-lm/core': path.join(__dirname, 'litertlm-stub.js'),
  '@huggingface/transformers': path.join(__dirname, 'transformers-stub.js'),
};

const adapters = [
  { name: 'TwitterAdapter', path: path.join(__dirname, 'adapters/twitter/TwitterAdapter.ts') },
  { name: 'YouTubeAdapter', path: path.join(__dirname, 'adapters/youtube/YouTubeAdapter.ts') },
  { name: 'LinkedInAdapter', path: path.join(__dirname, 'adapters/linkedin/LinkedInAdapter.ts') },
  { name: 'ThreadsAdapter', path: path.join(__dirname, 'adapters/threads/ThreadsAdapter.ts') },
].filter((a) => fs.existsSync(a.path));

// Copy LiteRT-LM's wasm loader + binaries into dist/litertlm-wasm/ so the
// offscreen document can resolve them via chrome.runtime.getURL(...).
function copyLitertlmAssets() {
  const srcDir = path.join(__dirname, 'node_modules/@litert-lm/core/wasm');
  const dstDir = path.join(__dirname, 'dist/litertlm-wasm');
  if (!fs.existsSync(srcDir)) {
    console.warn('@litert-lm/core wasm dir not found — skipping copy');
    return;
  }
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
  }
  console.log('Copied LiteRT-LM wasm assets into dist/litertlm-wasm/');
}

// Copy ONNX Runtime Web wasm binaries into dist/ort-wasm/
function copyOrtAssets() {
  const srcDir = path.join(__dirname, 'node_modules/onnxruntime-web/dist');
  const dstDir = path.join(__dirname, 'dist/ort-wasm');
  if (!fs.existsSync(srcDir)) {
    console.warn('onnxruntime-web dist dir not found — skipping copy');
    return;
  }
  fs.mkdirSync(dstDir, { recursive: true });
  const neededFiles = [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm.wasm',
    'ort-wasm.min.js',
    'ort.webgpu.bundle.min.mjs',
  ];
  for (const name of neededFiles) {
    const srcFile = path.join(srcDir, name);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(dstDir, name));
    }
  }
  console.log('Copied ONNX Runtime Web assets into dist/ort-wasm/');
}

// Copy pre-bundled local models (e.g. all-MiniLM-L6-v2) into dist/models/
function copyBundledModels() {
  const srcDir = path.join(__dirname, 'models');
  const dstDir = path.join(__dirname, 'dist/models');
  if (!fs.existsSync(srcDir)) return;
  fs.cpSync(srcDir, dstDir, { recursive: true });
  console.log('Copied bundled model assets into dist/models/');
}

async function build() {
  console.log(`Building Sieve (env: ${env}, target: ${target})`);

  // 0. Regenerate manifest.json from manifest.base.json + manifest.<target>.json.
  generateManifest(target);

  copyLitertlmAssets();
  copyOrtAssets();
  copyBundledModels();

  // 1. Background: bundles the LiteRT-LM SDK directly so the SW-side proxy can
  //    ship its message protocol without a second chunk. The actual Engine
  //    runtime only executes in the offscreen document (bundle 2), but
  //    importing the module from the SW is safe — nothing wasm-loads until
  //    you call Engine.create().
  const bgCtx = await esbuild.context({
    entryPoints: [path.join(__dirname, 'background.js')],
    outdir: path.join(__dirname, 'dist'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    external: ['url'],
    define,
  });

  // 2. Offscreen document bundle. Hosts LiteRT-LM's Engine; the SW opens
  //    this page on demand because the LiteRT-LM wasm loader uses script-tag
  //    injection (via @litertjs/wasm-utils), which is not available in MV3
  //    ESM service workers.
  const offscreenCtx = await esbuild.context({
    entryPoints: [path.join(__dirname, 'offscreen.js')],
    outdir: path.join(__dirname, 'dist'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    external: ['url'],
    define,
  });

  // 3. Popup & content: fully self-contained (no external imports).
  const otherCtx = await esbuild.context({
    entryPoints: [
      path.join(__dirname, 'popup.js'),
      path.join(__dirname, 'content.js')
    ],
    bundle: true,
    outdir: path.join(__dirname, 'dist'),
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    external: ['url'],
    define,
  });

  // 4. iOS app builds (IIFE, LiteRT-LM stubbed). Injected into a WKWebView
  // that has no WebGPU — iOS uses a native CoreML bridge instead, so stubbing
  // keeps these bundles small.
  const stubbedIifeEntries = {
    'background-app': 'background.js',
    'popup-app': 'popup.js',
  };
  const stubbedIifeCtxs = await Promise.all(
    Object.entries(stubbedIifeEntries).map(([name, src]) =>
      esbuild.context({
        entryPoints: { [name]: path.join(__dirname, src) },
        bundle: true,
        outdir: path.join(__dirname, 'dist'),
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify: false,
        sourcemap: false,
        external: ['url'],
        define,
        alias: { ...iosStubs },
      })
    )
  );

  const contexts = [bgCtx, offscreenCtx, otherCtx, ...stubbedIifeCtxs];

  // Type-strip each platform adapter (unbundled, standalone content script).
  // Each adapter ships as its own dist/<Name>.js and is loaded by the manifest
  // entry for that site, so adding a new adapter is just a new entry here.
  for (const adapter of adapters) {
    const adapterCtx = await esbuild.context({
      entryPoints: [adapter.path],
      outfile: path.join(__dirname, `dist/${adapter.name}.js`),
      bundle: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
    });
    contexts.push(adapterCtx);
  }

  if (isWatch) {
    await Promise.all(contexts.map(c => c.watch()));
    console.log(`Watching for changes... (env: ${env})`);
  } else {
    await Promise.all(contexts.map(c => c.rebuild()));
    await Promise.all(contexts.map(c => c.dispose()));

    const adapterOutputs = adapters.map((a) => `dist/${a.name}.js`).join(', ');
    console.log(`Build complete (env: ${env}): dist/background.js, dist/offscreen.js, dist/popup.js, dist/content.js, dist/background-app.js, dist/popup-app.js` +
      (adapterOutputs ? `, ${adapterOutputs}` : ''));
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
