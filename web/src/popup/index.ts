// Sieve - Popup Script

import type { ModelDef, LocalModelDef, LocalModelStatus, StorageSchema } from '../types';
import { PREDEFINED_MODELS, DEFAULT_MODEL, FREE_MODELS, getFreeModel } from '../shared/models';
import { fetchProviderModels, isExcludedModel } from '../shared/model-fetcher';
import { escapeHtml, parseHTML } from '../shared/utils';
import { getStorage, setStorage, removeStorage, clampThreshold, clampImageThreshold, clampReplyThreshold, aiIntentAutoActive } from '../shared/storage';
import { asyncHandler } from '../shared/async';
import { encodeFilterPackCode, buildFilterPackShareUrl } from '../shared/share-encoding';
import { initLogoAnimation } from '../shared/logo';

// Storage key for predefined model API kwargs overrides
// Format: { "api:modelName": { key: value, ... }, ... }
let predefinedModelKwargs: Record<string, Record<string, unknown>> = {};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  free: 'Sieve Cloud (Free)',
  local: 'On-Device',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini'
};

const PROVIDER_LOGOS: Record<string, string> = {
  free: '<svg class="provider-logo provider-logo-free" viewBox="0 0 512 512" width="14" height="14" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M 98 56 H 260 C 390 56 456 168 456 235 V 246 A 12 12 0 0 1 444 258 H 418 C 350 256 328 190 312 156 C 298 200 240 262 190 277 C 230 300 290 330 288 375 V 442 A 14 14 0 0 1 274 456 H 232 C 182 456 56 410 56 248 V 98 A 42 42 0 0 1 98 56 Z"/><path fill-rule="evenodd" d="M 336 375 C 340 335 350 308 420 302 H 436 A 20 20 0 0 1 456 322 V 422 A 34 34 0 0 1 422 456 H 350 A 14 14 0 0 1 336 442 Z"/></svg>',
  local: '<svg class="provider-logo provider-logo-local" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
  iosLocal: '<svg class="provider-logo provider-logo-local" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
  openrouter: '<svg class="provider-logo provider-logo-openrouter" viewBox="0 0 24 24" width="14" height="14" fill="#6366F1" aria-hidden="true"><path d="M18.654 3.87a5.087 5.087 0 1 1 0 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 0 1 0-16.958h10.175zM8.479 7.26a5.087 5.087 0 1 0 0 10.176 5.087 5.087 0 0 0 0-10.175z"/></svg>',
  openai: '<svg class="provider-logo provider-logo-openai" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>',
  anthropic: '<svg class="provider-logo provider-logo-anthropic" viewBox="0 0 24 24" width="14" height="14" fill="#D97757" aria-hidden="true"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>',
  gemini: '<svg class="provider-logo provider-logo-gemini" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="url(#ppGeminiGrad)" d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z"/></svg>'
};

const DEFAULT_MODEL_SEARCH_ICON = '<svg class="model-dropdown-default-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

const BTN_SPINNER_ICON = '<svg class="openrouter-icon animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>';

const OPENAI_BTN_ICON = '<svg class="openrouter-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>';

const ANTHROPIC_BTN_ICON = '<svg class="openrouter-icon" viewBox="0 0 24 24" width="14" height="14" fill="#D97757" aria-hidden="true"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>';

const GEMINI_BTN_ICON = '<svg class="openrouter-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="url(#ppGeminiGrad)" d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z"/></svg>';

const ALL_PROVIDER_STORAGE_KEYS = [
  'openrouterApiKey',
  'openaiApiKey',
  'openaiApiBase',
  'geminiApiKey',
  'geminiApiBase',
  'anthropicApiKey',
  'anthropicApiBase',
  'customModels',
  'selectedModel',
  'authErrorApis'
] as const;

function setButtonVerifying(btn: HTMLButtonElement, verifying: boolean, defaultIconSvg: string, defaultText: string = 'Enable') {
  if (verifying) {
    btn.disabled = true;
    btn.classList.add('verifying');
    btn.replaceChildren(parseHTML(`${BTN_SPINNER_ICON}<span>Verifying...</span>`));
  } else {
    btn.classList.remove('verifying');
    btn.replaceChildren(parseHTML(`${defaultIconSvg}<span>${defaultText}</span>`));
  }
}

// Track local model statuses (per-model)
let localModelStatuses: Record<string, LocalModelStatus> = {};
let webgpuSupported = true;
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// In-app mode detection
const isInAppMode = typeof chrome !== 'undefined' && chrome._polyfilled;

// Model key the "On-Device (E2B)" headline radio writes. In the iOS app the
// native bridge runs the on-device model (iosLocal:, entries injected from
// the Swift registry — see shared/models.ts), everywhere else it's the
// WebGPU litert-lm web build (local:).
const IOS_LOCAL_MODEL = PREDEFINED_MODELS.iosLocal[0];
const hasChromeBuiltinAi = typeof window !== 'undefined' && !!(window as unknown as { ai?: { languageModel?: unknown } }).ai?.languageModel;
const defaultDesktopLocalModel = hasChromeBuiltinAi ? 'local:gemini-nano' : 'local:qwen-2.5-0.5b-instruct';
const LOCAL_RADIO_MODEL_KEY = isInAppMode && IOS_LOCAL_MODEL
  ? `iosLocal:${IOS_LOCAL_MODEL.name}`
  : defaultDesktopLocalModel;

// User-friendly error message mapping for local-model errors
const LOCAL_ERROR_MESSAGES: Record<string, { display: string; hint: string }> = {
  'device lost': {
    display: 'GPU device was lost',
    hint: 'Try closing other tabs or restarting your browser.'
  },
  'device destroyed': {
    display: 'GPU device error',
    hint: 'Try closing other GPU-intensive tabs or restart browser.'
  },
  'out of memory': {
    display: 'Not enough GPU memory',
    hint: 'Close other GPU-intensive applications or use a smaller model.'
  },
  'oom': {
    display: 'GPU memory exhausted',
    hint: 'Close other tabs or use a smaller model.'
  },
  'gpu memory': {
    display: 'GPU memory issue',
    hint: 'Try a smaller model or close other GPU-intensive tabs.'
  },
  'webgpu not': {
    display: 'WebGPU not supported',
    hint: 'Your browser or device does not support on-device AI models.'
  },
  'network': {
    display: 'Network error',
    hint: 'Check your internet connection and try again.'
  },
  'download failed': {
    display: 'Download failed',
    hint: 'Check your internet connection and try again.'
  },
  'fetch': {
    display: 'Download failed',
    hint: 'Check your internet connection and try again.'
  },
  'timeout': {
    display: 'Model response timeout',
    hint: 'The model took too long to respond. Try again or use a smaller model.'
  },
  'inference timeout': {
    display: 'Inference timeout',
    hint: 'The model was too slow. Try again or switch to a smaller model.'
  },
  'chrome built-in': {
    display: 'Chrome Built-in AI not enabled',
    hint: 'Requires Google Chrome 128+ with Prompt API flags enabled. On Thorium or other browsers, use Qwen 2.5 instead.'
  },
  'gemini nano': {
    display: 'Gemini Nano not enabled',
    hint: 'Requires Google Chrome with Prompt API enabled in chrome://flags. Switch to Qwen 2.5 instead.'
  },
  'not available on this device': {
    display: 'Built-in AI not enabled',
    hint: 'Requires Google Chrome with Prompt API enabled in chrome://flags. Switch to Qwen 2.5 instead.'
  }
};

// Get user-friendly error message for local-model errors
function getUserFriendlyError(errorMessage: string | undefined): { display: string; hint: string } {
  if (!errorMessage) return { display: 'Unknown error', hint: 'Try again or switch models.' };

  const lowerError = errorMessage.toLowerCase();
  for (const [pattern, info] of Object.entries(LOCAL_ERROR_MESSAGES)) {
    if (lowerError.includes(pattern)) {
      return info;
    }
  }
  // If already user-friendly (from background), use as-is
  if (errorMessage.includes('Try ') || errorMessage.includes('Close ') || errorMessage.includes('Check ')) {
    return { display: errorMessage, hint: '' };
  }
  return { display: errorMessage, hint: 'Try again or switch to a different model.' };
}

document.addEventListener('DOMContentLoaded', () => { init().catch(err => console.error('[Popup] Init failed:', err)); });

export async function init() {
  console.log('[Popup] init() called');
  try {
  const isModal = window.self !== window.top;

  // Detect if we're in an iframe (modal mode)
  if (isModal) {
    document.body.classList.add('modal-mode');

    // Set up close buttons to message parent
    for (const btn of document.querySelectorAll('.modal-close-btn')) {
      btn.addEventListener('click', () => {
        window.parent.postMessage({ type: 'closeSettingsModal' }, '*');
      });
    }

    // Listen for theme message from parent
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: string; theme?: string } | null;
      if (data && data.type === 'setTheme') {
        const theme = data.theme;
        document.body.classList.remove('light-mode', 'dim-mode', 'dark-mode');
        document.body.classList.add(`${theme}-mode`);
      }
    });

    // Report content height changes to parent so iframe can resize dynamically
    const sendSize = () => {
      const height = document.body.scrollHeight + 2;
      window.parent.postMessage({ type: 'settingsResize', height }, '*');
    };
    const resizeObserver = new ResizeObserver(sendSize);
    resizeObserver.observe(document.body);
    sendSize();
  }



  const logoSvg = document.querySelector<SVGSVGElement>('.sieve-logo-prefix svg.logo');
  if (logoSvg) {
    initLogoAnimation(logoSvg);
  }

  console.log('[Popup] About to loadSettings');
  await loadSettings();
  console.log('[Popup] loadSettings done, setupEventListeners');
  setupEventListeners();
  console.log('[Popup] setupEventListeners done');

  // In-app mode: skip OpenRouter status and rate limit (DOM elements may not exist, messages may hang)
  if (!isInAppMode) {
    await updateOpenRouterStatus();
    await updateRateLimitAlert();
  } else {
    console.log('[Popup] Skipping updateOpenRouterStatus and updateRateLimitAlert in in-app mode');
  }

  // Initialize local model UI
  console.log('[Popup] About to updateLocalModelStatus');
  await updateLocalModelStatus();
  console.log('[Popup] About to setupLocalModelListeners');
  setupLocalModelListeners();

  setupStorageListener();

  // Deep link from the in-feed trial notice ("Download local model"): select
  // the Local radio so its download section is immediately visible. click()
  // runs the exact same selectModel flow as a user tap; a no-op if already
  // selected (checked radios don't re-fire change).
  if (window.location.hash === '#local') {
    void selectModel(LOCAL_RADIO_MODEL_KEY);
  } else if (window.location.hash === '#select-model') {
    focusModelSelector(!dropdownState.selectedModel);
  }

  console.log('[Popup] init() completed successfully');
  } catch (e) {
    console.error('[Popup] init() ERROR:', e, (e as Error).stack);
  }
}

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.authErrorApis) {
      loadSettings().catch(err => console.error('[Popup] loadSettings failed:', err));
    }
    if (areaName === 'local' && changes.localModelStatuses) {
      localModelStatuses = (changes.localModelStatuses.newValue as Record<string, LocalModelStatus>) || {};
      updateLocalModelSectionUI();
      refreshModelDropdownWithLocal().catch(err => console.error('[Popup] refreshModelDropdownWithLocal failed:', err));
    }
    // Parked On-Device choice set/cleared (possibly by the background flipping
    // selectedModel when the download finished) — re-sync radios + panel.
    if (areaName === 'local' && changes.pendingLocalModelSelection) {
      pendingLocalSelection = (changes.pendingLocalModelSelection.newValue as string) || null;
      updateModelRadioUI();
      updateLocalModelSectionVisibility();
      updateLocalModelSectionUI();
    }
    // The inferred AI-removal intent changed — re-sync the passive
    // AI-detection indicator from storage.
    if (areaName === 'local' && AI_DETECTION_UI_KEYS.some(k => changes[k])) {
      getStorage([...AI_DETECTION_UI_KEYS])
        .then(applyAiDetectionUI)
        .catch(err => console.error('[Popup] applyAiDetectionUI failed:', err));
    }
    if (areaName === 'local' && changes.filterReplies) {
      const checked = changes.filterReplies.newValue !== false;
      const el = document.getElementById('enableFilterReplies') as HTMLInputElement | null;
      if (el && el.checked !== checked) el.checked = checked;
    }
    if (areaName === 'local' && changes.aiTextDetectionThreshold) {
      const v = clampThreshold(changes.aiTextDetectionThreshold.newValue);
      const thresholdEl = document.getElementById('aiTextThreshold') as HTMLInputElement | null;
      if (thresholdEl) thresholdEl.value = String(v);
      const valueEl = document.getElementById('aiTextThresholdValue');
      if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
    }
    if (areaName === 'local' && changes.aiTextReplyDetectionThreshold) {
      const v = clampReplyThreshold(changes.aiTextReplyDetectionThreshold.newValue);
      const thresholdEl = document.getElementById('aiTextReplyThreshold') as HTMLInputElement | null;
      if (thresholdEl) thresholdEl.value = String(v);
      const valueEl = document.getElementById('aiTextReplyThresholdValue');
      if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
    }
    // Another surface (a second popup window, the iOS native sheet) changed
    // the model — re-render so the radios and dropdown don't go stale. Skip
    // when the value already matches: that's the echo of our own write.
    if (areaName === 'local' && changes.selectedModel) {
      const v = (changes.selectedModel.newValue as string) || DEFAULT_MODEL;
      if (v !== dropdownState.selectedModel) {
        refreshModelDropdownWithLocal().catch(err => console.error('[Popup] refreshModelDropdownWithLocal failed:', err));
      }
    }
    if (areaName === 'local' && changes.cachedDynamicModels) {
      const rawNew = (changes.cachedDynamicModels.newValue as Record<string, ModelDef[]>) || {};
      const sanitized: Record<string, ModelDef[]> = {};
      for (const [provider, list] of Object.entries(rawNew)) {
        sanitized[provider] = Array.isArray(list) ? list.filter(m => !isExcludedModel(provider, m.name)) : [];
      }
      dropdownState.dynamicModels = sanitized;
      renderModelDropdown(dropdownState.customModels, dropdownState.selectedModel);
    }
    if (areaName === 'local' && changes.aiImageDetectionThreshold) {
      const v = clampImageThreshold(changes.aiImageDetectionThreshold.newValue);
      const thresholdEl = document.getElementById('aiImageThreshold') as HTMLInputElement | null;
      if (thresholdEl) thresholdEl.value = String(v);
      const valueEl = document.getElementById('aiImageThresholdValue');
      if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
    }
  });
}

async function loadSettings() {
  const data = await getStorage([
    'enabled',
    'selectedModel',
    'customModels',
    'cachedDynamicModels',
    'openrouterApiKey',
    'openaiApiKey',
    'openaiApiBase',
    'geminiApiKey',
    'geminiApiBase',
    'anthropicApiKey',
    'anthropicApiBase',
    'predefinedModelKwargs',
    'authErrorApis',
    'aiTextDetectionThreshold',
    'aiTextReplyDetectionThreshold',
    'aiImageDetectionThreshold',
    'aiFilterIntent',
    'pendingLocalModelSelection',
    'filterReplies',
  ]);

  // Dynamic models from cache
  const rawCached = data.cachedDynamicModels || {};
  const sanitizedCached: Record<string, ModelDef[]> = {};
  for (const [provider, list] of Object.entries(rawCached)) {
    sanitizedCached[provider] = Array.isArray(list) ? list.filter(m => !isExcludedModel(provider, m.name)) : [];
  }
  dropdownState.dynamicModels = sanitizedCached;

  // Load predefined model kwargs overrides
  predefinedModelKwargs = data.predefinedModelKwargs || {};

  // Parked "On-Device, once downloaded" choice (cleared by the background when
  // the download lands, or by any explicit model selection).
  pendingLocalSelection = data.pendingLocalModelSelection || null;

  // API keys and Base URLs
  (document.getElementById('openaiApiKey') as HTMLInputElement).value = data.openaiApiKey || '';
  (document.getElementById('openaiApiBase') as HTMLInputElement).value = data.openaiApiBase || '';
  (document.getElementById('anthropicApiKey') as HTMLInputElement).value = data.anthropicApiKey || '';
  (document.getElementById('anthropicApiBase') as HTMLInputElement).value = data.anthropicApiBase || '';
  (document.getElementById('geminiApiKey') as HTMLInputElement).value = data.geminiApiKey || '';
  (document.getElementById('geminiApiBase') as HTMLInputElement).value = data.geminiApiBase || '';
  updateOpenAIEnabledUI(!!data.openaiApiKey);
  updateAnthropicEnabledUI(!!data.anthropicApiKey);
  updateGeminiEnabledUI(!!data.geminiApiKey);

  // "Filter replies in conversations" toggle (defaults to true so existing
  // installs keep filtering replies). The content script reads the same
  // key and skips reply evaluation on permalink pages when this is off.
  const filterRepliesEl = document.getElementById('enableFilterReplies') as HTMLInputElement | null;
  if (filterRepliesEl) filterRepliesEl.checked = data.filterReplies !== false;

  // Passive AI-detection indicator + threshold sliders. On/off state is
  // driven entirely by the inferred AI-removal intent (natural language) —
  // there is no manual toggle.
  applyAiDetectionUI(data);

  const thresholdEl = document.getElementById('aiTextThreshold') as HTMLInputElement | null;
  if (thresholdEl) {
    const v = clampThreshold(data.aiTextDetectionThreshold);
    thresholdEl.value = String(v);
    const valueEl = document.getElementById('aiTextThresholdValue');
    if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
  }
  const replyThresholdEl = document.getElementById('aiTextReplyThreshold') as HTMLInputElement | null;
  if (replyThresholdEl) {
    const v = clampReplyThreshold(data.aiTextReplyDetectionThreshold);
    replyThresholdEl.value = String(v);
    const valueEl = document.getElementById('aiTextReplyThresholdValue');
    if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
  }

  const imageThresholdEl = document.getElementById('aiImageThreshold') as HTMLInputElement | null;
  if (imageThresholdEl) {
    const v = clampImageThreshold(data.aiImageDetectionThreshold);
    imageThresholdEl.value = String(v);
    const valueEl = document.getElementById('aiImageThresholdValue');
    if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
  }

  // Update API provider states
  updateApiProviderStates(data);

  // Model selection
  let selected = data.selectedModel || DEFAULT_MODEL;
  const [selApi, ...selParts] = selected.split(':');
  if (selApi === 'free') {
    const freeId = selParts.join(':');
    if (!getFreeModel(freeId)) {
      selected = DEFAULT_MODEL;
      await setStorage({ selectedModel: DEFAULT_MODEL });
    }
  } else if (selApi && isExcludedModel(selApi, selParts.join(':'))) {
    selected = DEFAULT_MODEL;
    await setStorage({ selectedModel: DEFAULT_MODEL });
  }
  if (!data.selectedModel && DEFAULT_MODEL) {
    await setStorage({ selectedModel: DEFAULT_MODEL });
  }
  renderModelDropdown(data.customModels || [], selected);

  // Background refresh of available cloud models
  void refreshDynamicModels(data);

  // Update local model section visibility
  updateLocalModelSectionVisibility();
}

// Storage keys that feed the AI-detection status UI. Kept in one place so the
// hydration path and the storage-change listener stay in sync.
const AI_DETECTION_UI_KEYS = ['aiFilterIntent'] as const;

// Sync the passive AI-detection indicator (and the threshold sliders'
// enabled state) to the inferred AI-removal intent (see
// background/ai-intent.ts). Purely informational — AI detection has no
// manual toggle; it engages and disengages through the user's
// natural-language filter phrases. The popup isn't tied to a platform, so
// this shows the cross-platform union: "On" means detection is engaged on
// at least one platform (per-platform state lives in each page's sparkle).
function applyAiDetectionUI(data: Partial<StorageSchema>) {
  const section = document.getElementById('aiDetectionSection');
  if (!isInAppMode) {
    if (section) section.style.display = 'none';
    return;
  }

  const on = aiIntentAutoActive(data);
  const indicator = document.getElementById('aiDetectionIndicator');
  if (indicator) indicator.classList.toggle('on', on);
  const stateEl = document.getElementById('aiDetectionIndicatorState');
  if (stateEl) stateEl.textContent = on ? 'On' : 'Off';

  setThresholdBlockEnabled(on);
  setImageThresholdBlockEnabled(on);
}

// Toggle the AI threshold block's disabled visual + interaction state.
// Driven from both the load path and the toggle's change handler so the
// slider always reflects whether the feature is on.
function setThresholdBlockEnabled(enabled: boolean) {
  const block = document.getElementById('aiTextThresholdBlock');
  if (block) block.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  const replyBlock = document.getElementById('aiTextReplyThresholdBlock');
  if (replyBlock) replyBlock.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function setImageThresholdBlockEnabled(enabled: boolean) {
  const block = document.getElementById('aiImageThresholdBlock');
  if (block) block.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function updateOpenAIEnabledUI(isEnabled: boolean) {
  const disableBtn = document.getElementById('openaiDisableBtn') as HTMLButtonElement | null;
  const enableBtn = document.getElementById('openaiEnableBtn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('openaiError');
  const keyInput = document.getElementById('openaiApiKey') as HTMLInputElement | null;

  if (errorEl) errorEl.style.display = 'none';

  if (disableBtn) {
    disableBtn.style.display = isEnabled ? 'inline-flex' : 'none';
  }

  if (enableBtn) {
    const label = isEnabled ? 'Update' : 'Enable';
    setButtonVerifying(enableBtn, false, OPENAI_BTN_ICON, label);
    enableBtn.disabled = !keyInput?.value.trim();
  }
}

function updateAnthropicEnabledUI(isEnabled: boolean) {
  const disableBtn = document.getElementById('anthropicDisableBtn') as HTMLButtonElement | null;
  const enableBtn = document.getElementById('anthropicEnableBtn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('anthropicError');
  const keyInput = document.getElementById('anthropicApiKey') as HTMLInputElement | null;

  if (errorEl) errorEl.style.display = 'none';

  if (disableBtn) {
    disableBtn.style.display = isEnabled ? 'inline-flex' : 'none';
  }

  if (enableBtn) {
    const label = isEnabled ? 'Update' : 'Enable';
    setButtonVerifying(enableBtn, false, ANTHROPIC_BTN_ICON, label);
    enableBtn.disabled = !keyInput?.value.trim();
  }
}

function updateGeminiEnabledUI(isEnabled: boolean) {
  const disableBtn = document.getElementById('geminiDisableBtn') as HTMLButtonElement | null;
  const enableBtn = document.getElementById('geminiEnableBtn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('geminiError');
  const keyInput = document.getElementById('geminiApiKey') as HTMLInputElement | null;

  if (errorEl) errorEl.style.display = 'none';

  if (disableBtn) {
    disableBtn.style.display = isEnabled ? 'inline-flex' : 'none';
  }

  if (enableBtn) {
    const label = isEnabled ? 'Update' : 'Enable';
    setButtonVerifying(enableBtn, false, GEMINI_BTN_ICON, label);
    enableBtn.disabled = !keyInput?.value.trim();
  }
}

function updateApiProviderStates(data: Partial<StorageSchema>) {
  // Update dropdownState with which APIs are authenticated
  // Note: 'local' and 'iosLocal' are always available (no auth required) —
  // without the iosLocal entry the reset guard below would silently revert
  // the iOS radio's on-device selection to the default on every popup open.
  dropdownState.authenticatedApis = {
    openrouter: !!data.openrouterApiKey,
    openai: !!data.openaiApiKey,
    gemini: !!data.geminiApiKey,
    anthropic: !!data.anthropicApiKey,
    local: true,
    iosLocal: true,
    free: true
  };

  // Get providers with auth errors (object mapping provider name -> boolean)
  const authErrorApis = data.authErrorApis || {};

  // Update OpenRouter badge
  const openrouterBadge = document.getElementById('openrouterStatusBadge')!;
  openrouterBadge.classList.remove('connected', 'auth-error');
  if (authErrorApis.openrouter && data.openrouterApiKey) {
    openrouterBadge.textContent = 'Auth error';
    openrouterBadge.classList.add('auth-error');
  } else if (data.openrouterApiKey) {
    openrouterBadge.textContent = 'Enabled';
    openrouterBadge.classList.add('connected');
  } else {
    openrouterBadge.textContent = 'Not enabled';
  }

  // Update OpenAI badge
  const openaiBadge = document.getElementById('openaiStatusBadge')!;
  openaiBadge.classList.remove('connected', 'auth-error');
  if (authErrorApis.openai && data.openaiApiKey) {
    openaiBadge.textContent = 'Auth error';
    openaiBadge.classList.add('auth-error');
  } else if (data.openaiApiKey) {
    openaiBadge.textContent = 'Enabled';
    openaiBadge.classList.add('connected');
  } else {
    openaiBadge.textContent = 'Not enabled';
  }

  // Update Gemini badge
  const geminiBadge = document.getElementById('geminiStatusBadge')!;
  geminiBadge.classList.remove('connected', 'auth-error');
  if (authErrorApis.gemini && data.geminiApiKey) {
    geminiBadge.textContent = 'Auth error';
    geminiBadge.classList.add('auth-error');
  } else if (data.geminiApiKey) {
    geminiBadge.textContent = 'Enabled';
    geminiBadge.classList.add('connected');
  } else {
    geminiBadge.textContent = 'Not enabled';
  }

  // Update Anthropic badge
  const anthropicBadge = document.getElementById('anthropicStatusBadge')!;
  anthropicBadge.classList.remove('connected', 'auth-error');
  if (authErrorApis.anthropic && data.anthropicApiKey) {
    anthropicBadge.textContent = 'Auth error';
    anthropicBadge.classList.add('auth-error');
  } else if (data.anthropicApiKey) {
    anthropicBadge.textContent = 'Enabled';
    anthropicBadge.classList.add('connected');
  } else {
    anthropicBadge.textContent = 'Not enabled';
  }

  // Check if selected model's provider is still authenticated
  if (dropdownState.selectedModel && !dropdownState.selectedModel.startsWith('local:') && !dropdownState.selectedModel.startsWith('iosLocal:') && !dropdownState.selectedModel.startsWith('free:')) {
    const [api] = dropdownState.selectedModel.split(':');
    if (!dropdownState.authenticatedApis[api]) {
      // Provider no longer authenticated, reset to default
      selectModel(DEFAULT_MODEL).catch(err => console.error('[Popup] selectModel failed:', err));
    }
  }
}

function setupEventListeners() {

  // Headline model radios (On-Device vs API Model)
  setupModelRadios();

  // Model dropdown
  setupModelDropdown();

  // API provider collapsible headers
  document.querySelectorAll('.api-provider-header').forEach(header => {
    header.addEventListener('click', () => {
      const provider = header.closest('.api-provider');
      provider?.classList.toggle('expanded');
    });
  });

  // OpenAI API key & Base URL validation and enable/disable
  const openaiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
  const openaiBaseInput = document.getElementById('openaiApiBase') as HTMLInputElement;
  const openaiEnableBtn = document.getElementById('openaiEnableBtn') as HTMLButtonElement;
  const openaiErrorEl = document.getElementById('openaiError')!;

  openaiKeyInput.addEventListener('input', () => {
    openaiEnableBtn.disabled = !openaiKeyInput.value.trim();
    openaiErrorEl.style.display = 'none';
  });

  openaiBaseInput.addEventListener('change', () => { (async () => {
    const base = openaiBaseInput.value.trim();
    await setStorage({ openaiApiBase: base });
  })().catch(err => console.error('[Popup] openaiApiBase change failed:', err)); });

  openaiEnableBtn.addEventListener('click', () => { (async () => {
    const key = openaiKeyInput.value.trim();
    if (!key) return;

    const base = (openaiBaseInput.value.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
    openaiErrorEl.style.display = 'none';
    setButtonVerifying(openaiEnableBtn, true, OPENAI_BTN_ICON);

    try {
      const response = await fetch(`${base}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`
        }
      });

      if (!response.ok) {
        const body = await response.text();
        let msg = 'Invalid API key';
        if (response.status === 401 || response.status === 403) {
          msg = 'Invalid API key. Check that your key is correct.';
        } else if (response.status === 429) {
          msg = 'Rate limited. Key looks valid — try again shortly.';
        } else {
          try {
            const parsed = JSON.parse(body) as { error?: { message?: string } };
            msg = parsed.error?.message || `API error (${response.status})`;
          } catch {
            msg = `API error (${response.status})`;
          }
        }

        if (response.status === 429) {
          const authErrors429 = (await getStorage(['authErrorApis'])).authErrorApis || {};
          if (authErrors429.openai) {
            delete authErrors429.openai;
            await setStorage({ authErrorApis: authErrors429 });
          }
          await setStorage({ openaiApiKey: key, openaiApiBase: openaiBaseInput.value.trim() });
          const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
          updateApiProviderStates(data);
          updateOpenAIEnabledUI(true);
          renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
          void fetchAndApplyModels('openai', key, data.openaiApiBase);
        } else {
          openaiErrorEl.textContent = msg;
          openaiErrorEl.style.display = 'block';
          openaiEnableBtn.disabled = false;
        }
      } else {
        const authErrorsOk = (await getStorage(['authErrorApis'])).authErrorApis || {};
        if (authErrorsOk.openai) {
          delete authErrorsOk.openai;
          await setStorage({ authErrorApis: authErrorsOk });
        }
        await setStorage({ openaiApiKey: key, openaiApiBase: openaiBaseInput.value.trim() });
        const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
        updateApiProviderStates(data);
        updateOpenAIEnabledUI(true);
        renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
        void fetchAndApplyModels('openai', key, data.openaiApiBase);
      }
    } catch (err) {
      console.error('[OpenAI] Network error during verification:', err);
      openaiErrorEl.textContent = 'Network error. Could not reach OpenAI API.';
      openaiErrorEl.style.display = 'block';
      openaiEnableBtn.disabled = false;
    } finally {
      const data = await getStorage(['openaiApiKey']);
      const isEnabled = !!data.openaiApiKey;
      setButtonVerifying(openaiEnableBtn, false, OPENAI_BTN_ICON, isEnabled ? 'Update' : 'Enable');
      openaiEnableBtn.disabled = !openaiKeyInput.value.trim();
    }
  })().catch(err => console.error('[Popup] OpenAI enable failed:', err)); });

  document.getElementById('openaiDisableBtn')!.addEventListener('click', () => { (async () => {
    await removeStorage('openaiApiKey');
    openaiKeyInput.value = '';
    updateOpenAIEnabledUI(false);
    const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
    updateApiProviderStates(data);
    renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
  })().catch(err => console.error('[Popup] OpenAI disable failed:', err)); });

  // Anthropic API key & Base URL validation and enable/disable
  const anthropicKeyInput = document.getElementById('anthropicApiKey') as HTMLInputElement;
  const anthropicBaseInput = document.getElementById('anthropicApiBase') as HTMLInputElement;
  const anthropicEnableBtn = document.getElementById('anthropicEnableBtn') as HTMLButtonElement;
  const anthropicErrorEl = document.getElementById('anthropicError')!;

  anthropicKeyInput.addEventListener('input', () => {
    anthropicEnableBtn.disabled = !anthropicKeyInput.value.trim();
    anthropicErrorEl.style.display = 'none';
  });

  anthropicBaseInput.addEventListener('change', () => { (async () => {
    const base = anthropicBaseInput.value.trim();
    await setStorage({ anthropicApiBase: base });
  })().catch(err => console.error('[Popup] anthropicApiBase change failed:', err)); });

  anthropicEnableBtn.addEventListener('click', () => { (async () => {
    const key = anthropicKeyInput.value.trim();
    if (!key) return;

    const base = (anthropicBaseInput.value.trim() || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    anthropicErrorEl.style.display = 'none';
    setButtonVerifying(anthropicEnableBtn, true, ANTHROPIC_BTN_ICON);

    try {
      const requestBody = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      };
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      const response = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const body = await response.text();
        let msg = 'Invalid API key';
        if (response.status === 401 || response.status === 403) {
          msg = 'Invalid API key. Check that your key is correct.';
        } else if (response.status === 429) {
          msg = 'Rate limited. Key looks valid — try again shortly.';
        } else {
          try {
            const parsed = JSON.parse(body) as { error?: { message?: string } };
            msg = parsed.error?.message || `API error (${response.status})`;
          } catch { msg = `API error (${response.status})`; }
        }

        // 429 means the key is valid, just rate limited — allow enabling
        if (response.status === 429) {
          const authErrors429 = (await getStorage(['authErrorApis'])).authErrorApis || {};
          if (authErrors429.anthropic) {
            delete authErrors429.anthropic;
            await setStorage({ authErrorApis: authErrors429 });
          }
          await setStorage({ anthropicApiKey: key, anthropicApiBase: anthropicBaseInput.value.trim() });
          const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
          updateApiProviderStates(data);
          updateAnthropicEnabledUI(true);
          renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
          void fetchAndApplyModels('anthropic', key, data.anthropicApiBase);
        } else {
          anthropicErrorEl.textContent = msg;
          anthropicErrorEl.style.display = 'block';
          anthropicEnableBtn.disabled = false;
        }
      } else {
        const authErrorsOk = (await getStorage(['authErrorApis'])).authErrorApis || {};
        if (authErrorsOk.anthropic) {
          delete authErrorsOk.anthropic;
          await setStorage({ authErrorApis: authErrorsOk });
        }
        await setStorage({ anthropicApiKey: key, anthropicApiBase: anthropicBaseInput.value.trim() });
        const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
        updateApiProviderStates(data);
        updateAnthropicEnabledUI(true);
        renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
        void fetchAndApplyModels('anthropic', key, data.anthropicApiBase);
      }
    } catch (err) {
      console.error('[Anthropic] Network error during verification:', err);
      anthropicErrorEl.textContent = 'Network error. Could not reach Anthropic API.';
      anthropicErrorEl.style.display = 'block';
      anthropicEnableBtn.disabled = false;
    } finally {
      const data = await getStorage(['anthropicApiKey']);
      const isEnabled = !!data.anthropicApiKey;
      setButtonVerifying(anthropicEnableBtn, false, ANTHROPIC_BTN_ICON, isEnabled ? 'Update' : 'Enable');
      anthropicEnableBtn.disabled = !anthropicKeyInput.value.trim();
    }
  })().catch(err => console.error('[Popup] Anthropic enable failed:', err)); });

  // Anthropic disable button
  document.getElementById('anthropicDisableBtn')!.addEventListener('click', () => { (async () => {
    await removeStorage('anthropicApiKey');
    anthropicKeyInput.value = '';
    updateAnthropicEnabledUI(false);
    const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
    updateApiProviderStates(data);
    renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
  })().catch(err => console.error('[Popup] Anthropic disable failed:', err)); });

  // Gemini API key & Base URL validation and enable/disable
  const geminiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
  const geminiBaseInput = document.getElementById('geminiApiBase') as HTMLInputElement;
  const geminiEnableBtn = document.getElementById('geminiEnableBtn') as HTMLButtonElement;
  const geminiErrorEl = document.getElementById('geminiError')!;

  geminiKeyInput.addEventListener('input', () => {
    geminiEnableBtn.disabled = !geminiKeyInput.value.trim();
    geminiErrorEl.style.display = 'none';
  });

  geminiBaseInput.addEventListener('change', () => { (async () => {
    const base = geminiBaseInput.value.trim();
    await setStorage({ geminiApiBase: base });
  })().catch(err => console.error('[Popup] geminiApiBase change failed:', err)); });

  geminiEnableBtn.addEventListener('click', () => { (async () => {
    const key = geminiKeyInput.value.trim();
    if (!key) return;

    const customBase = geminiBaseInput.value.trim();
    const base = (customBase || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
    geminiErrorEl.style.display = 'none';
    setButtonVerifying(geminiEnableBtn, true, GEMINI_BTN_ICON);

    try {
      let response = await fetch(`${base}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`
        }
      });

      if (!response.ok && !customBase && response.status !== 400) {
        try {
          const fallbackRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
          if (fallbackRes.ok || fallbackRes.status === 429) {
            response = fallbackRes;
          }
        } catch {
          // ignore fallback error
        }
      }

      if (!response.ok) {
        const body = await response.text();
        let msg = 'Invalid API key';
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          try {
            const parsed = JSON.parse(body) as { error?: { message?: string } };
            msg = parsed.error?.message || 'Invalid API key. Check that your key is correct.';
          } catch {
            msg = 'Invalid API key. Check that your key is correct.';
          }
        } else if (response.status === 429) {
          msg = 'Rate limited. Key looks valid — try again shortly.';
        } else {
          try {
            const parsed = JSON.parse(body) as { error?: { message?: string } };
            msg = parsed.error?.message || `API error (${response.status})`;
          } catch {
            msg = `API error (${response.status})`;
          }
        }

        if (response.status === 429) {
          const authErrors429 = (await getStorage(['authErrorApis'])).authErrorApis || {};
          if (authErrors429.gemini) {
            delete authErrors429.gemini;
            await setStorage({ authErrorApis: authErrors429 });
          }
          await setStorage({ geminiApiKey: key, geminiApiBase: customBase });
          const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
          updateApiProviderStates(data);
          updateGeminiEnabledUI(true);
          renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
          void fetchAndApplyModels('gemini', key, customBase);
        } else {
          geminiErrorEl.textContent = msg;
          geminiErrorEl.style.display = 'block';
          geminiEnableBtn.disabled = false;
        }
      } else {
        const authErrorsOk = (await getStorage(['authErrorApis'])).authErrorApis || {};
        if (authErrorsOk.gemini) {
          delete authErrorsOk.gemini;
          await setStorage({ authErrorApis: authErrorsOk });
        }
        await setStorage({ geminiApiKey: key, geminiApiBase: customBase });
        const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
        updateApiProviderStates(data);
        updateGeminiEnabledUI(true);
        renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
        void fetchAndApplyModels('gemini', key, customBase);
      }
    } catch (err) {
      console.error('[Gemini] Network error during verification:', err);
      geminiErrorEl.textContent = 'Network error. Could not reach Gemini API.';
      geminiErrorEl.style.display = 'block';
      geminiEnableBtn.disabled = false;
    } finally {
      const data = await getStorage(['geminiApiKey']);
      const isEnabled = !!data.geminiApiKey;
      setButtonVerifying(geminiEnableBtn, false, GEMINI_BTN_ICON, isEnabled ? 'Update' : 'Enable');
      geminiEnableBtn.disabled = !geminiKeyInput.value.trim();
    }
  })().catch(err => console.error('[Popup] Gemini enable failed:', err)); });

  // Gemini disable button
  document.getElementById('geminiDisableBtn')!.addEventListener('click', () => { (async () => {
    await removeStorage('geminiApiKey');
    geminiKeyInput.value = '';
    updateGeminiEnabledUI(false);
    const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
    updateApiProviderStates(data);
    renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
  })().catch(err => console.error('[Popup] Gemini disable failed:', err)); });

  // OpenRouter: Safari has no chrome.identity, so launchWebAuthFlow throws.
  // Show the API-key paste input instead and hide the OAuth button. The
  // input mirrors the same chrome.storage.local.openrouterApiKey field the
  // OAuth flow would have written, so everything downstream is identical.
  const isSafariPopup = /^((?!chrome|android|crios|fxios|edg|opr).)*safari/i.test(navigator.userAgent);

  if (isSafariPopup) {
    const signInBtn = document.getElementById('openrouterSignIn') as HTMLButtonElement | null;
    if (signInBtn) signInBtn.style.display = 'none';
    const keyField = document.getElementById('openrouterApiKeyField');
    if (keyField) keyField.style.display = '';
    const keyInput = document.getElementById('openrouterApiKey') as HTMLInputElement | null;
    if (keyInput) {
      // Seed input from storage (async, but fine — `loadSettings` already
      // populated other inputs before we got here; this is just a backstop).
      getStorage(['openrouterApiKey'])
        .then((d) => { keyInput.value = d.openrouterApiKey || ''; })
        .catch((err) => console.error('[Popup] seed openrouterApiKey failed:', err));
      keyInput.addEventListener('change', (e) => { (async () => {
        const key = (e.target as HTMLInputElement).value.trim();
        await setStorage({ openrouterApiKey: key });
        await updateOpenRouterStatus();
      })().catch(err => console.error('[Popup] openrouterApiKey change failed:', err)); });
    }
  } else {
    document.getElementById('openrouterSignIn')!.addEventListener('click', asyncHandler(startOpenRouterOAuth));
  }

  // OpenRouter sign out
  document.getElementById('openrouterSignOut')!.addEventListener('click', asyncHandler(signOutOpenRouter));

  document.getElementById('enableFilterReplies')?.addEventListener('change', (e) => { (async () => {
    const checked = (e.target as HTMLInputElement).checked;
    await setStorage({ filterReplies: checked });
  })().catch(err => console.error('[Popup] enableFilterReplies change failed:', err)); });

  // Share filters button and footer link
  const shareBtn = document.getElementById('shareFiltersBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', asyncHandler(handleShareFilters));
  }
  const shareFooterLink = document.getElementById('shareFiltersFooterLink');
  if (shareFooterLink) {
    shareFooterLink.addEventListener('click', (e) => {
      e.preventDefault();
      handleShareFilters().catch(err => console.error('[Popup] shareFooterLink failed:', err));
    });
  }


  // AI-text-detection threshold (range slider). Live-update the percentage
  // display on `input` (every drag tick); persist only on `change` (release)
  // so we don't write to storage 100 times mid-drag.
  const thresholdInputEl = document.getElementById('aiTextThreshold') as HTMLInputElement | null;
  const thresholdValueEl = document.getElementById('aiTextThresholdValue');
  const renderThresholdPercent = (v: number) => {
    if (thresholdValueEl) thresholdValueEl.textContent = `${Math.round(v * 100)}%`;
  };
  thresholdInputEl?.addEventListener('input', (e) => {
    renderThresholdPercent(parseFloat((e.target as HTMLInputElement).value));
  });
  thresholdInputEl?.addEventListener('change', (e) => { (async () => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(1, Math.max(0, v));
    renderThresholdPercent(clamped);
    await setStorage({ aiTextDetectionThreshold: clamped });
  })().catch(err => console.error('[Popup] aiTextThreshold change failed:', err)); });

  // Reply/comment threshold (applied instead of the one above when the
  // evaluated post is a reply). Same input/change split as its sibling.
  const replyThresholdInputEl = document.getElementById('aiTextReplyThreshold') as HTMLInputElement | null;
  const replyThresholdValueEl = document.getElementById('aiTextReplyThresholdValue');
  const renderReplyThresholdPercent = (v: number) => {
    if (replyThresholdValueEl) replyThresholdValueEl.textContent = `${Math.round(v * 100)}%`;
  };
  replyThresholdInputEl?.addEventListener('input', (e) => {
    renderReplyThresholdPercent(parseFloat((e.target as HTMLInputElement).value));
  });
  replyThresholdInputEl?.addEventListener('change', (e) => { (async () => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(1, Math.max(0, v));
    renderReplyThresholdPercent(clamped);
    await setStorage({ aiTextReplyDetectionThreshold: clamped });
  })().catch(err => console.error('[Popup] aiTextReplyThreshold change failed:', err)); });

  // AI-image-detection threshold (mirrors the AI text threshold above).
  const imageThresholdInputEl = document.getElementById('aiImageThreshold') as HTMLInputElement | null;
  const imageThresholdValueEl = document.getElementById('aiImageThresholdValue');
  const renderImageThresholdPercent = (v: number) => {
    if (imageThresholdValueEl) imageThresholdValueEl.textContent = `${Math.round(v * 100)}%`;
  };
  imageThresholdInputEl?.addEventListener('input', (e) => {
    renderImageThresholdPercent(parseFloat((e.target as HTMLInputElement).value));
  });
  imageThresholdInputEl?.addEventListener('change', (e) => { (async () => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(1, Math.max(0, v));
    renderImageThresholdPercent(clamped);
    await setStorage({ aiImageDetectionThreshold: clamped });
  })().catch(err => console.error('[Popup] aiImageThreshold change failed:', err)); });

}

// The user's parked "switch to On-Device once it's downloaded" choice. Mirrors
// the pendingLocalModelSelection storage key; while set, the previous model
// keeps filtering and stays selected in the radios — only the download
// panel and a note under Local reflect the parked choice. The background
// flips selectedModel (and clears the key) when the download completes, so
// the switch happens even if this popup is closed mid-download.
let pendingLocalSelection: string | null = null;

async function clearPendingLocalSelection() {
  if (!pendingLocalSelection) return;
  pendingLocalSelection = null;
  await removeStorage('pendingLocalModelSelection');
}


// Wire the headline radios. selectModel() persists, re-renders the dropdown
// (which re-syncs the radios via updateModelRadioUI), clears the
// classification cache, and shows the download section when a not-yet-
// downloaded local model is picked — no radio-specific follow-up needed.
function setupModelRadios() {
  // Model selection has moved to the top-level searchable dropdown.
}

// ==================== Custom Model Dropdown ====================

interface DropdownState {
  isOpen: boolean;
  customModels: ModelDef[];
  selectedModel: string;
  authenticatedApis: Record<string, boolean>;
  dynamicModels: Record<string, ModelDef[]>;
}

const dropdownState: DropdownState = {
  isOpen: false,
  customModels: [],
  selectedModel: DEFAULT_MODEL,
  authenticatedApis: {
    openrouter: false,
    openai: false,
    gemini: false,
    anthropic: false
  },
  dynamicModels: {}
};

async function fetchAndApplyModels(api: string, key?: string, apiBase?: string) {
  try {
    const models = await fetchProviderModels(api, key || '', apiBase);
    if (models.length > 0) {
      dropdownState.dynamicModels = {
        ...dropdownState.dynamicModels,
        [api]: models
      };
      await setStorage({ cachedDynamicModels: dropdownState.dynamicModels });
      renderModelDropdown(dropdownState.customModels, dropdownState.selectedModel);
    }
  } catch (err) {
    console.warn(`[Popup] Failed to fetch and apply models for ${api}:`, err);
  }
}

async function refreshDynamicModels(data: Partial<StorageSchema>) {
  try {
    let changed = false;
    const current = { ...(dropdownState.dynamicModels || {}) };

    // 1. OpenRouter (fetch if connected or not yet cached)
    if (data.openrouterApiKey || !current.openrouter?.length) {
      const models = await fetchProviderModels('openrouter', data.openrouterApiKey || '');
      if (models.length > 0) {
        current.openrouter = models;
        changed = true;
      }
    }

    // 2. OpenAI
    if (data.openaiApiKey && !current.openai?.length) {
      const models = await fetchProviderModels('openai', data.openaiApiKey, data.openaiApiBase);
      if (models.length > 0) {
        current.openai = models;
        changed = true;
      }
    }

    // 3. Anthropic
    if (data.anthropicApiKey && !current.anthropic?.length) {
      const models = await fetchProviderModels('anthropic', data.anthropicApiKey, data.anthropicApiBase);
      if (models.length > 0) {
        current.anthropic = models;
        changed = true;
      }
    }

    // 4. Gemini
    if (data.geminiApiKey && !current.gemini?.length) {
      const models = await fetchProviderModels('gemini', data.geminiApiKey, data.geminiApiBase);
      if (models.length > 0) {
        current.gemini = models;
        changed = true;
      }
    }

    if (changed) {
      dropdownState.dynamicModels = current;
      await setStorage({ cachedDynamicModels: current });
      renderModelDropdown(dropdownState.customModels, dropdownState.selectedModel);
    }
  } catch (err) {
    console.warn('[Popup] refreshDynamicModels failed:', err);
  }
}

function setupModelDropdown() {
  const dropdown = document.getElementById('modelDropdown');
  const combobox = document.getElementById('modelDropdownCombobox');
  const input = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
  const clearBtn = document.getElementById('modelDropdownClearBtn');
  const menu = document.getElementById('modelDropdownMenu');
  if (!dropdown || !input || !combobox) return;

  // Clear button resets search query and refocusses input
  clearBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    input.value = '';
    input.placeholder = 'Search or select a model...';
    filterModels('');
    input.focus();
    if (clearBtn) clearBtn.style.display = 'none';
  });

  // Clicking combobox focuses input and opens dropdown
  combobox.addEventListener('click', (e) => {
    // If clicking arrow specifically, toggle dropdown
    if ((e.target as HTMLElement)?.closest('.model-dropdown-arrow-wrap')) {
      e.stopPropagation();
      toggleDropdown();
      return;
    }
    // If clicking clear button, let its handler handle it
    if ((e.target as HTMLElement)?.closest('.model-dropdown-clear-btn')) {
      return;
    }
    if (!dropdownState.isOpen) {
      openDropdown();
    }
    input.focus();
  });

  input.addEventListener('focus', () => {
    openDropdown();
  });

  // Typing in the input filters models live
  input.addEventListener('input', () => {
    if (!dropdownState.isOpen) {
      openDropdown();
    }
    if (clearBtn) {
      clearBtn.style.display = input.value.trim() ? 'inline-flex' : 'none';
    }
    filterModels(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDropdown(true);
      input.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Select the first visible item that is not disabled
      const list = document.getElementById('modelDropdownList');
      const firstItem = list?.querySelector<HTMLElement>(
        '.model-dropdown-item:not([style*="display: none"]):not(.disabled)'
      );
      if (firstItem) {
        firstItem.click();
      }
    } else if (e.key === 'ArrowDown') {
      if (!dropdownState.isOpen) {
        e.preventDefault();
        openDropdown();
      }
    }
  });

  // Prevent clicks inside menu from bubbling up to document click listener
  menu?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Close dropdown when focus moves completely outside dropdown
  dropdown.addEventListener('focusout', (e) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && !dropdown.contains(nextTarget)) {
      closeDropdown(true);
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target as Node)) {
      closeDropdown(true);
    }
  });
}

function focusModelSelector(showNotice = false) {
  const input = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
  const combobox = document.getElementById('modelDropdownCombobox');
  const notice = document.getElementById('selectModelNotice');

  if (showNotice && notice) {
    notice.style.display = 'flex';
  }

  combobox?.classList.add('pulse-highlight');
  openDropdown();
  input?.focus();
}

function toggleDropdown() {
  if (dropdownState.isOpen) {
    closeDropdown(true);
  } else {
    openDropdown();
    const input = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
    input?.focus();
  }
}

function openDropdown() {
  if (dropdownState.isOpen) return;
  dropdownState.isOpen = true;
  const dropdown = document.getElementById('modelDropdown');
  const input = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
  const clearBtn = document.getElementById('modelDropdownClearBtn');
  dropdown?.classList.add('open');
  input?.setAttribute('aria-expanded', 'true');
  if (input) {
    input.placeholder = 'Search or select a model...';
    input.value = '';
  }
  if (clearBtn) clearBtn.style.display = 'none';
  filterModels('');
}

function closeDropdown(revertText = true) {
  if (!dropdownState.isOpen) return;
  dropdownState.isOpen = false;
  const dropdown = document.getElementById('modelDropdown');
  const input = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
  const clearBtn = document.getElementById('modelDropdownClearBtn');
  dropdown?.classList.remove('open');
  input?.setAttribute('aria-expanded', 'false');
  if (clearBtn) clearBtn.style.display = 'none';
  if (revertText && input) {
    const label = getModelDisplayLabel(dropdownState.selectedModel, dropdownState.customModels);
    input.value = dropdownState.selectedModel ? label : '';
    input.placeholder = 'Search or select a model...';
  }
  filterModels('');
}

function filterModels(query: string) {
  const normalized = query.trim().toLowerCase();
  const list = document.getElementById('modelDropdownList');
  const noResults = document.getElementById('modelDropdownNoResults');
  if (!list) return;

  const groups = list.querySelectorAll<HTMLElement>('.model-dropdown-group');
  let totalVisible = 0;

  groups.forEach(group => {
    const items = group.querySelectorAll<HTMLElement>('.model-dropdown-item');
    let groupVisible = 0;

    items.forEach(item => {
      const searchText = item.dataset.searchText || (item.textContent || '').toLowerCase();
      const matches = !normalized || searchText.includes(normalized);
      item.style.display = matches ? 'flex' : 'none';
      if (matches) {
        groupVisible++;
        totalVisible++;
      }
    });

    const countEl = group.querySelector<HTMLElement>('.model-dropdown-group-count');
    if (countEl) {
      countEl.textContent = String(groupVisible);
    }

    group.style.display = groupVisible > 0 ? 'flex' : 'none';
  });

  if (noResults) {
    noResults.style.display = (totalVisible === 0 && groups.length > 0) ? 'block' : 'none';
  }
}

async function selectModel(modelKey: string) {
  // Any explicit selection supersedes a parked "On-Device, once downloaded"
  // choice — without this, the grey pending radio would linger next to
  // whatever the user just picked.
  await clearPendingLocalSelection();
  dropdownState.selectedModel = modelKey;
  await setStorage({ selectedModel: modelKey });
  renderModelDropdown(dropdownState.customModels, modelKey);
  closeDropdown();
  // Clear cache since model changed
  await chrome.runtime.sendMessage({ type: 'clearCache' });

  // Clear auto-init tracking when switching models to allow re-initialization
  autoInitTriggered.clear();

  // Update local model section visibility and UI when selection changes
  updateLocalModelSectionVisibility();
  updateLocalModelSectionUI();

  // Remove rate limit alert if switching away from OpenRouter or if alert exists
  const alert = document.querySelector('.rate-limit-alert');
  if (alert) {
    const isOpenRouter = modelKey.startsWith('openrouter:');
    if (!isOpenRouter) {
      alert.remove();
    }
  }

  // Remove select model notice and combobox pulse highlight if displayed
  const notice = document.getElementById('selectModelNotice');
  if (notice) notice.style.display = 'none';
  const combobox = document.getElementById('modelDropdownCombobox');
  combobox?.classList.remove('pulse-highlight');
}

// Show/hide the local model section based on whether a local model is
// selected, parked as the pending choice, or when no model has been selected yet.
function updateLocalModelSectionVisibility() {
  const localModelSection = document.getElementById('localModelSection');
  if (!localModelSection) return;
  const isCloudModelSelected = dropdownState.selectedModel &&
    !dropdownState.selectedModel.startsWith('local:') &&
    !dropdownState.selectedModel.startsWith('iosLocal:');
  const isVisible = (webgpuSupported || isIOSDevice) && (!isCloudModelSelected || !!pendingLocalSelection?.startsWith('local:'));
  localModelSection.style.display = isVisible ? 'flex' : 'none';
}

async function removeModel(modelKey: string, e: Event) {
  e.stopPropagation();

  // Parse the model key to find the model to remove
  const [api, ...nameParts] = modelKey.split(':');
  const name = nameParts.join(':');

  const newModels = dropdownState.customModels.filter(
    m => !(m.api === api && m.name === name)
  );
  dropdownState.customModels = newModels;

  // If we're removing the currently selected model, switch to default
  if (dropdownState.selectedModel === modelKey) {
    dropdownState.selectedModel = DEFAULT_MODEL;
    await setStorage({ customModels: newModels, selectedModel: DEFAULT_MODEL });
    // Clear cache since model changed
    await chrome.runtime.sendMessage({ type: 'clearCache' });
  } else {
    await setStorage({ customModels: newModels });
  }

  renderModelDropdown(newModels, dropdownState.selectedModel);
}

function getApiDisplayName(api: string) {
  return PROVIDER_DISPLAY_NAMES[api] || api;
}

function getModelsForProvider(api: string) {
  const dynamic = dropdownState.dynamicModels?.[api];
  const filteredDynamic = dynamic ? dynamic.filter(m => !isExcludedModel(api, m.name)) : undefined;
  const predefined = (filteredDynamic && filteredDynamic.length > 0) ? filteredDynamic : (PREDEFINED_MODELS[api] || []);
  const custom = dropdownState.customModels.filter(m => m.api === api);
  return { predefined, custom };
}

// Human-readable label for a selected model key ("api:modelName").
function getModelDisplayLabel(selectedModel: string, customModels: ModelDef[]): string {
  if (!selectedModel) return 'Select a model';
  // Parse model key (format: api:modelName)
  const [api, ...nameParts] = selectedModel.split(':');
  const modelName = nameParts.join(':');

  if (api === 'free') {
    const freeModel = getFreeModel(modelName);
    return freeModel ? freeModel.display : modelName;
  }

  // Check dynamic models first
  const dynamicModel = (dropdownState.dynamicModels?.[api] || []).find(m => m.name === modelName);
  if (dynamicModel) {
    return dynamicModel.display;
  }

  // Find display name from predefined models
  const predefinedModel = (PREDEFINED_MODELS[api] || []).find(m => m.name === modelName);
  const displayName = predefinedModel ? predefinedModel.display : modelName;
  // Check if this model has apiKwargs configured (only show indicator for custom models)
  let kwargsIndicator = '';
  if (!predefinedModel) {
    // Only show gear indicator for custom models
    const customModel = customModels.find(m => m.api === api && m.name === modelName);
    const hasKwargs = customModel && customModel.apiKwargs && Object.keys(customModel.apiKwargs).length > 0;
    kwargsIndicator = hasKwargs ? ' \u2699' : '';
  }
  return `${displayName}${kwargsIndicator}`;
}

function renderModelDropdown(customModels: ModelDef[], selectedModel: string) {
  // Update state
  dropdownState.customModels = customModels;
  dropdownState.selectedModel = selectedModel;

  // Update selected trigger display
  const [selectedApi] = (selectedModel || '').split(':');
  const selectedLogoEl = document.getElementById('modelDropdownSelectedLogo');
  if (selectedLogoEl) {
    const logoSvg = PROVIDER_LOGOS[selectedApi] || DEFAULT_MODEL_SEARCH_ICON;
    selectedLogoEl.replaceChildren(parseHTML(logoSvg));
  }

  const input = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
  if (input) {
    const label = getModelDisplayLabel(selectedModel, customModels);
    if (!dropdownState.isOpen) {
      input.value = selectedModel ? label : '';
    }
    input.placeholder = 'Search or select a model...';
  }

  // Build menu items
  const list = document.getElementById('modelDropdownList');
  if (!list) return;
  list.replaceChildren();

  // Helper to create a single model item
  const buildItem = (opts: {
    modelKey: string;
    displayName: string;
    modelName: string;
    providerName: string;
    isSelected: boolean;
    badgeHtml?: string;
    isCustom?: boolean;
    hasKwargs?: boolean;
    isDisabled?: boolean;
  }): HTMLElement => {
    const item = document.createElement('div');
    item.className = 'model-dropdown-item' +
      (opts.isSelected ? ' selected' : '') +
      (opts.isDisabled ? ' disabled' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', opts.isSelected ? 'true' : 'false');
    if (opts.isDisabled) {
      item.setAttribute('aria-disabled', 'true');
      item.title = 'Download required before use';
    }
    item.dataset.modelKey = opts.modelKey;
    item.dataset.searchText = `${opts.displayName} ${opts.modelName} ${opts.providerName}`.toLowerCase();

    const rightParts: string[] = [];
    if (opts.hasKwargs) {
      rightParts.push('<button type="button" class="model-dropdown-item-settings has-kwargs" title="Configure provider options"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5m0 10v1.5m6.5-6.5h-1.5m-10 0H1.5m11.1-4.6l-1.1 1.1m-7 7l-1.1 1.1m9.2 0l-1.1-1.1m-7-7L3.5 4.5"/></svg></button>');
    } else if (opts.isCustom) {
      rightParts.push('<button type="button" class="model-dropdown-item-settings" title="Configure provider options"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5m0 10v1.5m6.5-6.5h-1.5m-10 0H1.5m11.1-4.6l-1.1 1.1m-7 7l-1.1 1.1m9.2 0l-1.1-1.1m-7-7L3.5 4.5"/></svg></button>');
    }
    if (opts.isCustom) {
      rightParts.push('<button type="button" class="model-dropdown-item-remove" title="Remove model"><svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9"/></svg></button>');
    }
    if (opts.isSelected) {
      rightParts.push('<span class="model-dropdown-check" aria-hidden="true"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6"/></svg></span>');
    }

    item.replaceChildren(parseHTML(`
      <div class="model-dropdown-item-left">
        <span class="model-dropdown-item-name">${escapeHtml(opts.displayName)}</span>
        ${opts.badgeHtml || ''}
      </div>
      <div class="model-dropdown-item-right">
        ${rightParts.join('')}
      </div>
    `));

    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.model-dropdown-item-remove') || target?.closest('.model-dropdown-item-settings')) {
        return;
      }
      if (opts.isDisabled) {
        // Disabled because download is required: open local model download panel
        pendingLocalSelection = opts.modelKey;
        setStorage({ pendingLocalModelSelection: opts.modelKey }).catch(console.error);
        updateLocalModelSectionVisibility();
        updateLocalModelSectionUI();
        closeDropdown(true);
        document.getElementById('localModelSection')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      selectModel(opts.modelKey).catch(err => console.error('[Popup] selectModel failed:', err));
    });

    if (opts.isCustom) {
      item.querySelector('.model-dropdown-item-remove')?.addEventListener('click', (e) => {
        removeModel(opts.modelKey, e).catch(err => console.error('[Popup] removeModel failed:', err));
      });

      item.querySelector('.model-dropdown-item-settings')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openModelKwargsEditor(opts.modelKey, opts.modelName, false);
      });
    }

    return item;
  };

  // Helper to create a provider group container
  const buildGroup = (
    api: string,
    title: string,
    logoSvg: string,
    items: HTMLElement[],
    groupBadgeHtml?: string
  ): HTMLElement => {
    const group = document.createElement('div');
    group.className = 'model-dropdown-group';
    group.dataset.provider = api;

    const header = document.createElement('div');
    header.className = 'model-dropdown-group-header';
    header.replaceChildren(parseHTML(`
      <div class="model-dropdown-group-title">
        ${logoSvg}
        <span>${escapeHtml(title)}</span>
        ${groupBadgeHtml || ''}
      </div>
      <span class="model-dropdown-group-count">${items.length}</span>
    `));
    group.appendChild(header);


    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'model-dropdown-group-items';
    items.forEach(it => itemsWrap.appendChild(it));
    group.appendChild(itemsWrap);

    return group;
  };

  // 1. Free Models (only rendered if declared in env var)
  if (FREE_MODELS.length > 0) {
    const freeItems: HTMLElement[] = [];
    FREE_MODELS.forEach(model => {
      const modelKey = `free:${model.id}`;
      freeItems.push(buildItem({
        modelKey,
        displayName: model.display,
        modelName: model.name,
        providerName: `${getApiDisplayName(model.provider)} · Sieve Cloud`,
        isSelected: selectedModel === modelKey,
      }));
    });

    if (freeItems.length > 0) {
      list.appendChild(buildGroup('free', 'Sieve Cloud (Free)', PROVIDER_LOGOS.free, freeItems));
    }
  }

  // 2. On-Device / Local models
  if ((webgpuSupported || isIOSDevice) && (PREDEFINED_MODELS.local || (isInAppMode && PREDEFINED_MODELS.iosLocal))) {
    const localItems: HTMLElement[] = [];
    const localPredefined = isInAppMode && IOS_LOCAL_MODEL
      ? (PREDEFINED_MODELS.iosLocal || [])
      : (PREDEFINED_MODELS.local || []);

    localPredefined.forEach(model => {
      const modelKey = (isInAppMode && IOS_LOCAL_MODEL ? 'iosLocal:' : 'local:') + model.name;
      const status = localModelStatuses[model.name] || { state: 'not_downloaded' };
      const isChromeBuiltin = model.backend === 'chrome-builtin';
      const isDownloaded = status.state === 'ready' || status.state === 'cached';

      let badgeHtml = '';
      if (!isDownloaded) {
        badgeHtml = isChromeBuiltin
          ? '<span class="model-dropdown-group-badge">Requires Chrome flags</span>'
          : '<span class="model-dropdown-group-badge">Download required</span>';
      }

      localItems.push(buildItem({
        modelKey,
        displayName: model.display,
        modelName: model.name,
        providerName: 'On-Device Local',
        isSelected: selectedModel === modelKey,
        badgeHtml,
        isDisabled: !isDownloaded
      }));
    });

    const customLocal = customModels.filter(m => m.api === 'local');
    customLocal.forEach(model => {
      const modelKey = `local:${model.name}`;
      const status = localModelStatuses[model.name] || { state: 'not_downloaded' };
      const isDownloaded = status.state === 'ready' || status.state === 'cached';

      const badgeHtml = !isDownloaded ? '<span class="model-dropdown-group-badge">Download required</span>' : '';

      localItems.push(buildItem({
        modelKey,
        displayName: model.name,
        modelName: model.name,
        providerName: 'On-Device Local',
        isSelected: selectedModel === modelKey,
        badgeHtml,
        isCustom: true,
        isDisabled: !isDownloaded
      }));
    });

    if (localItems.length > 0) {
      list.appendChild(buildGroup('local', 'On-Device (Free)', PROVIDER_LOGOS.local, localItems));
    }
  }

  // 2. Cloud Providers
  const providers = ['openai', 'anthropic', 'gemini', 'openrouter'];
  providers.forEach(api => {
    if (!dropdownState.authenticatedApis[api]) return;
    const { predefined, custom } = getModelsForProvider(api);
    const providerItems: HTMLElement[] = [];

    predefined.forEach(model => {
      const modelKey = `${api}:${model.name}`;
      providerItems.push(buildItem({
        modelKey,
        displayName: model.display,
        modelName: model.name,
        providerName: getApiDisplayName(api),
        isSelected: selectedModel === modelKey,
      }));
    });

    custom.forEach(model => {
      const modelKey = `${api}:${model.name}`;
      const hasKwargs = !!(model.apiKwargs && Object.keys(model.apiKwargs).length > 0);
      providerItems.push(buildItem({
        modelKey,
        displayName: model.name,
        modelName: model.name,
        providerName: getApiDisplayName(api),
        isSelected: selectedModel === modelKey,
        isCustom: true,
        hasKwargs
      }));
    });

    if (providerItems.length > 0) {
      list.appendChild(buildGroup(api, getApiDisplayName(api), PROVIDER_LOGOS[api] || '', providerItems));
    }
  });

  // 3. Empty state
  if (list.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'model-dropdown-empty';
    empty.replaceChildren(parseHTML(`
      <span>No model providers enabled</span>
      <button type="button" class="model-dropdown-configure-btn" id="modelDropdownConfigureBtn">Configure in Settings</button>
    `));
    empty.querySelector('#modelDropdownConfigureBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDropdown();
      const adv = document.getElementById('advancedSettings');
      if (adv && !adv.classList.contains('expanded')) {
        adv.classList.add('expanded');
      }
      document.getElementById('apiProvidersSection')?.scrollIntoView({ behavior: 'smooth' });
    });
    list.appendChild(empty);
  }

  // Re-apply existing search query if open and user was typing, or reset
  const inputEl = document.getElementById('modelDropdownInput') as HTMLInputElement | null;
  const currentLabel = getModelDisplayLabel(selectedModel, customModels);
  if (dropdownState.isOpen && inputEl && inputEl.value && inputEl.value !== currentLabel) {
    filterModels(inputEl.value);
  } else {
    const noResults = document.getElementById('modelDropdownNoResults');
    if (noResults) noResults.style.display = 'none';
  }
}

function updateModelRadioUI() {
  // Model selection has moved to the top-level searchable dropdown.
}


// Open the kwargs editor modal for a model
function openModelKwargsEditor(modelKey: string, displayName: string, isPredefined: boolean) {
  const [api, ...nameParts] = modelKey.split(':');
  const modelName = nameParts.join(':');

  // Get existing kwargs
  let existingKwargs: Record<string, unknown> = {};
  if (isPredefined) {
    // If user has previously saved custom kwargs for this model, use those directly
    // (this preserves removals of default keys)
    if (modelKey in predefinedModelKwargs) {
      existingKwargs = { ...predefinedModelKwargs[modelKey] };
    } else {
      // Otherwise, use predefined defaults
      const predefinedModel = (PREDEFINED_MODELS[api] || []).find(m => m.name === modelName);
      if (predefinedModel && predefinedModel.apiKwargs) {
        existingKwargs = { ...predefinedModel.apiKwargs };
      }
    }
  } else {
    const customModel = dropdownState.customModels.find(m => m.api === api && m.name === modelName);
    existingKwargs = customModel?.apiKwargs || {};
  }

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'kwargs-editor-modal';
  modal.replaceChildren(parseHTML(`
    <div class="kwargs-editor-content">
      <div class="kwargs-editor-header">
        <span>API Options: ${escapeHtml(displayName)}</span>
        <button class="kwargs-editor-close">&times;</button>
      </div>
      <div class="kwargs-editor-body">
        <p class="hint" style="margin-bottom: 8px;">Configure API parameters (e.g., reasoning_effort, temperature)</p>
        <div class="kwargs-editor-rows"></div>
        <button type="button" class="add-kwargs-btn kwargs-editor-add">+ Add Parameter</button>
      </div>
      <div class="kwargs-editor-actions">
        <button class="cancel-btn kwargs-editor-cancel">Cancel</button>
        <button class="add-btn kwargs-editor-save">Save</button>
      </div>
    </div>
  `));

  document.body.appendChild(modal);

  const rowsContainer = modal.querySelector('.kwargs-editor-rows')!;

  // Add existing kwargs as rows
  const entries = Object.entries(existingKwargs);
  if (entries.length === 0) {
    addKwargsEditorRow(rowsContainer);
  } else {
    entries.forEach(([key, value]) => {
      addKwargsEditorRow(rowsContainer, key, typeof value === 'string' ? value : JSON.stringify(value));
    });
  }

  // Event listeners
  modal.querySelector('.kwargs-editor-close')!.addEventListener('click', () => modal.remove());
  modal.querySelector('.kwargs-editor-cancel')!.addEventListener('click', () => modal.remove());
  modal.querySelector('.kwargs-editor-add')!.addEventListener('click', () => addKwargsEditorRow(rowsContainer));
  modal.querySelector('.kwargs-editor-save')!.addEventListener('click', () => { (async () => {
    const kwargs = collectKwargsFromEditor(rowsContainer);
    await saveModelKwargs(modelKey, kwargs, isPredefined);
    modal.remove();
    // Re-render dropdown to show updated indicators
    renderModelDropdown(dropdownState.customModels, dropdownState.selectedModel);
  })().catch(err => console.error('[Popup] kwargs save failed:', err)); });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// Add a row to the kwargs editor
function addKwargsEditorRow(container: Element, key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'api-kwargs-row';
  row.replaceChildren(parseHTML(`
    <input type="text" class="api-kwargs-key" placeholder="key" value="${escapeHtml(key)}">
    <input type="text" class="api-kwargs-value" placeholder="value" value="${escapeHtml(value)}">
    <button type="button" class="api-kwargs-remove" title="Remove">&times;</button>
  `));

  row.querySelector('.api-kwargs-remove')!.addEventListener('click', () => {
    row.remove();
    if (container.querySelectorAll('.api-kwargs-row').length === 0) {
      addKwargsEditorRow(container);
    }
  });

  container.appendChild(row);
}

// Collect kwargs from the editor
function collectKwargsFromEditor(container: Element) {
  const kwargs: Record<string, unknown> = {};
  container.querySelectorAll('.api-kwargs-row').forEach(row => {
    const key = (row.querySelector('.api-kwargs-key') as HTMLInputElement).value.trim();
    const value = (row.querySelector('.api-kwargs-value') as HTMLInputElement).value.trim();
    if (key && value) {
      try {
        kwargs[key] = JSON.parse(value);
      } catch {
        kwargs[key] = value;
      }
    }
  });
  return kwargs;
}

// Save model kwargs
async function saveModelKwargs(modelKey: string, kwargs: Record<string, unknown>, isPredefined: boolean) {
  const [api, ...nameParts] = modelKey.split(':');
  const modelName = nameParts.join(':');

  if (isPredefined) {
    // Always save to predefinedModelKwargs (even if empty) to track that user has customized this model
    // This ensures that if the user removes all defaults, they stay removed
    predefinedModelKwargs[modelKey] = kwargs;
    await setStorage({ predefinedModelKwargs });
  } else {
    // Save to custom model
    const modelIndex = dropdownState.customModels.findIndex(m => m.api === api && m.name === modelName);
    if (modelIndex !== -1) {
      if (Object.keys(kwargs).length > 0) {
        dropdownState.customModels[modelIndex].apiKwargs = kwargs;
      } else {
        delete dropdownState.customModels[modelIndex].apiKwargs;
      }
      await setStorage({ customModels: dropdownState.customModels });
    }
  }

  // Clear cache since model config changed
  await chrome.runtime.sendMessage({ type: 'clearCache' });
}


// ==================== OpenRouter OAuth ====================

// Generate a random code verifier for PKCE
// Start the OpenRouter OAuth flow via background script
async function startOpenRouterOAuth() {
  const signInBtn = document.getElementById('openrouterSignIn') as HTMLButtonElement;
  signInBtn.disabled = true;
  signInBtn.replaceChildren(parseHTML(`${BTN_SPINNER_ICON}<span>Signing in...</span>`));

  try {
    const response: { success?: boolean; error?: string; cancelled?: boolean } =
      await chrome.runtime.sendMessage({ type: 'launchOpenRouterAuth' });

    if (response?.success) {
      await updateOpenRouterStatus();
    } else if (response?.error) {
      console.error('OpenRouter OAuth error:', response.error);
    }
  } catch (error: unknown) {
    console.error('OpenRouter OAuth error:', error);
  } finally {
    signInBtn.disabled = false;
    signInBtn.replaceChildren(parseHTML(`
      <svg class="openrouter-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.654 3.87a5.087 5.087 0 1 1 0 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 0 1 0-16.958h10.175zM8.479 7.26a5.087 5.087 0 1 0 0 10.176 5.087 5.087 0 0 0 0-10.175z"/>
      </svg>
      <span>Sign in with OpenRouter</span>
    `));
  }
}

// Update the UI to show OpenRouter connection status
async function updateOpenRouterStatus() {
  const data = await getStorage(ALL_PROVIDER_STORAGE_KEYS);
  const signedOutSection = document.getElementById('openrouterSignedOut')!;
  const signedInSection = document.getElementById('openrouterSignedIn')!;

  const isSignedIn = !!data.openrouterApiKey;

  signedOutSection.style.display = isSignedIn ? 'none' : 'flex';
  signedInSection.style.display = isSignedIn ? 'block' : 'none';

  // Update all API provider states
  updateApiProviderStates(data);
  renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
  if (isSignedIn) {
    void fetchAndApplyModels('openrouter', data.openrouterApiKey);
  }
}

// Sign out from OpenRouter
async function signOutOpenRouter() {
  await removeStorage('openrouterApiKey');
  // Clear the Safari paste-input so re-opening signed-out view doesn't
  // show the stale (just-removed) key.
  const keyInput = document.getElementById('openrouterApiKey') as HTMLInputElement | null;
  if (keyInput) keyInput.value = '';
  await updateOpenRouterStatus();
}

// ==================== Rate Limit Alert ====================

// Configuration for provider-specific rate limit alerts
const RATE_LIMIT_ALERT_CONFIG: Record<string, { title: string; description: string; link: string; linkText: string; otherProviders: string }> = {
  openrouter_credits: {
    title: 'OpenRouter Free Limit Reached',
    description: 'Your OpenRouter account has used all free requests for today. To continue filtering:',
    link: 'https://openrouter.ai/credits',
    linkText: 'Add credits to your OpenRouter account',
    otherProviders: 'OpenAI, Gemini'
  },
  gemini_free_tier: {
    title: 'Gemini Free Limit Reached',
    description: 'Your Gemini usage has exceeded the free tier quota. To continue filtering:',
    link: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    linkText: 'Check your rate limits and upgrade your plan',
    otherProviders: 'OpenAI, OpenRouter'
  }
};

// Check error status from background and show rate limit alert if applicable
async function updateRateLimitAlert() {
  try {
    const status: { errorType?: string | null; subType?: string | null } | null = await chrome.runtime.sendMessage({ type: 'getErrorStatus' });

    if (status?.errorType === 'rate_limit' && status.subType && RATE_LIMIT_ALERT_CONFIG[status.subType]) {
      createRateLimitAlert(status.subType);
    } else {
      clearRateLimitAlert();
    }
  } catch (err) {
    console.debug('Failed to check error status:', err);
  }
}

// Create and show a rate limit alert banner for the given type
function createRateLimitAlert(rateLimitType: string) {
  const config = RATE_LIMIT_ALERT_CONFIG[rateLimitType];
  if (!config) return;

  // Don't add duplicate alerts
  if (document.querySelector(`.rate-limit-alert[data-type="${rateLimitType}"]`)) return;

  // Clear any other rate limit alerts first
  clearRateLimitAlert();

  const alert = document.createElement('div');
  alert.className = 'rate-limit-alert';
  alert.dataset.type = rateLimitType;
  alert.replaceChildren(parseHTML(`
    <div class="rate-limit-alert-content">
      <strong>${config.title}</strong>
      <p>${config.description}</p>
      <ul>
        <li><a href="${config.link}" target="_blank" rel="noopener">${config.linkText}</a></li>
        <li>Or switch to the On-Device model below</li>
        <li>Or configure a different provider (${config.otherProviders})</li>
      </ul>
    </div>
  `));

  // Insert at the beginning of the container
  const container = document.querySelector('.container');
  if (container) {
    container.insertBefore(alert, container.firstChild);
  }
}

// Clear all rate limit alert banners
function clearRateLimitAlert() {
  const alerts = document.querySelectorAll('.rate-limit-alert');
  for (const alert of alerts) {
    alert.remove();
  }
}


// ==================== Local Model ====================

// Get current statuses for all local models from background
async function updateLocalModelStatus() {
  try {
    const response: { statuses?: Record<string, LocalModelStatus>; webgpuSupported?: boolean } = await chrome.runtime.sendMessage({ type: 'getAllLocalModelStatuses' });
    localModelStatuses = response?.statuses || {};
    webgpuSupported = response?.webgpuSupported !== false;
  } catch (err) {
    console.debug('Failed to get local model statuses:', err);
    localModelStatuses = {};
    webgpuSupported = true; // Assume supported, will be corrected if not
  }

  // Always update UI, even on error. webgpuSupported resolves async, so the
  // section's visibility and items' disabled states must be refreshed here too.
  updateLocalModelSectionVisibility();
  updateLocalModelSectionUI();
  updateModelRadioUI();
  await refreshModelDropdownWithLocal();
}

// Get the currently selected local model (if any)
function getSelectedLocalModel(): LocalModelDef | null {
  // A parked pending choice counts: the download panel below the radios
  // must describe/drive the model the user asked for before it's selected.
  // Defaults to the primary on-device model when none is actively selected.
  const modelKey = dropdownState.selectedModel?.startsWith('local:')
    ? dropdownState.selectedModel
    : (pendingLocalSelection?.startsWith('local:')
        ? pendingLocalSelection
        : LOCAL_RADIO_MODEL_KEY);
  if (!modelKey) {
    return null;
  }
  const modelName = modelKey.split(':')[1];
  // First check predefined models
  const predefinedList = isInAppMode && IOS_LOCAL_MODEL
    ? PREDEFINED_MODELS.iosLocal
    : PREDEFINED_MODELS.local;
  const predefinedModel = (predefinedList || []).find(m => m.name === modelName);
  if (predefinedModel) {
    return predefinedModel;
  }
  // Then check custom local models
  const customModel = dropdownState.customModels.find(m => m.api === 'local' && m.name === modelName);
  return customModel || (predefinedList?.[0] ?? null);
}

// Track which models we've already triggered auto-initialization for to prevent duplicate calls
const autoInitTriggered = new Set<string>();

// Auto-initialize a cached model (called when 'cached' state is detected)
async function autoInitializeCachedModel(modelId: string) {
  // Prevent duplicate initialization triggers
  if (autoInitTriggered.has(modelId)) {
    return;
  }
  autoInitTriggered.add(modelId);

  console.log('[LocalModel] Auto-initializing cached model:', modelId);
  try {
    await chrome.runtime.sendMessage({ type: 'initializeLocalModel', modelId });
  } catch (err) {
    console.error('[LocalModel] Failed to auto-initialize cached model:', err);
    autoInitTriggered.delete(modelId);
  }
}

// Update the local model section UI based on selected model and its status
function updateLocalModelSectionUI() {
  const badge = document.getElementById('localModelStatusBadge')!;
  const unsupported = document.getElementById('localModelUnsupported')!;
  const notDownloaded = document.getElementById('localModelNotDownloaded')!;
  const downloading = document.getElementById('localModelDownloading')!;
  const ready = document.getElementById('localModelReady')!;
  const errorDiv = document.getElementById('localModelError')!;
  const progressFill = document.getElementById('localProgressFill')!;
  const progressText = document.getElementById('localProgressText')!;
  const errorText = document.getElementById('localModelErrorText')!;
  const downloadHint = document.getElementById('localModelDownloadHint');
  const readyHint = document.getElementById('localModelReadyHint');
  const noImageWarning = document.getElementById('localModelNoImageWarning');

  // Hide all states first
  unsupported.style.display = 'none';
  notDownloaded.style.display = 'none';
  downloading.style.display = 'none';
  ready.style.display = 'none';
  errorDiv.style.display = 'none';
  if (noImageWarning) noImageWarning.style.display = 'none';

  // Reset badge classes
  badge.classList.remove('connected', 'downloading', 'ready', 'error', 'auth-error');

  // Check if a local model is selected
  const selectedLocalModel = getSelectedLocalModel();

  const inAppLocalSupported = isInAppMode && (IOS_LOCAL_MODEL?.isSupportedOnThisDevice ?? false);
  if (isInAppMode ? !inAppLocalSupported : !webgpuSupported) {
    // Hardware can't run the local model (no WebGPU on desktop; not enough
    // device RAM in the iOS app) - show unsupported message
    badge.textContent = 'Unsupported';
    badge.classList.add('error');
    unsupported.style.display = 'block';
    if (isInAppMode) {
      const hint = unsupported.querySelector('.hint');
      if (hint) {
        hint.textContent =
          `Local inference isn't available on this iPhone — it requires ${IOS_LOCAL_MODEL?.requiredRAMDisplay ?? '6 GB'}+ RAM.`;
      }
    }
    return;
  }

  if (!selectedLocalModel) {
    // No local model available - show hint
    badge.textContent = 'Select a model';
    notDownloaded.style.display = 'block';
    if (downloadHint) {
      downloadHint.textContent = 'Choose an on-device model to download.';
    }
    const metaEl = document.getElementById('localModelMeta');
    if (metaEl) metaEl.style.display = 'none';
    document.getElementById('downloadLocalModel')!.style.display = 'none';
    return;
  }

  // Update title and clean metadata row
  const titleEl = document.querySelector('.local-model-title');
  if (titleEl) {
    titleEl.textContent = 'On-Device Model';
  }
  const metaEl = document.getElementById('localModelMeta');
  const nameEl = document.getElementById('localModelName');
  const sizeEl = document.getElementById('localModelSize');
  if (metaEl) {
    metaEl.style.display = 'flex';
    if (nameEl) nameEl.textContent = selectedLocalModel.display || selectedLocalModel.name;
    if (sizeEl) {
      sizeEl.textContent = selectedLocalModel.sizeGB === 0
        ? '0 MB (Built-in)'
        : (selectedLocalModel.sizeGB ? `~${selectedLocalModel.sizeGB} GB` : 'Local storage');
    }
  }

  // Check if the model supports images and show warning if not
  if (noImageWarning) {
    noImageWarning.style.display = !selectedLocalModel.supportsImages ? 'flex' : 'none';
  }

  // Get status for the selected model
  const status = localModelStatuses[selectedLocalModel.name] || { state: 'not_downloaded' };
  const state = status.state || 'not_downloaded';

  switch (state) {
    case 'unsupported':
      badge.textContent = 'Unsupported';
      badge.classList.add('error');
      unsupported.style.display = 'block';
      break;

    case 'cached':
      // Model is cached but not loaded - auto-initialize it
      badge.textContent = 'Loading...';
      badge.classList.add('downloading');
      downloading.style.display = 'block';
      progressFill.style.transform = 'scaleX(0)';
      progressText.textContent = 'Loading cached model...';
      // Trigger auto-initialization (async, don't await)
      autoInitializeCachedModel(selectedLocalModel.name).catch(err => console.error('[LocalModel] autoInitializeCachedModel failed:', err));
      break;

    case 'not_downloaded': {
      if (selectedLocalModel.backend === 'chrome-builtin') {
        badge.textContent = 'Not enabled';
        notDownloaded.style.display = 'block';
        if (downloadHint) {
          downloadHint.textContent = 'Requires Google Chrome 128+ with Prompt API enabled in chrome://flags.';
        }
        const downloadBtn = document.getElementById('downloadLocalModel') as HTMLButtonElement;
        downloadBtn.style.display = 'inline-flex';
        downloadBtn.disabled = false;
        downloadBtn.replaceChildren(parseHTML('<svg class="download-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.5-3.8L2 6M2 2v4h4"/></svg><span>Check Availability</span>'));
      } else {
        badge.textContent = 'Not downloaded';
        notDownloaded.style.display = 'block';
        if (downloadHint) {
          const sizeText = selectedLocalModel.sizeGB ? ` (~${selectedLocalModel.sizeGB}GB)` : '';
          downloadHint.textContent = `One-time download${sizeText}. Stored locally in your browser.`;
        }
        const downloadBtn = document.getElementById('downloadLocalModel') as HTMLButtonElement;
        downloadBtn.style.display = 'inline-flex';
        downloadBtn.disabled = false;
        downloadBtn.replaceChildren(parseHTML('<svg class="download-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M4.5 7l3.5 3.5 3.5-3.5M3 13.5h10"/></svg><span>Download Model</span>'));
      }
      break;
    }

    case 'initializing':
    case 'downloading': {
      badge.textContent = 'Downloading...';
      badge.classList.add('downloading');
      downloading.style.display = 'block';
      const progress = status.progress || 0;
      progressFill.style.transform = `scaleX(${progress})`;
      progressText.textContent = status.text || `${(progress * 100).toFixed(1)}%`;
      break;
    }

    case 'ready':
      badge.textContent = 'Ready';
      badge.classList.add('ready');
      ready.style.display = 'block';
      if (readyHint) {
        readyHint.textContent = 'Model is ready for on-device inference.';
      }
      break;

    case 'error': {
      badge.textContent = 'Error';
      badge.classList.add('error');
      errorDiv.style.display = 'block';
      const friendlyError = getUserFriendlyError(status.error);
      const hintText = friendlyError.hint ? ` ${friendlyError.hint}` : '';
      errorText.textContent = (friendlyError.display || 'An error occurred') + hintText;
      break;
    }

    default:
      badge.textContent = 'Unknown';
      notDownloaded.style.display = 'block';
  }
}

// Set up event listeners for local model UI
function setupLocalModelListeners() {
  const downloadBtn = document.getElementById('downloadLocalModel') as HTMLButtonElement | null;
  const retryBtn = document.getElementById('retryLocalModel') as HTMLButtonElement | null;
  console.log('[Popup] setupLocalModelListeners: downloadBtn=', !!downloadBtn, 'retryBtn=', !!retryBtn);

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => { (async () => {
      const selectedLocalModel = getSelectedLocalModel();
      if (!selectedLocalModel) {
        console.error('No local model selected');
        return;
      }

      // Track as pendingLocalSelection so background auto-selects this model upon download
      const modelKey = (isInAppMode && IOS_LOCAL_MODEL ? 'iosLocal:' : 'local:') + selectedLocalModel.name;
      pendingLocalSelection = modelKey;
      await setStorage({ pendingLocalModelSelection: modelKey });

      console.log('[Popup] Download button clicked, model:', selectedLocalModel.name);
      downloadBtn.disabled = true;
      downloadBtn.replaceChildren(parseHTML('<svg class="download-icon animate-spin" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke-dasharray="28" stroke-dashoffset="10"/></svg><span>Starting...</span>'));

      try {
        console.log('[Popup] Sending initializeLocalModel message for:', selectedLocalModel.name);
        const result: unknown = await chrome.runtime.sendMessage({ type: 'initializeLocalModel', modelId: selectedLocalModel.name });
        console.log('[Popup] initializeLocalModel response:', result);
      } catch (err) {
        console.error('[Popup] Failed to start model download:', err);
        downloadBtn.disabled = false;
        downloadBtn.replaceChildren(parseHTML('<svg class="download-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M4.5 7l3.5 3.5 3.5-3.5M3 13.5h10"/></svg><span>Download Model</span>'));
      }
    })().catch(err => console.error('[Popup] download click failed:', err)); });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => { (async () => {
      const selectedLocalModel = getSelectedLocalModel();
      if (!selectedLocalModel) {
        console.error('No local model selected');
        return;
      }

      retryBtn.disabled = true;
      retryBtn.replaceChildren(parseHTML('<svg class="download-icon animate-spin" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke-dasharray="28" stroke-dashoffset="10"/></svg><span>Retrying...</span>'));

      try {
        await chrome.runtime.sendMessage({ type: 'initializeLocalModel', modelId: selectedLocalModel.name });
      } catch (err) {
        console.error('Failed to retry model download:', err);
        retryBtn.disabled = false;
        retryBtn.replaceChildren(parseHTML('<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.5-3.8L2 6M2 2v4h4"/></svg><span>Retry</span>'));
      }
    })().catch(err => console.error('[Popup] retry click failed:', err)); });
  }

  const cancelBtn = document.getElementById('cancelLocalModelDownload') as HTMLButtonElement | null;
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => { (async () => {
      const selectedLocalModel = getSelectedLocalModel();
      if (!selectedLocalModel) return;

      cancelBtn.disabled = true;
      try {
        await chrome.runtime.sendMessage({ type: 'cancelLocalModelDownload', modelId: selectedLocalModel.name });
        // Cancelling also un-parks a pending "On-Device, once downloaded" choice
        // — otherwise the radio would stay grey-checked with nothing coming.
        await clearPendingLocalSelection();
        updateModelRadioUI();
        updateLocalModelSectionVisibility();
      } catch (err) {
        console.error('Failed to cancel download:', err);
      }
      cancelBtn.disabled = false;
    })().catch(err => console.error('[Popup] cancel download failed:', err)); });
  }
}

// Refresh model dropdown with current local model statuses
async function refreshModelDropdownWithLocal() {
  const data = await getStorage(['customModels', 'selectedModel']);
  renderModelDropdown(data.customModels || [], data.selectedModel || DEFAULT_MODEL);
}

async function handleShareFilters(): Promise<void> {
  const shareBtn = document.getElementById('shareFiltersBtn') as HTMLButtonElement | null;
  if (shareBtn) shareBtn.disabled = true;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    let triggeredInPage = false;

    if (activeTab?.id && activeTab.url && (activeTab.url.includes('x.com') || activeTab.url.includes('twitter.com'))) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'triggerShareFilterPack' });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (response?.success) {
          triggeredInPage = true;
        }
      } catch (err) {
        console.log('[Popup] Active tab content script did not process share request:', err);
      }
    }

    if (!triggeredInPage) {
      const storageData = await chrome.storage.local.get(null);
      const allPhrases = new Set<string>();
      for (const [key, value] of Object.entries(storageData)) {
        if (key.startsWith('descriptions_') && Array.isArray(value)) {
          (value as string[]).forEach(p => typeof p === 'string' && p.trim() && allPhrases.add(p.trim()));
        }
      }
      const phrases = Array.from(allPhrases);

      if (phrases.length === 0) {
        alert('No filter phrases found to share. Add some filter phrases first!');
        return;
      }

      const shareCode = await encodeFilterPackCode({ phrases });
      const shareUrl = buildFilterPackShareUrl(shareCode);
      const shareText = `I use Sieve to remove this from my feed.\n\n${shareUrl}`;
      const tweetIntentUrl = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}`;

      await chrome.tabs.create({ url: tweetIntentUrl });
    }
  } catch (err) {
    console.error('[Popup] handleShareFilters failed:', err);
  } finally {
    if (shareBtn) shareBtn.disabled = false;
  }
}

