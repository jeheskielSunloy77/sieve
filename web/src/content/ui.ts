// All UI injection, modals, alerts, theming, filter phrase management

import { toBlob } from 'html-to-image';
import { asyncHandler } from '../shared/async';
import { cleanReasoning, escapeHtml, formatPostForEvaluation, parseHTML, AI_DETECTION_SEED_PHRASE, phraseAddNeedsReEvaluation } from '../shared/utils';
import { getSieveLogoHTML, initLogoAnimation } from '../shared/logo';
import { init as initPopup } from '../popup/index';
import {
  encodeFilterPackCode, decodeFilterPackCode, buildFilterPackShareUrl,
  FILTER_PACK_SHARE_URL_REGEX,
} from '../shared/share-encoding';
import type { ContentUIDeps, FilteredPost, PostContent, LocalModelStatus } from '../types';
import { getStorage, setStorage, getDescriptions, setDescriptions, aiIntentActiveForSite } from '../shared/storage';
import { enabledStorageKey } from '../shared/platforms';
import { getReleaseNote } from './release-notes';
import { runIOSImportAnimation } from './ios';

const IS_DEV_BUILD = (process.env.SIEVE_ENV || process.env.POSTPATROL_ENV || '').toLowerCase() === 'dev';

// Dependencies (set by initUI from index.ts)
let _deps: ContentUIDeps;

export function initUI(deps: ContentUIDeps) {
  _deps = deps;

  // Safari re-injects content scripts when the user changes extension
  // permissions on a tab that's already loaded. The new injection has a
  // fresh module scope, so its filter-container variables are null and the
  // injection guards think no box exists — resulting in duplicate UI.
  // Proactively remove any leftover boxes from a prior injection.
  const stale = document.querySelectorAll(
    '.filter-phrases-sidebar, .filter-phrases-bottom, .filter-phrases-mobile, .filter-phrases-banner'
  );
  console.log('[Sieve] initUI: clearing', stale.length, 'stale filter box(es) from prior injection');
  stale.forEach((el) => el.remove());

  // Register the single page-wide tooltip-dismissal listener (replaces a
  // per-post capture-phase listener that used to accumulate with each post).
  setupAnnoyingTooltipCloser();
}



// ==================== UI State ====================

// Filtered posts storage
const filteredPosts: FilteredPost[] = [];
const filteredPostKeys = new Set<string>();

let filteredTabActive = false;
let filteredModalBackdrop: HTMLElement | null = null;
let filteredViewContainer: HTMLElement | null = null;
let filterPhrasesContainer: HTMLElement | null = null;
let bottomFilterContainer: HTMLElement | null = null;
let mobileFilterContainer: HTMLElement | null = null;
let bottomFilterExpanded = true;
let settingsModal: HTMLElement | null = null;


let activePopup: HTMLElement | null = null;
let activePopupArticle: HTMLElement | null = null;
// Persists across in-place re-renders so the user's tab selection isn't lost
// when a late-arriving detectorResponse triggers a refresh.
let activePopupTab: string | null = null;
let toastContainer: HTMLElement | null = null;
const annoyingReasonsCache: WeakMap<HTMLElement, Promise<{ reasons: string[]; hadImages?: boolean }>> = new WeakMap();

// Track previous count for animation
let previousFilteredCount = 0;

// Track current model loading state

// Track if we've shown the API key warning
let apiKeyWarningShown = false;



// ==================== Update Banner ====================

// Shows a "what's new" banner inside the filter box once per version.
// Reads release notes from src/shared/release-notes.ts. Dismissal writes
// `lastSeenVersion` to chrome.storage.local so the banner stays gone.
async function maybeRenderUpdateBanner(container: HTMLElement): Promise<void> {
  const slot = container.querySelector<HTMLElement>('.sieve-update-banner-slot, .postpatrol-update-banner-slot');
  if (!slot) return;

  const current = chrome.runtime.getManifest().version;
  const { lastSeenVersion } = await getStorage(['lastSeenVersion']);
  if (lastSeenVersion === current) return;

  const platform = _deps.IS_IOS ? 'ios' : 'desktop';
  const note = getReleaseNote(current, platform);
  if (!note) {
    // No notes for this version — silently advance so a future version still triggers.
    await setStorage({ lastSeenVersion: current });
    return;
  }

  const bulletsHTML = note.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('');
  const html = `
    <div class="sieve-update-banner postpatrol-update-banner" role="status">
      <button type="button" class="sieve-update-banner-close postpatrol-update-banner-close" aria-label="Dismiss">×</button>
      <div class="sieve-update-banner-title postpatrol-update-banner-title">${escapeHtml(note.title)}</div>
      <ul class="sieve-update-banner-bullets postpatrol-update-banner-bullets">${bulletsHTML}</ul>
    </div>
  `;
  slot.replaceChildren(parseHTML(html));

  const closeBtn = slot.querySelector<HTMLButtonElement>('.sieve-update-banner-close, .postpatrol-update-banner-close');
  closeBtn?.addEventListener('click', asyncHandler(async () => {
    await setStorage({ lastSeenVersion: current });
    document.querySelectorAll('.sieve-update-banner, .postpatrol-update-banner').forEach(el => el.remove());
  }));
}

// ==================== Placeholder animation ====================

const PLACEHOLDER_PHRASES = ['AI slop', 'politics', 'negativity', 'pessimism', 'political outrage', 'posts written by AI', 'ragebait', 'humblebragging', 'virtue signaling', 'idolizing elites', 'Elon Musk'];
const PLACEHOLDER_DURATION = 10; // seconds for full cycle

// Build placeholder HTML and inject dynamic keyframes once
const placeholderItemsHTML = [...PLACEHOLDER_PHRASES, PLACEHOLDER_PHRASES[0]]
  .map(p => `<span>${p}</span>`).join('');
const placeholderHTML = `<span class="filter-input-wrapper"><input type="text" class="filter-phrases-input"><span class="filter-placeholder-cycle" aria-hidden="true"><span class="filter-placeholder-track">${placeholderItemsHTML}</span></span></span>`;

const platformFilterSwitchHTML = `
  <label class="filter-platform-switch" title="Enable Sieve filtering on this site">
    <input class="filter-platform-switch-input" type="checkbox" role="switch" aria-label="Enable Sieve filtering on this site">
    <span class="filter-platform-switch-track" aria-hidden="true"><span class="filter-platform-switch-thumb"></span></span>
  </label>
`;

function injectPlaceholderKeyframes() {
  const n = PLACEHOLDER_PHRASES.length;
  const step = 100 / n;
  const holdPct = 0.8; // fraction of each step spent holding
  const frames: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = step * i;
    const holdEnd = start + step * holdPct;
    frames.push(`${start}%, ${holdEnd}% { transform: translateY(calc(-1.2em * ${i})); }`);
  }
  frames.push(`100% { transform: translateY(calc(-1.2em * ${n})); }`);
  const style = document.createElement('style');
  const duration = (PLACEHOLDER_DURATION / 5) * n; // scale with phrase count
  style.textContent = `
    @keyframes ff-placeholder-scroll { ${frames.join(' ')} }
    .filter-placeholder-track { animation-duration: ${duration}s; }
  `;
  document.head.appendChild(style);
}

// Inject keyframes on load
injectPlaceholderKeyframes();

// X-style horizontal ellipsis icon used by the settings button on the actions row.
const settingsIconSVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g><path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"></path></g></svg>';

// ==================== State Accessors ====================

export function getFilteredPosts() { return filteredPosts; }
export function getFilteredTabActive() { return filteredTabActive; }

// ==================== Filtered Posts ====================

export function clearFilteredPosts() {
  filteredPosts.length = 0;
  filteredPostKeys.clear();
  updateFilteredTabCount();
  // Re-render filtered view if it's currently showing
  if (filteredTabActive && filteredViewContainer) {
    const content = filteredViewContainer.querySelector('.filtered-modal-content');
    if (content) renderFilteredPostsView(content);
  }
}

export function restoreAllFilteredPosts(): void {
  document.querySelectorAll<HTMLElement>('[data-filtered-by-extension="true"]').forEach(container => {
    container.style.display = '';
    container.style.visibility = '';
    container.style.opacity = '';
    container.style.transition = '';
    delete container.dataset.filteredByExtension;
    container.querySelectorAll('.sieve-yt-placeholder, .postpatrol-yt-placeholder').forEach(placeholder => placeholder.remove());
  });
  _deps.findPosts().forEach(article => {
    article.style.opacity = '';
    article.style.transition = '';
    _deps.processedPosts.delete(article);
    _deps.pendingPosts.delete(article);
  });
  clearFilteredPosts();
}

// ==================== Theme ====================

export function updateTheme() {
  const theme = _deps.adapter.getThemeMode();
  const iosFilteredModal = document.querySelector('.ff-ios-filtered-modal-backdrop');
  const iosPageContainer = _deps.getIOSPageContainer();
  const elements = [filterPhrasesContainer, filteredViewContainer, bottomFilterContainer, mobileFilterContainer, iosPageContainer, iosFilteredModal].filter(Boolean) as Element[];

  for (const el of elements) {
    el.classList.remove('light-mode', 'dim-mode', 'dark-mode');
    el.classList.add(`${theme}-mode`);
  }

  // Also update the document element for CSS selectors that need it
  document.documentElement.classList.remove('twitter-light', 'twitter-dim', 'twitter-dark');
  document.documentElement.classList.add(`twitter-${theme}`);
}

// ==================== Sidebar Filter ====================

function updateSidebarFilterVisibility() {
  if (!filterPhrasesContainer || !filterPhrasesContainer.isConnected) return;

  if (!_deps.adapter.shouldProcessCurrentPage()) {
    filterPhrasesContainer.remove();
    filterPhrasesContainer = null;
  }
}

function buildFilterContainerHTML(): string {
  return `
    <div class="filter-phrases-container">
      <div class="sieve-update-banner-slot postpatrol-update-banner-slot"></div>
      <div class="filter-phrases-title-row">
        <span class="filter-phrases-box-name">
          <span class="sieve-logo-prefix" aria-hidden="true">${getSieveLogoHTML()}</span>
          <span>Sieve</span>
        </span>
        ${platformFilterSwitchHTML}
      </div>
      <div class="filter-phrases-header">
        <span class="filter-phrases-label">Filter out</span>
        <span class="filter-phrases-list"></span>
        <span class="filter-phrases-and-input">
          <span class="filter-phrases-and">and</span>
          ${placeholderHTML}
        </span>
      </div>
      <div class="filter-model-loading" style="display: none;">
        <div class="model-loading-text">Loading model...</div>
        <div class="model-loading-progress">
          <div class="model-loading-progress-fill"></div>
        </div>
      </div>
      <div class="filter-phrases-actions">
        <div class="filter-phrases-actions-left">
          <button class="filtered-toggle-btn">
            <span class="filtered-toggle-text">View filtered</span>
            <span class="filtered-toggle-count">(0)</span>
          </button>
        </div>
        <div class="filter-phrases-actions-right">
          <button class="filter-settings-btn" type="button" aria-label="Settings">${settingsIconSVG}</button>
        </div>
      </div>
    </div>
  `;
}

// Mirrors Twitter's fixed search-bar pattern. The filter box is `position: fixed`
// so it doesn't scroll with the page; we set width/left inline to match the
// sidebar wrapper, and add a sibling spacer whose height tracks the filter box
// so flow content (Premium, News) doesn't slide under us at scroll=0.
function setupFixedInWrapper(filterBox: HTMLElement, wrapper: HTMLElement): void {
  const spacer = document.createElement('div');
  spacer.className = 'filter-phrases-sidebar-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  filterBox.after(spacer);

  // Spacer is box height + a small gap. On Home, Twitter's search-bar
  // placeholder sits in flow above the box and absorbs the area between the
  // viewport top and the box's `top: 70px`; on Explore there's no placeholder
  // so we reserve ~70px more ourselves. Probe `hasSearchBar` live so SPA
  // navigation between Home and Explore swaps the gap correctly (the
  // wrapper-childList observer below re-runs this when Twitter mutates).
  const syncSpacerHeight = () => {
    const hasSearchBar = !!wrapper.querySelector('[data-testid="SearchBox_Search_Input"]');
    const gapBelow = hasSearchBar ? 17 : 87;
    spacer.style.height = `${filterBox.offsetHeight + gapBelow}px`;
  };
  const syncBoxPosition = () => {
    const rect = wrapper.getBoundingClientRect();
    filterBox.style.left = `${rect.left}px`;
    filterBox.style.width = `${rect.width}px`;
    // Wrapper's vertical position relative to viewport can change too (window
    // resize, header collapse), which affects the spacer height calculation.
    syncSpacerHeight();
  };
  syncSpacerHeight();
  syncBoxPosition();
  // Layout may not have settled when we measure synchronously inside a
  // MutationObserver callback (e.g. during SPA navigation, the box's content
  // hasn't laid out yet so its bounding-rect height is 0). Re-measure once a
  // frame after the browser has a chance to do layout.
  requestAnimationFrame(syncSpacerHeight);

  const boxResize = new ResizeObserver(syncSpacerHeight);
  boxResize.observe(filterBox);
  const wrapperResize = new ResizeObserver(syncBoxPosition);
  wrapperResize.observe(wrapper);
  // Wrapper's `left` can change without its size changing (window resize that
  // doesn't change the sidebar width but shifts it horizontally, e.g. when
  // the primary column gets narrower). Listen for window resize too.
  window.addEventListener('resize', syncBoxPosition);

  // Watch the wrapper's children: disconnect when our box leaves the DOM, and
  // otherwise re-sync the spacer. Twitter populates the wrapper asynchronously
  // on SPA navigation (e.g. Home → Explore → Home), so siblings can appear or
  // disappear around our spacer after we've already sized it — without this,
  // a stale measurement leaves news/premium content peeking under the box.
  const lifecycle = new MutationObserver(() => {
    if (!filterBox.isConnected) {
      boxResize.disconnect();
      wrapperResize.disconnect();
      lifecycle.disconnect();
      window.removeEventListener('resize', syncBoxPosition);
      spacer.remove();
      return;
    }
    syncSpacerHeight();
  });
  lifecycle.observe(filterBox.parentNode!, { childList: true });
}

// Twitter's right-sidebar wrapper that holds the scrolling content (Premium,
// News, Trending). On the Home page it also contains the fixed search bar at
// the top; on Explore the search bar lives in the main column instead, but the
// same wrapper is still the first child of sidebarContent. Returns the first
// non-Sieve child of sidebarContent.
function findSidebarWrapper(sidebarContent: Element): HTMLElement | null {
  for (const child of Array.from(sidebarContent.children)) {
    if (child instanceof HTMLElement
        && !child.classList.contains('filter-phrases-sidebar')) {
      return child;
    }
  }
  return null;
}

export function injectFilterPhrasesInput() {
  const existingInDom = document.querySelectorAll('.filter-phrases-sidebar').length;
  // Adopt any existing node in the DOM (may have been created by a previous
  // content-script injection whose module state is gone).
  if (!filterPhrasesContainer || !filterPhrasesContainer.isConnected) {
    filterPhrasesContainer = document.querySelector<HTMLElement>('.filter-phrases-sidebar');
  }
  if (filterPhrasesContainer && filterPhrasesContainer.isConnected) {
    console.log('[Sieve] injectFilterPhrasesInput: adopting existing box (DOM count=', existingInDom, ')');
    updateSidebarFilterVisibility();
    return;
  }
  console.log('[Sieve] injectFilterPhrasesInput: will create new box (DOM count before=', existingInDom, ')');

  // Don't inject on non-applicable pages
  if (!_deps.adapter.shouldProcessCurrentPage()) return;

  const sidebar = document.querySelector(_deps.adapter.selectors.sidebar);
  if (!sidebar) return;
  const sidebarContent = _deps.adapter.selectors.sidebarContent
    ? sidebar.querySelector(_deps.adapter.selectors.sidebarContent)
    : sidebar;
  if (!sidebarContent) return;

  // Preferred target: inside the sidebar wrapper so our z-index can sit between
  // the fixed search bar (z=2, Home only) and scrolling content (z=0). Falls
  // back to the top of sidebarContent if the wrapper can't be found.
  // LinkedIn Groups' legacy scaffold aside is itself the right-column wrapper;
  // its direct children are native cards. Treating the first card as the
  // wrapper would mount Sieve inside that card and inherit its clipping.
  const scaffoldAside = _deps.adapter.siteId === 'linkedin'
    && sidebarContent instanceof HTMLElement
    && sidebarContent.matches('.scaffold-layout__aside')
      ? sidebarContent
      : null;
  const wrapper = scaffoldAside ?? findSidebarWrapper(sidebarContent);
  let insertParent: Element;
  let insertBeforeRef: Node | null;
  let usingWrapper = false;
  if (wrapper) {
    // When the wrapper contains Twitter's fixed search bar (Home), insert AFTER
    // the search bar (children[0]) and its 53px spacer (children[1]) — i.e. as
    // the third child, before the Premium card. On Explore the search bar is
    // in the main column, so insert at the top of the wrapper.
    const hasSearchBar = !!wrapper.querySelector('[data-testid="SearchBox_Search_Input"]');
    const children = Array.from(wrapper.children);
    insertParent = wrapper;
    insertBeforeRef = hasSearchBar ? (children[2] ?? null) : (children[0] ?? null);
    usingWrapper = true;
  } else {
    insertParent = sidebarContent;
    insertBeforeRef = sidebarContent.firstChild;
  }
  // Create the filter phrases container
  filterPhrasesContainer = document.createElement('div');
  filterPhrasesContainer.className = usingWrapper
    ? 'filter-phrases-sidebar filter-phrases-sidebar--in-wrapper'
    : 'filter-phrases-sidebar';
  // linkedin adaptation: raise z-index so LinkedIn promoted/ad cards in the
  // right rail don't overlap the filter box.
  if (_deps.adapter.siteId === 'linkedin') {
    filterPhrasesContainer.classList.add('filter-phrases-sidebar--linkedin');
  }

  filterPhrasesContainer.replaceChildren(parseHTML(buildFilterContainerHTML()));

  // Insert at the chosen target (inside the wrapper, or fallback at top of sidebarContent)
  insertParent.insertBefore(filterPhrasesContainer, insertBeforeRef);
  if (usingWrapper && wrapper) setupFixedInWrapper(filterPhrasesContainer, wrapper);

  // Apply theme and update count
  updateTheme();
  updateFilteredTabCount();

  setupFilterBoxEventHandlers(filterPhrasesContainer);
  maybeRenderUpdateBanner(filterPhrasesContainer).catch(err =>
    console.error('[UI] maybeRenderUpdateBanner failed (sidebar):', err));

  // Update visibility based on current page
  updateSidebarFilterVisibility();
}

// Sync every AI-detection indicator on the page to the inferred AI-removal
// intent FOR THIS PLATFORM — the sparkle is on only when one of this
// platform's own phrases engages detection, so "AI slop" on X doesn't light
// LinkedIn's indicator. Called on filter-box setup and from the
// storage-change listener in content/index.ts whenever aiFilterIntent OR
// this platform's phrase list is written — any such write also clears the
// transient `pending` set by a click.
export async function refreshAiIndicatorUI(): Promise<void> {
  if (!_deps) return;
  const [data, sitePhrases] = await Promise.all([
    getStorage(['aiFilterIntent', 'aiIndicatorBadgeDismissed']),
    getDescriptions(_deps.descriptionsKey),
  ]);
  const on = aiIntentActiveForSite(data, sitePhrases);
  // First-run onboarding: the indicator wears a "REMOVE AI" pill badge until
  // the first time detection turns on, then reverts to the plain sparkle
  // forever (the dismissal is persisted, so toggling back off won't revive it).
  if (on && !data.aiIndicatorBadgeDismissed) {
    void setStorage({ aiIndicatorBadgeDismissed: true });
  }
  const showBadge = !on && !data.aiIndicatorBadgeDismissed;
  document.querySelectorAll<HTMLElement>('.filter-ai-indicator').forEach(row => {
    row.classList.toggle('on', on);
    row.classList.toggle('with-badge', showBadge);
    row.classList.remove('pending');
    row.title = on
      ? 'Removing AI-generated content — your filter phrases ask for it. Click to stop (removes those phrases).'
      : `Click to remove AI-generated content from your feed (adds the filter phrase "${AI_DETECTION_SEED_PHRASE}").`;
  });
}

// Toggle AI detection through the phrase mechanism — the indicator's click
// action. Per-platform, like the indicator itself. On → off: delete every
// phrase that enables AI detection from THIS platform's list (the intent
// state prunes instantly if the phrase exists nowhere else; other platforms
// keep their own state). Off → on: add the seed phrase to this platform's
// list; the backend judges it and the first response engages detection.
// `pending` bridges the round trip and is cleared by refreshAiIndicatorUI on
// the resulting state/phrase-list write. Exported for the iOS native sheet's
// sparkle indicator, which drives the same mechanism through the
// __ff_toggleAiDetection bridge (see content/ios.ts).
export async function toggleAiDetectionViaPhrases(): Promise<void> {
  document.querySelectorAll<HTMLElement>('.filter-ai-indicator')
    .forEach(el => el.classList.add('pending'));

  const [data, sitePhrases] = await Promise.all([
    getStorage(['aiFilterIntent']),
    getDescriptions(_deps.descriptionsKey),
  ]);
  const aiPhrases = data.aiFilterIntent?.aiPhrases;
  if (Array.isArray(aiPhrases) && aiPhrases.length > 0) {
    const aiKeys = new Set(aiPhrases.map(p => p.trim().toLowerCase()));
    const next = sitePhrases.filter(d => !aiKeys.has(d.trim().toLowerCase()));
    if (next.length !== sitePhrases.length) {
      await setDescriptions(_deps.descriptionsKey, next);
      syncFilterPhrases();
      return;
    }
  }
  await addFilterPhrase(AI_DETECTION_SEED_PHRASE);
}

// Common event handler setup for filter boxes (sidebar and bottom)
function setupFilterBoxEventHandlers(container: HTMLElement) {
  // Idempotency guard: a re-entrant inject (e.g. handleDOMMutation firing
  // mid-refresh) would otherwise attach two click handlers and every user
  // click would toggle the filtered modal on then immediately off.
  if ((container as HTMLElement & { __ffWired?: boolean }).__ffWired) return;
  (container as HTMLElement & { __ffWired?: boolean }).__ffWired = true;

  const logoSvg = container.querySelector<SVGSVGElement>('.sieve-logo-prefix svg.logo');
  if (logoSvg) {
    initLogoAnimation(logoSvg);
  }

  const phrasesListContainer = container.querySelector('.filter-phrases-list')!;
  const input = container.querySelector<HTMLInputElement>('.filter-phrases-input')!;
  const placeholderCycle = container.querySelector('.filter-placeholder-cycle');
  const toggleBtn = container.querySelector('.filtered-toggle-btn:not(.filter-pack-toggle-btn)')!;
  const settingsBtn = container.querySelector('.filter-settings-btn')!;

  const platformKey = enabledStorageKey(_deps.adapter.siteId);
  const platformSwitch = container.querySelector<HTMLInputElement>('.filter-platform-switch-input');
  getStorage([platformKey, 'selectedModel']).then(data => {
    const hasModel = typeof data.selectedModel === 'string' && data.selectedModel.trim().length > 0;
    const isEnabled = data[platformKey] !== false && hasModel;
    container.classList.toggle('filtering-disabled', !isEnabled);
    if (platformSwitch) platformSwitch.checked = isEnabled;
  }).catch(err => console.error('[UI] Failed to load platform filtering state:', err));

  platformSwitch?.addEventListener('click', asyncHandler<MouseEvent>(async (e) => {
    const { selectedModel } = await getStorage(['selectedModel']);
    const hasModel = typeof selectedModel === 'string' && selectedModel.trim().length > 0;
    if (!hasModel) {
      e.preventDefault();
      platformSwitch.checked = false;
      showSettingsModal('select-model');
      return;
    }
    await setStorage({ [platformKey]: platformSwitch.checked });
  }));

  platformSwitch?.addEventListener('change', asyncHandler(async () => {
    const { selectedModel } = await getStorage(['selectedModel']);
    const hasModel = typeof selectedModel === 'string' && selectedModel.trim().length > 0;
    if (!hasModel && platformSwitch.checked) {
      platformSwitch.checked = false;
      showSettingsModal('select-model');
      return;
    }
    await setStorage({ [platformKey]: platformSwitch.checked });
  }));

  // Show/hide animated placeholder based on input state and existing phrases
  function updatePlaceholderVisibility() {
    if (!placeholderCycle) return;
    const hasPhrases = phrasesListContainer.children.length > 0;
    const hasText = input.value.length > 0;
    placeholderCycle.classList.toggle('hidden', hasPhrases || hasText);
  }
  input.addEventListener('input', updatePlaceholderVisibility);

  // Settings button click
  settingsBtn.addEventListener('click', () => showSettingsModal());

  // Guest-trial notice: the CTA deep-links to the local model section of the
  // settings modal. If a local model is already driving filtering, the trial
  // pitch no longer applies — drop the notice.
  const trialNotice = container.querySelector<HTMLElement>('.ff-guest-trial-notice');
  if (trialNotice) {
    trialNotice.querySelector('.ff-local-model-cta')
      ?.addEventListener('click', () => showSettingsModal('local'));
    getStorage(['selectedModel']).then(({ selectedModel }) => {
      if ((selectedModel || '').startsWith('local:')) trialNotice.remove();
    }).catch(err => console.error('[UI] Failed to check selectedModel for trial notice:', err));
  }

  // Toggle filtered view on button click
  toggleBtn.addEventListener('click', () => {
    toggleFilteredTab(!filteredTabActive);
    updateFilteredToggleButtons();
  });

  // Load and render saved descriptions
  getDescriptions(_deps.descriptionsKey).then((descriptions) => {
    if (descriptions.length > 0) {
      renderPhrasesInContainer(phrasesListContainer, descriptions);
    }
  }).catch(err => console.error('[UI] Failed to load descriptions:', err));

  // Enter or comma key to add phrase
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      (async () => {
        const added = await addFilterPhrase(input.value.trim());
        if (added) input.value = '';
        updatePlaceholderVisibility();
      })().catch(err => console.error('[UI] filter phrase keypress handler failed:', err));
    }
  });

  // Handle pasting comma-separated lists
  input.addEventListener('paste', (e) => {
    const pasted = e.clipboardData!.getData('text');
    if (pasted.includes(',')) {
      e.preventDefault();
      (async () => {
        const phrases = pasted.split(',').map(s => s.trim()).filter(Boolean);
        for (const phrase of phrases) {
          await addFilterPhrase(phrase);
        }
        input.value = '';
        updatePlaceholderVisibility();
      })().catch(err => console.error('[UI] filter phrase paste handler failed:', err));
    }
  });

  // Update visibility based on current page
  updateSidebarFilterVisibility();
}

// ==================== Bottom Filter ====================

function toggleBottomFilter(expanded: boolean) {
  bottomFilterExpanded = expanded;

  if (bottomFilterContainer) {
    if (expanded) {
      bottomFilterContainer.classList.add('expanded');
      bottomFilterContainer.classList.remove('collapsed');
    } else {
      bottomFilterContainer.classList.remove('expanded');
      bottomFilterContainer.classList.add('collapsed');
    }
  }
}

function updateBottomFilterPosition() {
  if (!bottomFilterContainer || !bottomFilterContainer.isConnected) return;

  const primaryColumn = _deps.adapter.getPrimaryColumn?.()
    ?? document.querySelector(_deps.adapter.selectors.primaryColumn);
  if (primaryColumn) {
    const style = window.getComputedStyle(primaryColumn);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const rect = primaryColumn.getBoundingClientRect();

    bottomFilterContainer.classList.remove('filter-phrases-right-gutter');
    bottomFilterContainer.style.removeProperty('top');
    bottomFilterContainer.style.removeProperty('bottom');

    bottomFilterContainer.style.left = (rect.left + borderLeft) + 'px';
    bottomFilterContainer.style.width = (rect.width - borderLeft - borderRight) + 'px';
  }
}

function updateBottomFilterVisibility() {
  if (!bottomFilterContainer || !bottomFilterContainer.isConnected) return;

  if (!_deps.adapter.shouldProcessCurrentPage()) {
    bottomFilterContainer.remove();
    bottomFilterContainer = null;
  }
}

export function injectBottomFilterBox() {
  if (_deps.IS_IOS) return;
  const existingInDom = document.querySelectorAll('.filter-phrases-bottom').length;
  // Adopt any existing node left by a previous injection
  if (!bottomFilterContainer || !bottomFilterContainer.isConnected) {
    bottomFilterContainer = document.querySelector<HTMLElement>('.filter-phrases-bottom');
  }
  if (bottomFilterContainer && bottomFilterContainer.isConnected) {
    console.log('[Sieve] injectBottomFilterBox: adopting existing box (DOM count=', existingInDom, ')');
    updateBottomFilterVisibility();
    return;
  }

  // Don't inject on non-applicable pages
  if (!_deps.adapter.shouldProcessCurrentPage()) return;

  // Create the bottom filter container - just the pill itself
  bottomFilterContainer = document.createElement('div');
  bottomFilterContainer.className = 'filter-phrases-bottom expanded';

  bottomFilterContainer.replaceChildren(parseHTML(`
    <div class="filter-collapse-handle">
      <span class="filter-collapse-chevron"></span>
    </div>
    ${buildFilterContainerHTML()}
  `));

  // Append to body
  document.body.appendChild(bottomFilterContainer);

  // Position to match primary column and check visibility
  updateBottomFilterPosition();
  updateBottomFilterVisibility();
  // Update position on resize
  window.addEventListener('resize', updateBottomFilterPosition);
  // Also update position and visibility periodically (for SPA navigation that changes layout)
  const positionInterval = setInterval(() => {
    if (!bottomFilterContainer || !bottomFilterContainer.isConnected) {
      clearInterval(positionInterval);
      return;
    }
    updateBottomFilterPosition();
    updateBottomFilterVisibility();
  }, 500);

  // Apply theme and update count
  updateTheme();
  updateFilteredTabCount();

  setupFilterBoxEventHandlers(bottomFilterContainer);
  maybeRenderUpdateBanner(bottomFilterContainer).catch(err =>
    console.error('[UI] maybeRenderUpdateBanner failed (bottom):', err));

  // Toggle expand/collapse when clicking the collapse handle
  const collapseHandle = bottomFilterContainer.querySelector('.filter-collapse-handle')!;
  collapseHandle.addEventListener('click', () => {
    toggleBottomFilter(!bottomFilterExpanded);
  });
}

// ==================== Mobile Filter ====================

function updateMobileFilterVisibility() {
  if (!mobileFilterContainer || !mobileFilterContainer.isConnected) return;

  if (!_deps.adapter.shouldProcessCurrentPage()) {
    mobileFilterContainer.remove();
    mobileFilterContainer = null;
  }
}

export function injectMobileFilterBox() {
  if (_deps.IS_IOS) return;
  const existingInDom = document.querySelectorAll('.filter-phrases-mobile').length;
  // Adopt any existing node left by a previous injection
  if (!mobileFilterContainer || !mobileFilterContainer.isConnected) {
    mobileFilterContainer = document.querySelector<HTMLElement>('.filter-phrases-mobile');
  }
  if (mobileFilterContainer && mobileFilterContainer.isConnected) {
    console.log('[Sieve] injectMobileFilterBox: adopting existing box (DOM count=', existingInDom, ')');
    updateMobileFilterVisibility();
    return;
  }

  // Don't inject on non-applicable pages
  if (!_deps.adapter.shouldProcessCurrentPage()) return;

  // Find the navigation element
  const nav = document.querySelector(_deps.adapter.selectors.nav);
  if (!nav) return;

  // Create the mobile filter container
  mobileFilterContainer = document.createElement('div');
  mobileFilterContainer.className = 'filter-phrases-mobile';

  mobileFilterContainer.replaceChildren(parseHTML(buildFilterContainerHTML()));

  // Insert before the navigation element
  nav.parentNode!.insertBefore(mobileFilterContainer, nav);

  // Apply theme and update count
  updateTheme();
  updateFilteredTabCount();

  setupFilterBoxEventHandlers(mobileFilterContainer);
  maybeRenderUpdateBanner(mobileFilterContainer).catch(err =>
    console.error('[UI] maybeRenderUpdateBanner failed (mobile):', err));

  // Update visibility based on current page
  updateMobileFilterVisibility();
}

// ==================== Banner Filter ====================
// Used by platforms whose `filterBoxPlacement === 'banner'` (e.g. YouTube).
// Reuses the same `filterPhrasesContainer` slot as the Twitter sidebar variant
// so updateTheme(), syncFilterPhrases(), and refreshAllFilterBoxes() continue
// to find and update the active filter UI without special-casing each
// placement. The inserted node carries `.filter-phrases-banner` instead of
// `.filter-phrases-sidebar` so platform-specific CSS can style it differently.

function updateBannerFilterVisibility() {
  if (!filterPhrasesContainer || !filterPhrasesContainer.isConnected) return;
  if (!_deps.adapter.shouldProcessCurrentPage()) {
    filterPhrasesContainer.remove();
    filterPhrasesContainer = null;
    return;
  }
  // SPA navigation between two processable pages (e.g. YT home ↔ watch)
  // doesn't change `shouldProcessCurrentPage`, but `getFilterBoxAnchor`
  // can return a different parent per page (drawer on home, `#secondary`
  // on watch). When the box's current parent no longer matches the
  // adapter's chosen anchor, tear it down so `handleDOMMutation` can
  // re-inject at the right location.
  const expected = _deps.adapter.getFilterBoxAnchor?.();
  if (!expected) {
    if (_deps.adapter.siteId === 'threads') {
      filterPhrasesContainer.remove();
      filterPhrasesContainer = null;
    }
    return;
  }
  if (filterPhrasesContainer.parentElement !== expected.parent) {
    filterPhrasesContainer.remove();
    filterPhrasesContainer = null;
    return;
  }
  // Adapter pointed at the same parent, but YT may have inserted its own
  // widgets (e.g. the watch-page autoplay/next panel) above our box after
  // injection. Re-anchor so we stay at the top — needed for the sticky
  // positioning on the watch sidebar to land above YT's own header row.
  if (expected.insertBefore && filterPhrasesContainer !== expected.insertBefore
      && filterPhrasesContainer.previousElementSibling) {
    expected.parent.insertBefore(filterPhrasesContainer, expected.insertBefore);
  }
}

export function injectBannerFilterBox() {
  const adapter = _deps.adapter;
  if (!adapter.getFilterBoxAnchor) {
    console.warn('[Sieve] injectBannerFilterBox: adapter has no getFilterBoxAnchor');
    return;
  }

  // Adopt any existing banner from a prior content-script injection
  if (!filterPhrasesContainer || !filterPhrasesContainer.isConnected) {
    filterPhrasesContainer = document.querySelector<HTMLElement>('.filter-phrases-banner');
  }
  if (filterPhrasesContainer && filterPhrasesContainer.isConnected) {
    updateBannerFilterVisibility();
    return;
  }

  if (!adapter.shouldProcessCurrentPage()) return;

  const anchor = adapter.getFilterBoxAnchor();
  if (!anchor) return; // page chrome not ready yet — DOM observer will retry

  filterPhrasesContainer = document.createElement('div');
  filterPhrasesContainer.className = `filter-phrases-banner filter-phrases-banner--${adapter.siteId}`;

  filterPhrasesContainer.replaceChildren(parseHTML(buildFilterContainerHTML()));
  anchor.parent.insertBefore(filterPhrasesContainer, anchor.insertBefore);

  updateTheme();
  updateFilteredTabCount();

  setupFilterBoxEventHandlers(filterPhrasesContainer);
  maybeRenderUpdateBanner(filterPhrasesContainer).catch(err =>
    console.error('[UI] maybeRenderUpdateBanner failed (banner):', err));

  updateBannerFilterVisibility();
}

// ==================== Filter Phrases ====================

export function syncFilterPhrases() {
  getDescriptions(_deps.descriptionsKey).then((descriptions) => {

    // Update desktop/tablet/mobile containers
    [filterPhrasesContainer, bottomFilterContainer, mobileFilterContainer].forEach(container => {
      if (container && container.isConnected) {
        const phrasesListContainer = container.querySelector('.filter-phrases-list');
        if (phrasesListContainer) {
          renderPhrasesInContainer(phrasesListContainer, descriptions);
        }
      }
    });

    // Update iOS overlay categories if visible
    const iosPageContainer = _deps.getIOSPageContainer();
    if (iosPageContainer && iosPageContainer.isConnected) {
      _deps.renderIOSCategories(iosPageContainer);
    }
  }).catch(err => console.error('[UI] Failed to sync filter phrases:', err));
}

// ==================== Share Filter Pack ====================



let sharingFilterPackInProgress = false;

export async function shareFilterPack(container?: HTMLElement | null): Promise<void> {
  if (sharingFilterPackInProgress) return;
  sharingFilterPackInProgress = true;

  const box = container?.querySelector<HTMLElement>('.filter-phrases-container')
    || document.querySelector<HTMLElement>('.filter-phrases-container');

  if (!box) {
    try {
      await runShareFilterPackForIOS();
    } catch (err) {
      console.error('[Sieve] shareFilterPack fallback error:', err);
    } finally {
      sharingFilterPackInProgress = false;
    }
    return;
  }

  try {
    const file = await screenshotFilterBox(box);
    const sharedPhrases = await getDescriptions(_deps.descriptionsKey);
    const shareCode = await encodeFilterPackCode({ phrases: sharedPhrases });
    await openComposerWithImage(file, shareCode);
  } catch (err) {
    console.error('[Sieve] shareFilterPack error:', err);
  } finally {
    sharingFilterPackInProgress = false;
  }
}

async function screenshotFilterBox(box: HTMLElement): Promise<File> {
  box.classList.add('ff-capture');
  let blob: Blob | null;
  try {
    blob = await toBlob(box, {
      pixelRatio: Math.max(window.devicePixelRatio || 1, 3),
      cacheBust: true,
    });
  } finally {
    box.classList.remove('ff-capture');
  }
  if (!blob) throw new Error('html-to-image returned null');
  return new File([blob], 'sieve-filter-pack.png', { type: 'image/png' });
}

// iOS variant: there's no visible filter card on x.com when the iOS app's
// native sheet is the user's filter UI. We render an off-screen replica of
// the desktop card, screenshot it, and feed it into the same composer-paste
// flow the desktop "Share filters" button uses. The screenshot needs to look
// like what a desktop user would share, so we reuse buildFilterContainerHTML
// + the renderPhrasesInContainer pill rendering.
export async function shareFilterPackForIOS(): Promise<void> {
  if (sharingFilterPackInProgress) return;
  sharingFilterPackInProgress = true;
  try {
    await runShareFilterPackForIOS();
  } finally {
    sharingFilterPackInProgress = false;
  }
}

async function runShareFilterPackForIOS(): Promise<void> {
  const phrases = await getDescriptions(_deps.descriptionsKey);
  if (phrases.length === 0) throw new Error('No phrases to share');

  // Off-screen wrapper carries the theme class so .light-mode/.dark-mode
  // descendant selectors in content.css resolve correctly. position:fixed +
  // far-negative left keeps it out of the viewport without display:none,
  // which html-to-image needs in order to compute layout.
  //
  // Deliberately NOT using the .filter-phrases-sidebar/-bottom/-mobile class
  // here — content.css hides those on body.ff-ios, which would zero out the
  // screenshot. Side effect: the font-family rule at the top of content.css
  // is scoped to those same classes, so we inline the same stack here so the
  // screenshot doesn't fall back to the browser's serif default.
  const theme = _deps.adapter.getThemeMode();
  const wrapper = document.createElement('div');
  wrapper.className = `${theme}-mode`;
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-10000px';
  wrapper.style.top = '0';
  // 320px clipped the right-aligned "Settings" button at the desktop card's
  // gap+padding budget. 380px gives the actions row enough horizontal space
  // for "View filtered (N)" + "Share filters" + "Settings" without overflow.
  wrapper.style.width = '380px';
  wrapper.style.zIndex = '-1';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  wrapper.replaceChildren(parseHTML(buildFilterContainerHTML()));

  // Strip elements that don't belong in a shared screenshot — the AI-detection
  // indicator is personal state, not part of the filter pack identity.
  wrapper.querySelectorAll('.filter-ai-indicator').forEach(el => el.remove());

  const list = wrapper.querySelector<HTMLElement>('.filter-phrases-list');
  if (list) renderPhrasesInContainer(list, phrases);

  document.body.appendChild(wrapper);
  try {
    const box = wrapper.querySelector<HTMLElement>('.filter-phrases-container');
    if (!box) throw new Error('Off-screen filter container missing');
    const file = await screenshotFilterBox(box);
    const shareCode = await encodeFilterPackCode({ phrases });
    await openComposerOnMobile(file, shareCode);
  } finally {
    wrapper.remove();
  }
}

// Mobile X (iPhone WebView UA) renders the composer as a real <textarea>
// instead of the desktop DraftJS contenteditable, with no [role="dialog"]
// wrapper. Synthetic ClipboardEvents that work on the desktop composer don't
// update the textarea's React-tracked value, and the textarea won't accept
// pasted images at all. Set the value through the prototype's native setter
// (so React's value tracker sees the change) and attach the screenshot via
// the composer's hidden file input.
async function openComposerOnMobile(file: File, shareCode: string): Promise<void> {
  const composeLink = document.querySelector<HTMLElement>('a[href="/compose/post"]');
  if (!composeLink) throw new Error('Compose link not found on page');
  composeLink.click();

  const textbox = await waitForElement<HTMLTextAreaElement>('textarea[data-testid="tweetTextarea_0"]', 5000);
  if (!textbox) throw new Error('Compose textarea did not appear');

  // Image first: posting media after text on mobile X sometimes scrolls the
  // textarea on insertion, which can blur input focus mid-flow.
  await attachImageToMobileComposer(file);

  textbox.focus();
  const captionWithCode = `${SHARE_TWEET_TEXT}\n\n${buildFilterPackShareUrl(shareCode)}`;
  setReactTextareaValue(textbox, captionWithCode);
  textbox.dispatchEvent(new Event('input', { bubbles: true }));
}

// Update a React-controlled textarea's value via its prototype's native
// setter so React's value tracker registers the change. Direct assignment
// to .value is silently overwritten on the next render.
function setReactTextareaValue(el: HTMLTextAreaElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (desc?.set) {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
}

// Mobile X exposes a hidden <input type="file"> that the media button proxies
// through. Setting `.files` via DataTransfer + dispatching change is the same
// path that native picker → upload flow takes.
async function attachImageToMobileComposer(file: File): Promise<void> {
  const fileInput = await waitForElement<HTMLInputElement>(
    'input[type="file"][data-testid="fileInput"], input[type="file"][accept*="image"]',
    3000
  );
  if (!fileInput) {
    console.warn('[Sieve] Mobile composer file input not found — text-only share');
    return;
  }
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  // Give X's media-attach pipeline a tick to ingest the file before we move on
  // to setting the textarea value, which can otherwise race with the upload
  // taking focus.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

// Open the X composer and drop the image into it via a synthetic paste event
// on the composer's contenteditable. X's DraftJS composer runs its paste handler
// on any ClipboardEvent whose clipboardData carries a File, which is the same
// code path as a real Cmd-V of an image — so we just drive that path directly
// instead of fighting with React-controlled <input type="file"> semantics.
const SHARE_TWEET_TEXT = 'I use Sieve to remove this from my feed.';

async function openComposerWithImage(file: File, shareCode: string): Promise<void> {
  // Click the sidebar Post link the same way a user would — this triggers X's
  // React Router to open the composer as a modal overlay.
  const composeLink = document.querySelector<HTMLElement>('a[href="/compose/post"]');
  if (!composeLink) throw new Error('Compose link not found on page');
  composeLink.click();

  // Scope to the modal dialog — on /home there's also an inline "What's
  // happening?" composer with the same tweetTextarea_0 testid earlier in the
  // DOM, which would otherwise win the querySelector race and steal the paste.
  const textbox = await waitForElement<HTMLElement>('[role="dialog"] [data-testid="tweetTextarea_0"]', 5000);
  if (!textbox) throw new Error('Compose textbox did not appear');

  textbox.focus();

  // Paste image first, then text — DraftJS' paste handler is more reliable
  // with one data type at a time than with a combined file + text/plain
  // payload, which some builds only read one of.
  const imageDt = new DataTransfer();
  imageDt.items.add(file);
  textbox.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: imageDt,
    bubbles: true,
    cancelable: true,
  }));

  // Let DraftJS finish ingesting the image before the text paste — mixing the
  // two synchronously can make the text land inside the media-attach flow.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  textbox.focus();
  const shareUrl = buildFilterPackShareUrl(shareCode);
  const captionWithCode = `${SHARE_TWEET_TEXT}\n\n${shareUrl}`;
  const textDt = new DataTransfer();
  textDt.setData('text/plain', captionWithCode);
  textbox.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: textDt,
    bubbles: true,
    cancelable: true,
  }));
}

function waitForElement<T extends Element>(selector: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector<T>(selector);
    if (existing) { resolve(existing); return; }
    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

// ==================== Import Shared Filter Packs ====================

// Tracks tweetText elements we've already swapped a button into so MutationObservers
// don't re-wrap on every React re-render. WeakMap auto-cleans when the tweet element
// leaves the DOM (recycled by Twitter's virtualizer).
const processedImportElements = new WeakSet<HTMLElement>();

// Scan a tweet's text for a filter-pack share URL and, if found,
// replace the link (and its leading sentence) with a compact "Import filter
// pack" button. No-op if the tweet has no link or we've already handled it.
export function processImportCodeInPost(article: HTMLElement): void {
  const tweetTextEls = article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]');
  for (const tweetText of tweetTextEls) {
    if (processedImportElements.has(tweetText)) continue;
    const found = findFirstImportLink(tweetText);
    if (!found) {
      // No link in the visible text, but the sentence's opening words might
      // still be visible before a "Show more" truncation — if so, click it so
      // the full tweet (with the link) lands in the DOM and the next observer
      // pass picks it up. We don't mark processedImportElements here, on
      // purpose, so re-scanning works after X re-renders the expanded text.
      maybeExpandForImportCode(article, tweetText);
      continue;
    }
    processedImportElements.add(tweetText);
    // Decode async; if decoding fails we leave the original text alone.
    decodeFilterPackCode(found.code).then((pack) => {
      if (!pack) return;
      if (!tweetText.isConnected || !found.link.isConnected) return;
      swapImportSentenceForButton(found.link, pack.phrases);
    }).catch((err) => console.error('[Sieve] decodeFilterPackCode failed:', err));
  }
}

// Derive a short signature from SHARE_TWEET_TEXT — the prose the share flow
// always writes before the link — so a partial view (truncated by X's "Show
// more") is still recognizable as the share format and worth expanding. First
// four words are distinctive enough to avoid accidental matches.
const IMPORT_SENTENCE_SIGNATURE = SHARE_TWEET_TEXT.split(' ').slice(0, 4).join(' ');

function maybeExpandForImportCode(article: HTMLElement, tweetText: HTMLElement): void {
  const visible = tweetText.textContent || '';
  if (!visible.includes(IMPORT_SENTENCE_SIGNATURE)) return;
  const showMore = article.querySelector<HTMLElement>('[data-testid="tweet-text-show-more-link"]');
  if (!showMore) return;
  // One-shot per article — don't re-click if the first expansion already
  // happened (even if the re-rendered DOM somehow still includes a "Show more").
  if (article.dataset.sieveExpandedForImport || article.dataset.postpatrolExpandedForImport) return;
  article.dataset.sieveExpandedForImport = '1';
  article.dataset.postpatrolExpandedForImport = '1';
  showMore.click();

  // X expands the tweet by mutating text nodes inside the existing tweetText
  // element. Our page-level MutationObserver filters to ELEMENT_NODE additions
  // so it misses those, which is why the button didn't appear after the first
  // click. Poll the article for a short window and re-run the transform until
  // the import button lands (or we time out if the expansion never happens —
  // e.g. X navigated to the status page instead).
  let attempts = 0;
  const tick = () => {
    if (++attempts > 30) return; // ~3s at 100ms per tick
    if (!article.isConnected) return;
    if (article.querySelector('.sieve-import-btn, .postpatrol-import-btn')) return;
    processImportCodeInPost(article);
    setTimeout(tick, 100);
  };
  setTimeout(tick, 50);
}

// Scan <a> elements within `root` for a sieve filter-pack share URL.
// Twitter splits the rendered URL across plain text and aria-hidden spans, but
// `innerText` reads them all back as a single string (with stray newlines from
// the inline-block layout that we strip before matching).
function findFirstImportLink(
  root: HTMLElement,
): { code: string; link: HTMLAnchorElement } | null {
  const links = root.querySelectorAll<HTMLAnchorElement>('a');
  for (const link of links) {
    const text = (link.innerText || '').replace(/\n/g, '');
    const m = FILTER_PACK_SHARE_URL_REGEX.exec(text);
    if (m) return { code: m[1], link };
  }
  return null;
}

// Replace the share <a> with the Import button and trim surrounding whitespace
// / <br>s so the button doesn't float on its own line with a visually empty
// gap above. The tweet's preceding prose stays untouched.
function swapImportSentenceForButton(
  link: HTMLAnchorElement,
  phrases: string[],
): void {
  const parent = link.parentNode;
  if (!parent) return;

  const btn = buildImportButton(phrases);
  parent.replaceChild(btn, link);

  // Clean up leading whitespace / <br>s immediately before the button.
  let prev = btn.previousSibling;
  while (prev) {
    if (prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === 'BR') {
      const toRemove = prev;
      prev = prev.previousSibling;
      toRemove.parentNode?.removeChild(toRemove);
      continue;
    }
    if (prev.nodeType === Node.TEXT_NODE) {
      const t = prev as Text;
      const trimmed = t.data.replace(/\s+$/, '');
      if (trimmed.length < t.data.length) t.data = trimmed;
      if (t.data.length === 0) {
        const toRemove = t;
        prev = t.previousSibling;
        toRemove.parentNode?.removeChild(toRemove);
        continue;
      }
    }
    break;
  }
}

function buildImportButton(phrases: string[]): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sieve-import-btn postpatrol-import-btn';
  btn.setAttribute('aria-label', 'Import filter pack');
  const phraseCount = phrases.length;
  btn.replaceChildren(parseHTML(`<span>Import filter pack</span><span class="sieve-import-btn-meta postpatrol-import-btn-meta">${phraseCount} ${phraseCount === 1 ? 'phrase' : 'phrases'}</span>`));
  btn.addEventListener('click', (e) => {
    // Stop the click from falling through to the tweet's own click handler
    // (which would navigate into the tweet's permalink page).
    e.stopPropagation();
    e.preventDefault();
    const article = btn.closest<HTMLElement>('article');
    if (_deps.IS_IOS) {
      // The native FAB lives outside the WebView, so the desktop "fly the
      // tweet image into the on-page Sieve box" choreography doesn't
      // translate. ios.ts owns the iOS-specific genie animation; we just
      // hand it the article + the import callback.
      runIOSImportAnimation(article, () => confirmAndImportPack(phrases)).catch((err) =>
        console.error('[Sieve] import failed:', err),
      );
    } else {
      flyScreenshotAndImport(article, phrases).catch((err) =>
        console.error('[Sieve] import failed:', err),
      );
    }
  });
  return btn;
}

// Three Sieve layout variants live in the DOM at all times — sidebar (wide),
// bottom (medium), mobile (narrow) — and media queries display:none all but
// one. Returns the variant that's currently rendered so the import-flight
// animation lands on a real, on-screen box. checkVisibility() rather than
// offsetParent: offsetParent is also null for position:fixed elements, which
// misread the bottom pill (position: fixed) as hidden and silently skipped
// the animation at medium window widths.
function pickVisibleSieveLayout(): HTMLElement | null {
  const layouts = document.querySelectorAll<HTMLElement>(
    '.filter-phrases-sidebar, .filter-phrases-bottom, .filter-phrases-mobile, .filter-phrases-banner',
  );
  for (const layout of layouts) {
    // Older Safari (<17.4) lacks checkVisibility — fall back to the
    // offsetParent test there (its known fixed-position blind spot included).
    const visible = typeof layout.checkVisibility === 'function'
      ? layout.checkVisibility()
      : layout.offsetParent !== null;
    if (visible) return layout;
  }
  return null;
}

// Animate the tweet's screenshot image flying into the user's Sieve box,
// then run the actual import. The flight takes ~700ms; we kick the storage
// writes off in parallel so the new phrases land in the box right as the
// flier dissolves into it. Falls back to a plain import (no animation) if we
// can't find either the source image or the destination box.
async function flyScreenshotAndImport(
  article: HTMLElement | null,
  phrases: string[],
): Promise<void> {
  console.log('[Sieve/import-anim] click', { hasArticle: !!article, phraseCount: phrases.length });

  // Three layout variants live in the DOM simultaneously (sidebar, bottom,
  // mobile); media queries display:none all but the active one. Pick the
  // visible variant via offsetParent — querySelectorAll('.filter-phrases-
  // container') would return the first in document order, which is often a
  // hidden one with a zero-size rect.
  const visibleLayout = pickVisibleSieveLayout();
  const containerInLayout = visibleLayout?.querySelector<HTMLElement>('.filter-phrases-container') ?? null;
  // Use the container when it has real dimensions; otherwise the layout pill
  // (.filter-phrases-bottom collapses its inner container to max-height: 0,
  // but the outer pill is still on screen and is what the user perceives as
  // "the Sieve UI").
  const containerRect = containerInLayout?.getBoundingClientRect();
  const useContainer = containerInLayout && containerRect && containerRect.height >= 24 && containerRect.width >= 24;
  const destEl: HTMLElement | null = useContainer ? containerInLayout : visibleLayout;

  const tweetPhotoImg = article?.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img') ?? null;
  const twimgImg = article?.querySelector<HTMLImageElement>('img[src*="pbs.twimg.com/media"]') ?? null;
  const tweetImg = tweetPhotoImg ?? twimgImg;

  console.log('[Sieve/import-anim] lookups', {
    visibleLayoutClass: visibleLayout?.className,
    containerInLayoutFound: !!containerInLayout,
    containerRect: containerRect ? { w: containerRect.width, h: containerRect.height } : null,
    chosenDestKind: destEl === containerInLayout ? 'container' : destEl ? 'layout-pill' : 'none',
    tweetPhotoImgFound: !!tweetPhotoImg,
    twimgImgFound: !!twimgImg,
    tweetImgSrc: tweetImg?.src,
    articleImgCount: article?.querySelectorAll('img').length,
  });

  if (!destEl || !tweetImg) {
    console.log('[Sieve/import-anim] bailing — falling back to plain import', {
      reason: !destEl ? 'no visible Sieve layout on screen' : 'no tweet image found in article',
    });
    await confirmAndImportPack(phrases);
    return;
  }

  const sourceRect = tweetImg.getBoundingClientRect();
  const destRect = destEl.getBoundingClientRect();
  console.log('[Sieve/import-anim] rects', {
    source: { x: sourceRect.left, y: sourceRect.top, w: sourceRect.width, h: sourceRect.height },
    dest: { x: destRect.left, y: destRect.top, w: destRect.width, h: destRect.height },
  });

  if (sourceRect.width < 4 || destRect.width < 4) {
    console.log('[Sieve/import-anim] bailing — degenerate rect', {
      sourceWidth: sourceRect.width,
      destWidth: destRect.width,
    });
    await confirmAndImportPack(phrases);
    return;
  }
  console.log('[Sieve/import-anim] starting flight');

  const flier = document.createElement('div');
  flier.className = 'sieve-import-flier postpatrol-import-flier';
  Object.assign(flier.style, {
    position: 'fixed',
    left: `${sourceRect.left}px`,
    top: `${sourceRect.top}px`,
    width: `${sourceRect.width}px`,
    height: `${sourceRect.height}px`,
    zIndex: '2147483646',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    willChange: 'transform, opacity',
    borderRadius: '14px',
    overflow: 'hidden',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45)',
  } satisfies Partial<CSSStyleDeclaration>);

  const imgClone = document.createElement('img');
  imgClone.src = tweetImg.src;
  imgClone.alt = '';
  imgClone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  flier.appendChild(imgClone);
  document.body.appendChild(flier);

  // Hide the source image during the flight so the screenshot doesn't appear
  // to be in two places at once.
  const originalSourceVis = tweetImg.style.visibility;
  tweetImg.style.visibility = 'hidden';

  const dx = destRect.left - sourceRect.left;
  const dy = destRect.top - sourceRect.top;
  const sx = destRect.width / sourceRect.width;
  const sy = destRect.height / sourceRect.height;

  // Run the storage writes alongside the animation so the new phrases appear
  // in the destination box right as the flier reaches it. Errors during the
  // import are surfaced by the outer catch via the click handler.
  const importPromise = confirmAndImportPack(phrases);

  const flightMs = 720;
  const animation = flier.animate(
    [
      { transform: 'translate(0, 0) scale(1, 1)', opacity: 1, filter: 'blur(0px)' },
      // Mid-flight: lift slightly off the original path with a soft bloom so
      // the eye reads it as movement rather than a linear lerp.
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - Math.min(80, Math.abs(dy) * 0.2)}px) scale(${(1 + sx) / 2}, ${(1 + sy) / 2})`, opacity: 0.95, filter: 'blur(0px)', offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0, filter: 'blur(2px)' },
    ],
    { duration: flightMs, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' },
  );

  try {
    await animation.finished;
  } catch {
    // Animation can be canceled if the page navigates mid-flight — fall through
    // and ensure cleanup still runs.
  }
  flier.remove();
  tweetImg.style.visibility = originalSourceVis;

  // Brief pulse on the destination so the user's eye lands on the place where
  // the new pack just appeared.
  destEl.classList.add('sieve-import-landing', 'postpatrol-import-landing');
  setTimeout(() => destEl.classList.remove('sieve-import-landing', 'postpatrol-import-landing'), 700);

  // Make sure storage writes are surfaced before we return so callers see real
  // failures and not a silently-completed flight.
  await importPromise;
}

async function confirmAndImportPack(phrases: string[]): Promise<void> {
  const existing = await getDescriptions(_deps.descriptionsKey);
  const newPhrases = phrases.filter(p => !existing.includes(p));
  if (newPhrases.length === 0) return;
  const next = [...existing, ...newPhrases];
  await setDescriptions(_deps.descriptionsKey, next);
  syncFilterPhrases();
  // Push the new phrase list to the native iOS filter sheet — without this the
  // native @Published phrases array stays at its pre-import snapshot until the
  // user opens & closes the sheet.
  if (_deps.IS_IOS) _deps.updateIOSFilteredCount();
  // Same seed-phrase exception as addFilterPhrase: a pack consisting solely
  // of the seed phrase engages the detectors via aiFilterIntent, not a sweep.
  const { aiFilterIntent } = await getStorage(['aiFilterIntent']);
  if (phraseAddNeedsReEvaluation(existing, next, aiFilterIntent?.aiPhrases)) {
    _deps.reEvaluateAllPosts();
  }
}

function renderPhrasesInContainer(container: Element, descriptions: string[]) {
  container.replaceChildren();
  const len = descriptions.length;
  descriptions.forEach((desc, index) => {
    const phrase = document.createElement('span');
    phrase.className = 'filter-phrase-inline';
    phrase.textContent = desc;
    phrase.title = 'Click to remove';
    phrase.addEventListener('click', asyncHandler(() => removeFilterPhrase(desc)));
    container.appendChild(phrase);

    if (index < len - 1) {
      const separator = document.createElement('span');
      separator.className = 'filter-phrase-separator';
      separator.textContent = ', ';
      container.appendChild(separator);
    } else if (len > 1) {
      // Oxford comma before "and" (which lives in the wrapper element)
      const separator = document.createElement('span');
      separator.className = 'filter-phrase-separator';
      separator.textContent = ', ';
      container.appendChild(separator);
    }
  });

  // Hide placeholder when there are any phrases
  const placeholderCycle = container.parentElement?.querySelector('.filter-placeholder-cycle');
  if (placeholderCycle) {
    placeholderCycle.classList.toggle('hidden', len > 0);
  }
}

const MAX_CATEGORIES_LENGTH = 1000;

export async function addFilterPhrase(text: string) {
  console.log('[Sieve] addFilterPhrase called with:', text);
  if (!text) return false;

  try {
    const descriptions = await getDescriptions(_deps.descriptionsKey);
    console.log('[Sieve] Current descriptions:', descriptions);

    if (descriptions.includes(text)) { console.log('[Sieve] Already exists'); return false; }

    // Check total character length with the new phrase
    const totalLength = [...descriptions, text].reduce((sum, d) => sum + d.length, 0);
    if (totalLength > MAX_CATEGORIES_LENGTH) {
      showCategoryLimitWarning();
      return false;
    }

    const next = [...descriptions, text];
    console.log('[Sieve] Saving descriptions:', next);
    await setDescriptions(_deps.descriptionsKey, next);
    console.log('[Sieve] addFilterPhrase complete');
    syncFilterPhrases();
    // Planting the seed phrase alone must not sweep — it is not a filter
    // category, and the aiFilterIntent write it provokes triggers the sweep
    // that engages the detectors (see the storage listener in content/index.ts).
    const { aiFilterIntent } = await getStorage(['aiFilterIntent']);
    if (phraseAddNeedsReEvaluation(descriptions, next, aiFilterIntent?.aiPhrases)) {
      _deps.reEvaluateAllPosts();
    }
    return true;
  } catch (err) {
    console.error('[Sieve] addFilterPhrase error:', err);
    return false;
  }
}

export async function removeFilterPhrase(phrase: string) {
  const descriptions = await getDescriptions(_deps.descriptionsKey);
  if (!descriptions.includes(phrase)) {
    syncFilterPhrases();
    return;
  }
  await setDescriptions(_deps.descriptionsKey, descriptions.filter((d: string) => d !== phrase));
  clearFilteredPosts();
  syncFilterPhrases();
}

// ==================== Settings Modal ====================

// `section: 'local'` deep-links to the local model setup: the popup sees the
// #local hash and preselects the Local radio so its download section is
// immediately visible.
// `section: 'select-model'` deep-links to the model combobox and prompts the
// user to choose an AI model before activating filtering.
export function showSettingsModal(section?: 'local' | 'select-model') {
  // Remove existing modal if any
  if (settingsModal && settingsModal.isConnected) {
    settingsModal.remove();
  }

  // Create modal overlay
  settingsModal = document.createElement('div');
  settingsModal.className = 'settings-modal-overlay';

  // Declare iframe outside branches so message handler can access it
  let iframe: HTMLIFrameElement | undefined;

  // In-app mode (WKWebView): inject popup directly into DOM
  const popup = window.__sievePopup || window.__postpatrolPopup || window.__feedfilterPopup;
  if (chrome._polyfilled && popup) {

    // Inject popup CSS once (rewrite body.X-mode selectors to target container div)
    if (!document.getElementById('ff-popup-styles')) {
      const style = document.createElement('style');
      style.id = 'ff-popup-styles';
      style.textContent = popup.css
        .replace(/body\.dark-mode/g, '.settings-modal-iframe.dark-mode')
        .replace(/body\.dim-mode/g, '.settings-modal-iframe.dim-mode')
        .replace(/body\.light-mode/g, '.settings-modal-iframe.light-mode')
        .replace(/body\.modal-mode/g, '.settings-modal-iframe');
      document.head.appendChild(style);
    }

    // Create container with popup HTML
    const container = document.createElement('div');
    container.className = 'settings-modal-iframe';
    container.replaceChildren(parseHTML(popup.html));
    container.style.overflow = 'auto';

    // Show close button (modal mode)
    const closeBtnEl = container.querySelector<HTMLElement>('.modal-close-btn');
    if (closeBtnEl) closeBtnEl.style.display = 'block';

    // Wire up close button
    const modalCloseBtn = container.querySelector('#modalCloseBtn');
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => closeSettingsModal());
    }

    // Apply theme
    const theme = _deps.adapter.getThemeMode();
    container.classList.add(theme + '-mode');

    settingsModal.appendChild(container);
    document.body.appendChild(settingsModal);

    // Trigger animation after append
    requestAnimationFrame(() => {
      settingsModal!.classList.add('visible');
    });

    if (section) {
      window.location.hash = `#${section}`;
    }

    // Run popup JS directly via import (no eval)
    initPopup().catch((e: Error) => {
      console.error('[Sieve] Error running popup init:', e, e.stack);
    });
  } else {
    // Extension mode: load popup.html in iframe
    iframe = document.createElement('iframe');
    iframe.className = 'settings-modal-iframe';
    iframe.src = chrome.runtime.getURL('popup.html') + (section ? `#${section}` : '');

    // Send current theme to iframe once it loads
    iframe.addEventListener('load', () => {
      const theme = _deps.adapter.getThemeMode();
      iframe!.contentWindow!.postMessage({ type: 'setTheme', theme }, '*');
    });

    settingsModal.appendChild(iframe);
    document.body.appendChild(settingsModal);
  }

  // Listen for messages from iframe
  let hasResized = false;
  const messageHandler = (event: MessageEvent<{ type?: string; height?: number }>) => {
    if (!event.data) return;
    if (event.data.type === 'closeSettingsModal') {
      closeSettingsModal();
      window.removeEventListener('message', messageHandler);
    } else if (event.data.type === 'settingsResize' && iframe) {
      if (!hasResized) {
        // First resize: set height without transition, then fade in
        hasResized = true;
        iframe.style.transition = 'transform 0.2s ease';
        iframe.style.height = event.data.height + 'px';
        requestAnimationFrame(() => {
          settingsModal!.classList.add('visible');
          // Re-enable height transitions for subsequent resizes
          setTimeout(() => {
            if (iframe) iframe.style.transition = '';
          }, 200);
        });
      } else {
        iframe.style.height = event.data.height + 'px';
      }
    }
  };
  window.addEventListener('message', messageHandler);

  // Close on overlay click (but not iframe click)
  const modal = settingsModal;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeSettingsModal();
    }
  });

  // Close on escape key
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeSettingsModal() {
  if (settingsModal && settingsModal.isConnected) {
    settingsModal.classList.remove('visible');
    setTimeout(() => {
      if (settingsModal && settingsModal.isConnected) {
        settingsModal.remove();
      }
      settingsModal = null;
    }, 200);
  } else {
    settingsModal = null;
  }
}

// ==================== Filtered Toggle Buttons ====================

export function updateFilteredToggleButtons() {
  const containers = [filterPhrasesContainer, bottomFilterContainer, mobileFilterContainer];
  containers.forEach(container => {
    if (container && container.isConnected) {
      const toggleBtn = container.querySelector('.filtered-toggle-btn:not(.filter-pack-toggle-btn)');
      if (toggleBtn) {
        if (filteredTabActive) {
          toggleBtn.classList.add('active');
        } else {
          toggleBtn.classList.remove('active');
        }
      }
    }
  });
}

export function updateFilteredTabCount() {
  const newCount = filteredPosts.length;
  const countText = `(${newCount})`;
  const shouldAnimate = newCount > previousFilteredCount;
  previousFilteredCount = newCount;

  // Publish the count in two places so platform adapters can stay in sync:
  //   1. A data attribute on `document.documentElement` — the persistent
  //      mirror. Newly-injected consumers (e.g. YT's mini-guide badge
  //      that gets created late) can read the current value directly.
  //   2. A CustomEvent — the change notifier. Consumers already in place
  //      re-render in response.
  // `filteredPosts.length` remains the single source of truth; these are
  // just publish surfaces.
  document.documentElement.dataset.sieveFilteredCount = String(newCount);
  document.documentElement.dataset.postpatrolFilteredCount = String(newCount);
  document.dispatchEvent(new CustomEvent('sieve:filtered-count-changed', {
    detail: { count: newCount, animate: shouldAnimate },
  }));
  document.dispatchEvent(new CustomEvent('postpatrol:filtered-count-changed', {
    detail: { count: newCount, animate: shouldAnimate },
  }));

  const containers = [filterPhrasesContainer, bottomFilterContainer, mobileFilterContainer];
  containers.forEach(container => {
    if (container && container.isConnected) {
      const countEl = container.querySelector('.filtered-toggle-count');
      if (countEl) {
        countEl.textContent = countText;
        if (shouldAnimate) {
          countEl.classList.remove('bump');
          void (countEl as HTMLElement).offsetWidth;
          countEl.classList.add('bump');
        }
      }
    }
  });

  // Also update iOS overlay "View filtered (N)" button
  _deps.updateIOSFilteredCount();

  // Update FAB badge
  const ffFabButton = _deps.getFFFabButton();
  if (ffFabButton && ffFabButton.isConnected) {
    const badge = ffFabButton.querySelector<HTMLElement>('.ff-fab-badge');
    if (badge) {
      badge.textContent = String(newCount);
      badge.style.display = newCount > 0 ? '' : 'none';
      if (shouldAnimate) {
        ffFabButton.classList.remove('ff-fab-bounce');
        void ffFabButton.offsetWidth;
        ffFabButton.classList.add('ff-fab-bounce');
      }
    }
  }
}

// ==================== Model Loading Progress ====================

export function updateModelLoadingProgress(statuses: Record<string, LocalModelStatus>, selectedModel: string) {
  const containers = [filterPhrasesContainer, bottomFilterContainer, mobileFilterContainer];

  const isLocalModel = selectedModel && selectedModel.startsWith('local:');
  if (!isLocalModel) {
    containers.forEach(container => {
      if (container && container.isConnected) {
        const loadingEl = container.querySelector<HTMLElement>('.filter-model-loading');
        if (loadingEl) loadingEl.style.display = 'none';
      }
    });

    return;
  }

  const modelId = selectedModel.split(':')[1];
  const status = statuses[modelId];

  if (!status) return;

  // The in-feed indicator is only for the multi-GB first download — the one
  // slow operation with real progress to report. Everything else stays
  // silent by design:
  //   - 'cached' is the dormant "downloaded but not loaded" state the engine
  //     rests in after its idle unload; nothing is in flight.
  //   - 'initializing' covers cache reloads (a few seconds of streaming the
  //     model from Cache Storage into the GPU, no incremental progress) —
  //     the per-post processing indicator already conveys activity there.
  // The runtime only emits download-progress events from the real network
  // path (see fetchAndCacheModel), so 'downloading' means a genuine download.
  // The popup shows its own badge for the other states.
  const isLoading = status.state === 'downloading';

  containers.forEach(container => {
    if (container && container.isConnected) {
      const loadingEl = container.querySelector<HTMLElement>('.filter-model-loading');
      if (!loadingEl) return;

      if (isLoading) {
        loadingEl.style.display = 'block';
        const textEl = loadingEl.querySelector('.model-loading-text')!;
        const fillEl = loadingEl.querySelector<HTMLElement>('.model-loading-progress-fill')!;

        textEl.textContent = status.text || 'Downloading on-device model...';
        fillEl.style.width = `${(status.progress || 0) * 100}%`;
      } else {
        loadingEl.style.display = 'none';
      }
    }
  });

}

export function initModelLoadingListener() {
  // Cache the selected model so download-progress events render synchronously
  // from changes.newValue. During a model download, localModelStatuses writes
  // fire many times per second; the previous getStorage() round-trip per
  // event queued behind that write flood, so the in-feed bar only caught up
  // in visible clumps. (The popup renders straight from the event payload,
  // which is why it was smooth while the in-feed bar was chunky.)
  let selectedModel = '';

  // Get initial state
  getStorage(['localModelStatuses', 'selectedModel']).then((data) => {
    selectedModel = (data.selectedModel as string) || '';
    if (data.localModelStatuses) {
      updateModelLoadingProgress(data.localModelStatuses, selectedModel);
    }
  }).catch(err => console.error('[UI] Failed to load model statuses:', err));

  // Listen for changes
  chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;

    if (changes.selectedModel) {
      selectedModel = (changes.selectedModel.newValue as string) || '';
      getStorage(['localModelStatuses']).then((data) => {
        updateModelLoadingProgress(data.localModelStatuses || {}, selectedModel);
      }).catch(err => console.error('[UI] Failed to get model statuses:', err));
    }

    if (changes.localModelStatuses) {
      const newStatuses = (changes.localModelStatuses.newValue || {}) as Record<string, LocalModelStatus>;
      const oldStatuses = (changes.localModelStatuses.oldValue || {}) as Record<string, LocalModelStatus>;

      updateModelLoadingProgress(newStatuses, selectedModel);

      // Check if selected local model just became ready - trigger re-evaluation
      if (selectedModel?.startsWith('local:')) {
        const modelId = selectedModel.split(':')[1];
        const oldState = oldStatuses[modelId]?.state;
        const newState = newStatuses[modelId]?.state;

        if (newState === 'ready' && oldState && oldState !== 'ready') {
          _deps.processExistingPosts();
        }
      }
    }
  });
}

// ==================== Filtered Tab / Modal ====================

export function toggleFilteredTab(active: boolean) {
  if (active === filteredTabActive) return;
  filteredTabActive = active;

  if (active) {
    if (!filteredModalBackdrop || !filteredModalBackdrop.isConnected) {
      filteredModalBackdrop = document.createElement('div');
      filteredModalBackdrop.className = 'filtered-modal-backdrop';

      filteredViewContainer = document.createElement('div');
      filteredViewContainer.className = 'filtered-view-container';
      // linkedin adaptation: tag the panel so its posts adopt LinkedIn's
      // card visual style (white card, off-white feed background, etc.).
      if (_deps.adapter.siteId === 'linkedin') {
        filteredViewContainer.classList.add('filtered-view-container--linkedin');
      }

      const header = document.createElement('div');
      header.className = 'filtered-modal-header';
      header.replaceChildren(parseHTML(`
        <button class="filtered-modal-close" aria-label="Close">
          <svg viewBox="0 0 24 24"><path d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z"></path></svg>
        </button>
        <span class="filtered-modal-title">${_deps.adapter.siteId === 'youtube' ? 'Filtered videos' : 'Filtered posts'}</span>
      `));

      const content = document.createElement('div');
      content.className = 'filtered-modal-content';

      filteredViewContainer.appendChild(header);
      filteredViewContainer.appendChild(content);
      filteredModalBackdrop.appendChild(filteredViewContainer);
      document.body.appendChild(filteredModalBackdrop);

      filteredModalBackdrop.addEventListener('click', (e) => {
        if (e.target === filteredModalBackdrop) {
          toggleFilteredTab(false);
          updateFilteredToggleButtons();
        }
      });

      header.querySelector('.filtered-modal-close')!.addEventListener('click', () => {
        toggleFilteredTab(false);
        updateFilteredToggleButtons();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && filteredTabActive) {
          toggleFilteredTab(false);
          updateFilteredToggleButtons();
        }
      });

      updateTheme();
    }

    filteredModalBackdrop.classList.add('visible');
    renderFilteredPostsView(filteredViewContainer!.querySelector('.filtered-modal-content')!);
  } else {
    if (filteredModalBackdrop) {
      filteredModalBackdrop.classList.remove('visible');
    }

    // Restore verification bars that may have been removed while on Filtered tab
    restoreVerificationBars();
  }
}

// Builds the "Restore" button shared by every filtered-post layout. Clicking
// it reports a false positive, removes the post from the panel, unhides the
// original article in the feed, and overrides the cache so re-evaluation keeps
// the post visible.
function createRestoreButton(post: FilteredPost, postContent: PostContent): HTMLButtonElement {
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'slop-restore';
  restoreBtn.textContent = 'Restore';
  restoreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // Remove from filtered posts list
    const key = postContent.postUrl || post.evaluationText.substring(0, 200);
    const idx = filteredPosts.findIndex(p => (p.post.postUrl || p.evaluationText.substring(0, 200)) === key);
    if (idx !== -1) filteredPosts.splice(idx, 1);
    filteredPostKeys.delete(key);

    // Try to unhide original article in the feed
    for (const article of _deps.findPosts()) {
      const postUrl = _deps.adapter.getPostUrl(article);
      if (postUrl && postContent.postUrl && postUrl.includes(postContent.postUrl)) {
        const container = _deps.adapter.getPostContainer(article);
        container.style.display = '';
        container.style.visibility = '';
        delete container.dataset.filteredByExtension;
        article.style.opacity = '';
        article.style.transition = '';
        _deps.processedPosts.delete(article);
        markPostVerified(article);
        break;
      }
    }

    // Override cache so re-evaluation keeps post visible
    chrome.runtime.sendMessage({
      type: 'overrideCacheEntry',
      post: post.evaluationText,
      imageUrls: postContent.imageUrls || [],
      postUrl: postContent.postUrl || null,
      siteId: _deps.adapter.siteId,
      shouldHide: false,
      reasoning: 'User reported: false positive'
    }).catch(err => console.error('[Sieve] Override cache error:', err));

    updateFilteredTabCount();
    const outerContainer = restoreBtn.closest('.filtered-view-container') || restoreBtn.closest('.ff-ios-filtered-modal-backdrop');
    const innerContainer = outerContainer?.querySelector('.filtered-modal-content') || outerContainer?.querySelector('.ff-ios-filtered-modal-content');
    if (innerContainer) renderFilteredPostsView(innerContainer);
  });
  return restoreBtn;
}

// Wraps a built card in an <a> (so middle-click / ctrl-click open natively)
// while keeping clicks on buttons/actions from navigating.
function wrapInPostLink(card: HTMLElement, postUrl: string | null | undefined): HTMLElement {
  if (!postUrl) return card;
  const link = document.createElement('a');
  link.href = postUrl;
  link.className = 'slop-post-link';
  link.addEventListener('click', (e) => {
    if ((e.target as Element).closest('button, [role="button"], .slop-restore, .slop-post-actions')) {
      e.preventDefault();
    }
  });
  link.appendChild(card);
  return link;
}

// YouTube-specific filtered-post card: thumbnail on top, then a channel-avatar
// row with the video title, channel name and view/age metadata — mirroring
// YouTube's own grid video lockups rather than the Twitter tweet layout.
function buildYouTubeCard(post: FilteredPost): HTMLElement {
  const { post: postContent } = post;
  const isShort = !!postContent.postUrl?.includes('/shorts/');

  const wrapper = document.createElement('div');
  wrapper.className = 'slop-post-wrapper yt-card';

  const card = document.createElement('div');
  card.className = 'yt-card-inner';

  // Category tag sits in its own right-aligned row above the thumbnail.
  if (post.category) {
    const tagRow = document.createElement('div');
    tagRow.className = 'yt-card-tag-row';
    const tag = document.createElement('span');
    tag.className = 'slop-category-tag yt-card-tag';
    tag.textContent = post.category.toUpperCase();
    tagRow.appendChild(tag);
    card.appendChild(tagRow);
  }

  // Thumbnail (prefer the adapter's higher-quality display URL)
  const displayUrls = postContent.displayImageUrls?.length
    ? postContent.displayImageUrls
    : postContent.imageUrls;
  const thumb = document.createElement('div');
  thumb.className = 'yt-card-thumb';
  if (isShort) thumb.classList.add('yt-card-thumb-short');
  if (displayUrls && displayUrls.length > 0 && !postContent.mediaBlurred) {
    const img = document.createElement('img');
    img.src = displayUrls[0];
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    thumb.classList.add('yt-card-thumb-empty');
  }
  card.appendChild(thumb);

  // Info row: channel avatar + text column
  const info = document.createElement('div');
  info.className = 'yt-card-info';

  const avatar = document.createElement('div');
  avatar.className = 'yt-card-avatar';
  if (postContent.avatarUrl) {
    const img = document.createElement('img');
    img.src = postContent.avatarUrl;
    avatar.appendChild(img);
  } else if (isShort) {
    avatar.classList.add('slop-avatar-shorts');
    avatar.replaceChildren(parseHTML(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M17.77 10.32l-1.2-.5L18 9.06a3.74 3.74 0 0 0-3.5-6.62L6.18 6.83a3.74 3.74 0 0 0 .04 6.62l1.2.5L6 14.94a3.74 3.74 0 0 0 3.5 6.62l8.32-4.39a3.74 3.74 0 0 0-.04-6.85zM10 15.5v-7l6 3.5-6 3.5z" fill="currentColor"/>' +
      '</svg>'
    ));
  } else {
    const initial = (postContent.author?.[0] || '?').toUpperCase();
    const fallback = document.createElement('span');
    fallback.className = 'slop-avatar-initial';
    fallback.textContent = initial;
    avatar.appendChild(fallback);
  }
  info.appendChild(avatar);

  const textCol = document.createElement('div');
  textCol.className = 'yt-card-text';

  const title = document.createElement('div');
  title.className = 'yt-card-title';
  if (postContent.textHtml) {
    title.replaceChildren(DOMPurify.sanitize(postContent.textHtml, { RETURN_DOM_FRAGMENT: true }));
  } else {
    title.textContent = postContent.text || post.evaluationText;
  }
  textCol.appendChild(title);

  if (postContent.author) {
    const channel = document.createElement('div');
    channel.className = 'yt-card-channel';
    channel.textContent = postContent.author;
    textCol.appendChild(channel);
  }
  if (postContent.timeText) {
    const meta = document.createElement('div');
    meta.className = 'yt-card-meta';
    meta.textContent = postContent.timeText;
    textCol.appendChild(meta);
  }
  info.appendChild(textCol);
  card.appendChild(info);

  // Reasoning
  const reasoning = document.createElement('div');
  reasoning.className = 'slop-post-reasoning yt-card-reasoning';
  reasoning.textContent = cleanReasoning(post.reasoning) || 'Filtered';
  card.appendChild(reasoning);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'slop-post-actions';
  actions.appendChild(createRestoreButton(post, postContent));
  card.appendChild(actions);

  wrapper.appendChild(wrapInPostLink(card, postContent.postUrl));
  return wrapper;
}

export function renderFilteredPostsView(container: Element) {
  const noun = _deps.adapter.siteId === 'youtube' ? 'videos' : 'posts';
  if (filteredPosts.length === 0) {
    container.replaceChildren(parseHTML(`
      <div class="filtered-posts-container">
        <div class="filtered-posts-empty">
          No ${noun} have been filtered out in this session.<br>
          Removed ${noun} will appear here.
        </div>
      </div>
    `));
    return;
  }

  // Create a container for the posts
  container.replaceChildren(parseHTML('<div class="slop-posts-container"></div>'));
  const postsContainer = container.querySelector('.slop-posts-container')!;

  const isYouTube = _deps.adapter.siteId === 'youtube';

  // Render posts in reverse order (newest first); YouTube uses video lockups,
  // every other platform uses the tweet-style card.
  [...filteredPosts].reverse().forEach((post) => {
    postsContainer.appendChild(isYouTube ? buildYouTubeCard(post) : buildTwitterCard(post));
  });
}

// linkedin adaptation: static SVG icons used inside LinkedIn filtered-post
// cards. Defined here so buildTwitterCard's LinkedIn branch can pull them in
// without leaking the implementation into a public/exported surface.
function _liLinkedInBadge(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-label', 'LinkedIn'); svg.setAttribute('role', 'img');
  svg.classList.add('slop-li-badge-icon');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', '16'); bg.setAttribute('height', '16');
  bg.setAttribute('rx', '3'); bg.setAttribute('fill', '#0A66C2');
  svg.appendChild(bg);
  const iStem = document.createElementNS(ns, 'rect');
  iStem.setAttribute('x', '2.5'); iStem.setAttribute('y', '6');
  iStem.setAttribute('width', '2'); iStem.setAttribute('height', '7');
  iStem.setAttribute('fill', 'white');
  svg.appendChild(iStem);
  const iDot = document.createElementNS(ns, 'circle');
  iDot.setAttribute('cx', '3.5'); iDot.setAttribute('cy', '4'); iDot.setAttribute('r', '1.2');
  iDot.setAttribute('fill', 'white');
  svg.appendChild(iDot);
  const n = document.createElementNS(ns, 'path');
  n.setAttribute('fill', 'white');
  n.setAttribute('d', 'M6.5 6h2v1.1C8.8 6.4 9.5 6 10.5 6 12.2 6 12.5 7.2 12.5 8.8V13h-2V9.3c0-.8-.2-1.4-1-1.4-.9 0-1 .6-1 1.5V13H6.5V6z');
  svg.appendChild(n);
  return svg;
}
function _liGlobeIcon(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('slop-li-globe-icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM3.1 8.5h2.1c.1.9.3 1.8.6 2.5A5.5 5.5 0 0 1 3.1 8.5zm0-1A5.5 5.5 0 0 1 5.8 5c-.3.7-.5 1.6-.6 2.5H3.1zM8 13c-.5 0-1.4-1.6-1.6-3.5h3.2C9.4 11.4 8.5 13 8 13zm-1.6-4.5c.1-1.1.4-2 .8-2.7.2-.3.5-.5.8-.5s.6.2.8.5c.4.7.7 1.6.8 2.7H6.4zm4.5 0c-.1-.9-.3-1.8-.6-2.5A5.5 5.5 0 0 1 12.9 8.5h-2zm2 1a5.5 5.5 0 0 1-2.8 2.5c.3-.7.5-1.6.6-2.5h2.2z');
  svg.appendChild(p);
  return svg;
}

// Twitter-style filtered-post card: avatar + body (name/handle, text, optional
// quote, media, reasoning). LinkedIn shares this function but rearranges
// avatar+meta into a header above a full-width body, swaps in LinkedIn-style
// name/headline/time elements, and adds a "…more" expander for long text.
// See buildYouTubeCard for the thumbnail-first YouTube layout.
function buildTwitterCard(post: FilteredPost): HTMLElement {
  const isLinkedIn = _deps.adapter.siteId === 'linkedin';
  const { post: postContent } = post;
  const wrapper = document.createElement('div');
  wrapper.className = 'slop-post-wrapper';

  // Main post row: avatar + body
  const postRow = document.createElement('div');
  postRow.className = 'slop-post';

  // Avatar — show image if available, otherwise show initial as fallback
  const avatar = document.createElement('div');
  avatar.className = 'slop-post-avatar';
  const isShort = !!postContent.postUrl?.includes('/shorts/');
  if (postContent.avatarUrl) {
    const img = document.createElement('img');
    img.src = postContent.avatarUrl;
    avatar.appendChild(img);
  } else if (isShort) {
    // Shorts don't expose channel info in the lockup payload, so an avatar
    // initial would just be "?". Render the Shorts glyph instead.
    avatar.classList.add('slop-avatar-shorts');
    avatar.replaceChildren(parseHTML(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M17.77 10.32l-1.2-.5L18 9.06a3.74 3.74 0 0 0-3.5-6.62L6.18 6.83a3.74 3.74 0 0 0 .04 6.62l1.2.5L6 14.94a3.74 3.74 0 0 0 3.5 6.62l8.32-4.39a3.74 3.74 0 0 0-.04-6.85zM10 15.5v-7l6 3.5-6 3.5z" fill="currentColor"/>' +
      '</svg>'
    ));
  } else {
    // Fallback: show first letter of display name or handle
    const initial = (postContent.author?.[0] || postContent.handle?.[1] || '?').toUpperCase();
    const fallback = document.createElement('span');
    fallback.className = 'slop-avatar-initial';
    fallback.textContent = initial;
    avatar.appendChild(fallback);
  }
  // linkedin adaptation: avatar gets appended later as part of the header row
  // (above the body). For everything else it goes side-by-side with the body.
  if (!isLinkedIn) {
    postRow.appendChild(avatar);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'slop-post-body';

  // Top row: meta + category tag
  const top = document.createElement('div');
  top.className = 'slop-post-top';

  const meta = document.createElement('div');
  meta.className = 'slop-post-meta';
  if (isLinkedIn) {
    // linkedin adaptation: structured 3-row header matching LinkedIn's
    // native card. Row 1: [name] [in badge] • [degree]; Row 2: [headline,
    // truncated]; Row 3: [time] • [globe icon].
    const nameRow = document.createElement('div');
    nameRow.className = 'slop-post-name-row';
    if (postContent.author) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'slop-post-name';
      nameSpan.textContent = postContent.author;
      nameRow.appendChild(nameSpan);
    }
    nameRow.appendChild(_liLinkedInBadge());
    if (postContent.degree) {
      const sep = document.createElement('span');
      sep.className = 'slop-post-degree-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = ' • ';
      nameRow.appendChild(sep);
      const degSpan = document.createElement('span');
      degSpan.className = 'slop-post-degree';
      degSpan.textContent = postContent.degree;
      nameRow.appendChild(degSpan);
    }
    meta.appendChild(nameRow);

    if (postContent.handle) {
      // LinkedIn re-purposes the handle slot as the author's headline.
      const headline = document.createElement('span');
      headline.className = 'slop-post-handle slop-post-linkedin-headline';
      headline.textContent = postContent.handle;
      meta.appendChild(headline);
    }

    if (postContent.timeText) {
      const timeRow = document.createElement('div');
      timeRow.className = 'slop-post-time-row';
      const timeSpan = document.createElement('span');
      timeSpan.textContent = postContent.timeText;
      timeRow.appendChild(timeSpan);
      const sep = document.createElement('span');
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = ' • ';
      timeRow.appendChild(sep);
      timeRow.appendChild(_liGlobeIcon());
      meta.appendChild(timeRow);
    }
  } else {
    if (postContent.author) {
      // Extract display name — author field has "DisplayName@handle · time" concatenated
      // Use handle to split if available, otherwise use full author string
      let displayName = postContent.author;
      if (postContent.handle) {
        const handleIdx = displayName.indexOf(postContent.handle);
        if (handleIdx > 0) displayName = displayName.substring(0, handleIdx);
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'slop-post-name';
      nameSpan.textContent = displayName;
      meta.appendChild(nameSpan);
    }
    // YouTube's `handle` (e.g. "/@channel") and `timeText` (e.g. "1.2M views • 3 months ago")
    // aren't meaningful identity in the filtered card the way Twitter's `@handle` / "2h" are.
    if ((postContent.handle || postContent.timeText) && _deps.adapter.siteId !== 'youtube') {
      const handleSpan = document.createElement('span');
      handleSpan.className = 'slop-post-handle';
      const parts = [postContent.handle, postContent.timeText].filter(Boolean);
      handleSpan.textContent = parts.join(' · ');
      meta.appendChild(handleSpan);
    }
  }
  top.appendChild(meta);

  if (post.category) {
    // table_yesno (LiteRT-LM local Gemma) produces a comma-joined list of
    // matched categories; the single-category XML path stores one name.
    // Either way, split + render one badge per match. Wrap the tags in a
    // flex group so `.slop-post-top`'s `justify-content: space-between`
    // doesn't distribute siblings across the right column — keep them
    // 5px apart instead.
    const names = post.category.split(',').map(s => s.trim()).filter(Boolean);
    if (names.length > 0) {
      const tagGroup = document.createElement('div');
      tagGroup.style.display = 'flex';
      tagGroup.style.gap = '5px';
      tagGroup.style.marginLeft = '8px';
      for (const name of names) {
        const tag = document.createElement('span');
        tag.className = 'slop-category-tag';
        tag.style.marginLeft = '0';
        tag.textContent = name.toUpperCase();
        tagGroup.appendChild(tag);
      }
      top.appendChild(tagGroup);
    }
  }
  body.appendChild(top);

  // Tweet text — use sanitized HTML to preserve links/emojis/formatting
  let textDiv: HTMLElement | null = null;
  if (postContent.textHtml) {
    textDiv = document.createElement('div');
    textDiv.className = 'slop-post-text';
    textDiv.replaceChildren(DOMPurify.sanitize(postContent.textHtml, { RETURN_DOM_FRAGMENT: true }));
    body.appendChild(textDiv);
  } else if (post.evaluationText) {
    textDiv = document.createElement('div');
    textDiv.className = 'slop-post-text';
    textDiv.textContent = post.evaluationText;
    body.appendChild(textDiv);
  }

  // linkedin adaptation: collapse long posts to ~5 lines with a "…more"
  // button, matching LinkedIn's own expandable post behaviour.
  if (isLinkedIn && textDiv) {
    const textLen = textDiv.textContent?.length ?? 0;
    if (textLen > 280) {
      const collapsibleEl = textDiv;
      collapsibleEl.classList.add('slop-post-text--collapsible');
      const expandBtn = document.createElement('button');
      expandBtn.className = 'slop-post-expand-btn';
      expandBtn.textContent = '…more';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        collapsibleEl.classList.remove('slop-post-text--collapsible');
        expandBtn.remove();
      });
      body.appendChild(expandBtn);
    }
  }

  // Quote tweet — render as a mini-card with avatar, author, and text
  if (postContent.quote) {
    const quoteBox = document.createElement('div');
    quoteBox.className = 'slop-quote-box';

    // Quote header: avatar + author info
    const quoteHeader = document.createElement('div');
    quoteHeader.className = 'slop-quote-header';

    if (postContent.quote.avatarUrl) {
      const qAvatar = document.createElement('img');
      qAvatar.className = 'slop-quote-avatar';
      qAvatar.src = postContent.quote.avatarUrl;
      quoteHeader.appendChild(qAvatar);
    }

    if (postContent.quote.author) {
      let qDisplayName = postContent.quote.author;
      if (postContent.quote.handle) {
        const idx = qDisplayName.indexOf(postContent.quote.handle);
        if (idx > 0) qDisplayName = qDisplayName.substring(0, idx);
      }
      const qName = document.createElement('span');
      qName.className = 'slop-quote-name';
      qName.textContent = qDisplayName;
      quoteHeader.appendChild(qName);
    }
    if (postContent.quote.handle || postContent.quote.timeText) {
      const qMeta = document.createElement('span');
      qMeta.className = 'slop-quote-handle';
      const parts = [postContent.quote.handle, postContent.quote.timeText].filter(Boolean);
      qMeta.textContent = parts.join(' · ');
      quoteHeader.appendChild(qMeta);
    }
    quoteBox.appendChild(quoteHeader);

    // Quote text
    if (postContent.quote.textHtml) {
      const quoteText = document.createElement('div');
      quoteText.className = 'slop-quote-text';
      quoteText.replaceChildren(DOMPurify.sanitize(postContent.quote.textHtml, { RETURN_DOM_FRAGMENT: true }));
      quoteBox.appendChild(quoteText);
    }

    body.appendChild(quoteBox);
  }

  // Images (skip if media was blurred/age-restricted on the platform).
  // Prefer the adapter's higher-quality display URLs when present
  // (e.g. YouTube's original AVIF/JPEG lockup thumb); fall back to the
  // classifier payload (smaller, JPEG-only).
  const displayUrls = postContent.displayImageUrls?.length
    ? postContent.displayImageUrls
    : postContent.imageUrls;
  if (displayUrls && displayUrls.length > 0 && !postContent.mediaBlurred) {
    const mediaContainer = document.createElement('div');
    mediaContainer.className = 'slop-media-container';
    displayUrls.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'slop-media-image';
      img.loading = 'lazy';
      mediaContainer.appendChild(img);
    });
    body.appendChild(mediaContainer);
  }

  // Reasoning
  const reasoning = document.createElement('div');
  reasoning.className = 'slop-post-reasoning';
  reasoning.textContent = cleanReasoning(post.reasoning) || 'Filtered';
  body.appendChild(reasoning);

  // Actions row
  const actions = document.createElement('div');
  actions.className = 'slop-post-actions';
  actions.appendChild(createRestoreButton(post, postContent));
  body.appendChild(actions);

  if (isLinkedIn) {
    // linkedin adaptation: header row (avatar + meta/top) sits ABOVE the
    // full-width body. The top block was appended to body earlier; pull it
    // back out so it lives in the header instead.
    const liHeader = document.createElement('div');
    liHeader.className = 'slop-post-linkedin-header';
    liHeader.appendChild(avatar);
    body.removeChild(top);
    liHeader.appendChild(top);
    postRow.classList.add('slop-post--linkedin');
    postRow.appendChild(liHeader);
    postRow.appendChild(body);
  } else {
    postRow.appendChild(body);
  }

  // Wrap in a real <a> so middle-click / ctrl-click open in new tab natively
  wrapper.appendChild(wrapInPostLink(postRow, postContent.postUrl));

  return wrapper;
}

// ==================== Filtered Post Storage ====================

export function storeFilteredPost(article: HTMLElement, contentObj: PostContent, reasoning: string, rawResponse = '', category: string | null = null) {
  // Use postUrl or content hash as dedup key
  const evalText = formatPostForEvaluation(contentObj);
  const key = contentObj.postUrl || evalText.substring(0, 200);
  if (filteredPostKeys.has(key)) {
    return; // Already stored
  }
  filteredPostKeys.add(key);

  filteredPosts.push({
    post: contentObj,
    evaluationText: evalText,
    reasoning,
    rawResponse,
    category: category || null,
    timestamp: Date.now()
  });
  updateFilteredTabCount();
}

// ==================== Verification Bars ====================

export function getVerificationBar(article: HTMLElement) {
  let bar = article.querySelector('.post-verification-bar');
  if (!bar) {
    article.style.position = 'relative';
    bar = document.createElement('div');
    bar.className = 'post-verification-bar';
    article.insertBefore(bar, article.firstChild);
  }
  return bar;
}

// Cap how long a post stays visually greyed-out. Processing may continue past
// this — we just stop dimming the post so a slow classification doesn't leave
// the user staring at a grey card.
const PENDING_DIM_CAP_MS = 3000;
const pendingDimTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function clearPendingDimTimer(article: HTMLElement) {
  const t = pendingDimTimers.get(article);
  if (t) {
    clearTimeout(t);
    pendingDimTimers.delete(article);
  }
}

export function markPostPending(article: HTMLElement) {
  const bar = getVerificationBar(article);
  bar.classList.remove('verified', 'api-error');
  bar.classList.add('pending');
  article.setAttribute('data-ff-pending', '');
  _deps.pendingPosts.add(article);
  article.dataset.pendingStartTime = Date.now().toString();

  clearPendingDimTimer(article);
  pendingDimTimers.set(article, setTimeout(() => {
    article.removeAttribute('data-ff-pending');
    bar.classList.remove('pending');
    pendingDimTimers.delete(article);
    // Defensively restore opacity on the article's direct children. The dim
    // is normally CSS-only via [data-ff-pending], so removing the attribute
    // should be enough — but if anything else left an inline opacity behind
    // the post would stay greyed past the cap. Skip the verification bar to
    // match the CSS exclusion.
    article.style.opacity = '';
    for (const child of Array.from(article.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains('post-verification-bar')) continue;
      child.style.opacity = '';
    }
  }, PENDING_DIM_CAP_MS));
}

export function markPostVerified(article: HTMLElement) {
  const bar = getVerificationBar(article);
  bar.classList.remove('pending', 'api-error');
  bar.classList.add('verified');
  article.removeAttribute('data-ff-pending');
  _deps.pendingPosts.delete(article);
  delete article.dataset.pendingStartTime;
  clearPendingDimTimer(article);
}

export function restoreVerificationBars() {
  const posts = _deps.findPosts();
  posts.forEach(article => {
    if (_deps.processedPosts.has(article) && _deps.postReasonings.has(article)) {
      const stored = _deps.postReasonings.get(article)!;
      if (!stored.shouldHide) {
        const existingBar = article.querySelector('.post-verification-bar');
        if (!existingBar) {
          markPostVerified(article);
        }
      }
    }
  });
}

// ==================== Post Hiding ====================

export function hidePost(article: HTMLElement) {
  _deps.pendingPosts.delete(article);
  delete article.dataset.pendingStartTime;
  article.removeAttribute('data-ff-pending');
  clearPendingDimTimer(article);

  _deps.adapter.hidePost(article);
}

// ==================== Reasoning Popup ====================

export function showReasoningPopup(article: HTMLElement, x: number, y: number) {
  hideReasoningPopup();

  const content = _deps.extractPostContent(article);
  const stored = _deps.postReasonings.get(article);

  const popup = document.createElement('div');
  popup.className = 'post-filter-reasoning-popup';

  // Header status reflects the overall post-level state: PENDING until the
  // race resolves, then HIDDEN / KEPT / ERROR. Tabs below show per-detector
  // reasoning when the multi-detector flow is in play.
  let statusClass: string, statusText: string;
  if (stored?.isApiError) {
    statusClass = 'status-error';
    statusText = 'ERROR';
  } else if (stored?.shouldHide) {
    statusClass = 'status-hide';
    statusText = 'HIDDEN';
  } else if (stored) {
    statusClass = 'status-show';
    statusText = 'KEPT';
  } else {
    statusClass = 'status-pending';
    statusText = 'PENDING';
  }

  const detectorEntry = postDetectorStates.get(article);
  const rawResponseSection = stored?.rawResponse ? `
    <details class="reasoning-debug">
      <summary>Raw Model Response</summary>
      <pre class="reasoning-debug-html">${escapeHtml(stored.rawResponse)}</pre>
    </details>
  ` : '';

  let bodyHtml: string;
  if (detectorEntry && detectorEntry.names.length > 0) {
    // Pick which tab is active. Preserve user selection if still valid;
    // otherwise default to the highest-priority detector (index 0).
    const activeName = (activePopupTab && detectorEntry.byName.has(activePopupTab))
      ? activePopupTab
      : detectorEntry.names[0];
    activePopupTab = activeName;

    const tabsHtml = detectorEntry.names.map(name => {
      const s = detectorEntry.byName.get(name)!;
      const dot = s.status === 'pending' ? 'pending'
                : s.status === 'error' ? 'error'
                : s.status === 'skipped' ? 'skipped'
                : s.shouldHide ? 'hide' : 'keep';
      const isActive = name === activeName;
      return `<button class="reasoning-tab ${isActive ? 'active' : ''}" data-detector="${escapeHtml(name)}">
        <span class="reasoning-tab-dot reasoning-tab-dot-${dot}"></span>
        ${escapeHtml(detectorLabel(name))}
      </button>`;
    }).join('');

    const active = detectorEntry.byName.get(activeName)!;
    let tabBody: string;
    if (active.status === 'pending') {
      tabBody = `<div class="reasoning-text reasoning-text-pending">Waiting for ${escapeHtml(detectorLabel(activeName))}…</div>`;
    } else if (active.status === 'error') {
      tabBody = `<div class="reasoning-text reasoning-text-error">${escapeHtml(detectorLabel(activeName))} failed: ${escapeHtml(active.error || 'unknown error')}</div>`;
    } else if (active.status === 'skipped') {
      tabBody = `
        <div class="reasoning-tab-verdict verdict-skipped">SKIPPED</div>
        <div class="reasoning-text reasoning-text-skipped">${escapeHtml(active.skipReason || 'No reason given')}</div>
      `;
    } else {
      const verdict = active.shouldHide ? 'HIDE' : 'KEEP';
      const verdictClass = active.shouldHide ? 'verdict-hide' : 'verdict-keep';
      tabBody = `
        <div class="reasoning-tab-verdict ${verdictClass}">${verdict}</div>
        <div class="reasoning-text">${escapeHtml(cleanReasoning(active.reasoning ?? '') ?? '')}</div>
      `;
    }

    bodyHtml = `
      <div class="reasoning-tabs">${tabsHtml}</div>
      <div class="reasoning-tab-body">${tabBody}</div>
    `;
  } else {
    // Fallback: single-reason render for cache hits / no-rules / disabled.
    const reasoning = stored?.reasoning ?? 'Post not yet evaluated. It may be queued or no filter rules are set.';
    bodyHtml = `<div class="reasoning-text">${escapeHtml(cleanReasoning(reasoning) ?? '')}</div>`;
  }

  popup.replaceChildren(parseHTML(`
    <div class="reasoning-header">
      <span class="reasoning-status ${statusClass}">${statusText}</span>
      <button class="reasoning-close">&times;</button>
    </div>
    ${bodyHtml}
    <div class="reasoning-post">${escapeHtml(content.text.substring(0, 100))}${content.text.length > 100 ? '...' : ''}</div>
    ${rawResponseSection}
    <button class="reasoning-reeval-btn">${stored ? 'Re-evaluate' : 'Evaluate Now'}</button>
    <button class="reasoning-suggest-btn">Why is this annoying?</button>
    <div class="reasoning-suggestions"></div>
  `));

  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;

  document.body.appendChild(popup);
  activePopup = popup;
  activePopupArticle = article;

  popup.querySelector('.reasoning-close')!.addEventListener('click', hideReasoningPopup);

  popup.querySelectorAll<HTMLButtonElement>('.reasoning-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.detector;
      if (!name || name === activePopupTab) return;
      activePopupTab = name;
      refreshActivePopupIfFor(article);
    });
  });

  popup.querySelector('.reasoning-reeval-btn')!.addEventListener('click', () => {
    (async () => {
      hideReasoningPopup();
      try {
        await _deps.reEvaluateSinglePost(article);
      } catch (err) {
        console.error('[Sieve] Re-evaluate error:', err);
      }
    })().catch(err => console.error('[UI] reeval handler failed:', err));
  });

  // Suggest annoying reasons button handler
  popup.querySelector('.reasoning-suggest-btn')!.addEventListener('click', (e) => {
    (async () => {
      const btn = e.currentTarget as HTMLButtonElement;
      const suggestionsDiv = popup.querySelector('.reasoning-suggestions')!;
      btn.disabled = true;
      btn.textContent = 'Thinking...';
      suggestionsDiv.replaceChildren();
      try {
        const response: { reasons?: string[] } | undefined = await chrome.runtime.sendMessage({
          type: 'suggestAnnoyingReasons',
          post: content.text,
          imageUrls: content.imageUrls || [],
          siteId: _deps.adapter.siteId
        });
        if (response?.reasons?.length) {
          btn.style.display = 'none';
          suggestionsDiv.replaceChildren(parseHTML(response.reasons.map(r =>
            `<button class="reasoning-suggestion-chip">${escapeHtml(r)}</button>`
          ).join('')));
          suggestionsDiv.querySelectorAll('.reasoning-suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
              const phrase = chip.textContent ?? '';
              addFilterPhrase(phrase).catch(err => console.error('[UI] addFilterPhrase failed:', err));
              chip.classList.add('suggestion-added');
              chip.textContent = `+ ${phrase}`;
              (chip as HTMLButtonElement).disabled = true;
            });
          });
        } else {
          btn.textContent = 'No suggestions';
          btn.disabled = true;
        }
      } catch (err) {
        console.error('[Sieve] Suggest reasons error:', err);
        btn.textContent = 'Error - try again';
        btn.disabled = false;
      }
    })().catch(err => console.error('[UI] suggest handler failed:', err));
  });

  const rect = popup.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    popup.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    popup.style.top = `${window.innerHeight - rect.height - 10}px`;
  }

  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 0);
}

export function hideReasoningPopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  activePopupArticle = null;
  document.removeEventListener('click', handleOutsideClick);
}

// ---- Per-detector state for the tabbed popup ----------------------------
//
// Each evaluated post gets a small map of detector name → state. The popup
// renders one tab per detector and reads each tab's content from this map.
// Posts that don't go through the multi-detector pipeline (cache hits, the
// "no filter rules" early return, etc.) won't have an entry here, and the
// popup falls back to the legacy single-reason rendering.

interface DetectorPopupState {
  status: 'pending' | 'success' | 'error' | 'skipped';
  shouldHide?: boolean;
  reasoning?: string;
  category?: string | null;
  error?: string;
  skipReason?: string;
}

interface DetectorPopupEntry {
  /** Ordered by priority: index 0 is the highest-priority detector. */
  names: string[];
  byName: Map<string, DetectorPopupState>;
}

const postDetectorStates = new WeakMap<HTMLElement, DetectorPopupEntry>();

export function initDetectorStates(article: HTMLElement, names: string[]) {
  if (names.length === 0) return;
  const byName = new Map<string, DetectorPopupState>();
  for (const name of names) byName.set(name, { status: 'pending' });
  postDetectorStates.set(article, { names: [...names], byName });
  refreshActivePopupIfFor(article);
}

export function updateDetectorState(
  article: HTMLElement,
  name: string,
  patch: Partial<DetectorPopupState> & { status: DetectorPopupState['status'] },
) {
  let entry = postDetectorStates.get(article);
  if (!entry) {
    // initDetectorStates wasn't called (e.g. message ordering). Synthesize.
    entry = { names: [name], byName: new Map([[name, { status: patch.status }]]) };
    postDetectorStates.set(article, entry);
  }
  if (!entry.byName.has(name)) {
    entry.names.push(name);
    entry.byName.set(name, { status: patch.status });
  }
  Object.assign(entry.byName.get(name)!, patch);
  refreshActivePopupIfFor(article);
}

function refreshActivePopupIfFor(article: HTMLElement) {
  if (!activePopup || activePopupArticle !== article) return;
  const x = parseFloat(activePopup.style.left) || 0;
  const y = parseFloat(activePopup.style.top) || 0;
  showReasoningPopup(article, x, y);
}

// Display label for a detector tab. Falls back to the raw name for
// future detectors without an entry here.
function detectorLabel(name: string): string {
  switch (name) {
    case 'filter': return 'Filter';
    case 'aiText': return 'AI text';
    case 'aiImage': return 'AI image';
    default: return name;
  }
}

function handleOutsideClick(e: MouseEvent) {
  if (activePopup && !activePopup.contains(e.target as Node)) {
    hideReasoningPopup();
  }
}

// ==================== Toasts ====================

function getToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'post-filter-toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function dismissToast(toast: HTMLElement) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove('toast-visible');
  toast.classList.add('toast-hiding');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

export function showApiKeyWarning() {
  if (apiKeyWarningShown) return;
  apiKeyWarningShown = true;

  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'post-filter-toast post-filter-warning';
  toast.replaceChildren(parseHTML(`
    <div class="toast-header">
      <span class="toast-title">Feed Filter</span>
      <button class="toast-close">&times;</button>
    </div>
    <div class="toast-content">No API key configured. Click the extension icon to add your Claude API key.</div>
  `));
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  toast.querySelector('.toast-close')!.addEventListener('click', () => dismissToast(toast));
}

function showCategoryLimitWarning() {
  // Show warning in all filter box containers
  const containers = [filterPhrasesContainer, bottomFilterContainer, mobileFilterContainer].filter(Boolean) as HTMLElement[];
  for (const container of containers) {
    // Don't add duplicate warnings
    if (container.querySelector('.ff-category-limit-warning')) continue;
    const warning = document.createElement('div');
    warning.className = 'ff-category-limit-warning';
    warning.textContent = 'You have too many filter categories - please remove some before adding more';
    const actionsRow = container.querySelector('.filter-phrases-actions');
    if (actionsRow) {
      actionsRow.parentNode!.insertBefore(warning, actionsRow);
    }
    // Remove when user types or clicks elsewhere
    const input = container.querySelector<HTMLInputElement>('.filter-phrases-input');
    if (input) {
      const dismiss = () => {
        warning.remove();
        input.removeEventListener('input', dismiss);
        input.removeEventListener('blur', dismiss);
      };
      input.addEventListener('input', dismiss);
      input.addEventListener('blur', dismiss);
    }
  }
}

// ==================== Context Menu ====================

export function addContextMenuHandler(article: HTMLElement) {
  const openPopup = (x: number, y: number) => {
    (async () => {
      await fetchReasoningIfNeeded(article);
      showReasoningPopup(article, x, y);
    })().catch(err => console.error('[UI] getReasoning handler failed:', err));
  };

  // Desktop: ctrl+right-click
  article.addEventListener('contextmenu', (e) => {
    if (!e.ctrlKey) {
      return;
    }

    e.preventDefault();
    openPopup(e.clientX, e.clientY);
  });

  // iOS: press-and-hold (~500ms) on the post brings up the same popup. The
  // ctrlKey path doesn't apply on touch, so we detect a stationary single-
  // finger touch here and trigger once the timer fires. We swallow the
  // following `click`, `contextmenu`, and `touchend` so the system callout
  // doesn't appear and Twitter doesn't navigate to the post.
  //
  // Debug-only: dev bundles (Xcode Debug builds the extension with --dev)
  // enable it via IS_DEV_BUILD. Android debug APKs embed the same prod
  // bundle as release, so their debug source set sets __ff_debugBuild on
  // the page instead (build_flag.js in the GeckoView bridge extension).
  const isDebugNativeShell = IS_DEV_BUILD
    || (window as Window & { __ff_debugBuild?: boolean }).__ff_debugBuild === true;
  if (_deps.IS_IOS && isDebugNativeShell) {
    const LONG_PRESS_MS = 500;
    const MOVE_TOLERANCE_PX = 10;
    let pressTimer: number | null = null;
    let startX = 0;
    let startY = 0;
    let triggered = false;

    const cancelTimer = () => {
      if (pressTimer !== null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    article.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        cancelTimer();
        triggered = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      triggered = false;
      cancelTimer();
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        triggered = true;
        openPopup(startX, startY);
      }, LONG_PRESS_MS);
    }, { passive: true });

    article.addEventListener('touchmove', (e: TouchEvent) => {
      if (pressTimer === null) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_TOLERANCE_PX) {
        cancelTimer();
      }
    }, { passive: true });

    article.addEventListener('touchend', (e: TouchEvent) => {
      cancelTimer();
      if (triggered) e.preventDefault();
    });

    article.addEventListener('touchcancel', () => {
      cancelTimer();
      triggered = false;
    });

    // Suppress the click that fires after touchend when long-press triggered,
    // so Twitter doesn't navigate to the post detail page.
    article.addEventListener('click', (e) => {
      if (triggered) {
        e.preventDefault();
        e.stopPropagation();
        triggered = false;
      }
    }, true);

    // Also block the iOS system callout menu if the WebView fires it.
    article.addEventListener('contextmenu', (e) => {
      if (triggered || pressTimer !== null) e.preventDefault();
    });
  }
}

async function fetchReasoningIfNeeded(article: HTMLElement) {
  if (_deps.postReasonings.has(article)) return;

  const content = _deps.extractPostContent(article);
  const hasContent = content.text.trim() || (content.imageUrls && content.imageUrls.length > 0);
  if (!hasContent) return;

  try {
    let response: { found?: boolean; shouldHide?: boolean; reasoning?: string; rawResponse?: string } | undefined = await chrome.runtime.sendMessage({
      type: 'getReasoning',
      post: formatPostForEvaluation(content),
      imageUrls: content.imageUrls || [],
      postUrl: content.postUrl || null,
      siteId: _deps.adapter.siteId
    });

    // If not found, try with plain text (DOM re-renders may change HTML but not text)
    if (!response?.found && content.text) {
      response = await chrome.runtime.sendMessage({
        type: 'getReasoning',
        post: content.text,
        imageUrls: content.imageUrls || [],
        postUrl: content.postUrl || null,
        siteId: _deps.adapter.siteId
      });
    }

    if (response && response.found) {
      _deps.postReasonings.set(article, {
        shouldHide: response.shouldHide ?? false,
        reasoning: response.reasoning ?? '',
        rawResponse: response.rawResponse ?? null
      });
    }
  } catch (err) {
    console.debug('Failed to get reasoning:', err);
  }
}

// ==================== DOM Mutation Handler ====================

// ==================== Why Annoying Button ====================

const DEBUG = false;

// Bouncing a reply while the "filter replies" setting is off would be a
// no-op — reply evaluation is skipped entirely on permalink pages — so
// flip the setting on before the new phrase triggers re-evaluation.
async function ensureFilterRepliesEnabled(article: HTMLElement) {
  if (!_deps.adapter.isPermalinkView() || _deps.adapter.isMainPost(article)) return;
  const { filterReplies } = await getStorage(['filterReplies']);
  if (filterReplies === false) {
    await setStorage({ filterReplies: true });
  }
}

// Add inline "why annoying" button next to Share post button
export function addWhyAnnoyingButton(article: HTMLElement) {
  if (!_deps.adapter.getShareButton(article)) {
    return;
  }
  // Don't add twice
  if (article.querySelector('.ff-why-annoying-btn')) {
    return;
  }

  const btn = document.createElement('div');
  btn.className = 'ff-why-annoying-btn';
  btn.setAttribute('role', 'button');
  btn.title = 'Bounce this tweet';
  btn.replaceChildren(parseHTML(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M5 6v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6"/><line x1="10" y1="10" x2="10" y2="17"/><line x1="14" y1="10" x2="14" y2="17"/></svg>`));

  _deps.adapter.insertActionButton(article, btn);

  // Track tooltip reference on the button element
  let btnTooltip: HTMLElement | null = null;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // If tooltip already open on this button, close it
    if (btnTooltip && btnTooltip.isConnected) {
      btnTooltip.remove();
      btnTooltip = null;
      return;
    }

    // Close any other open tooltips
    document.querySelectorAll('.ff-annoying-tooltip').forEach(t => t.remove());

    const content = _deps.extractPostContent(article);

    // Create tooltip — append to body with fixed positioning so it escapes
    // any overflow:hidden ancestors in Twitter's DOM
    const tooltip = document.createElement('div');
    tooltip.className = 'ff-annoying-tooltip';
    document.body.appendChild(tooltip);
    btnTooltip = tooltip;

    // Position the tooltip above the button
    const positionTooltip = () => {
      const btnRect = btn.getBoundingClientRect();
      const viewportW = document.documentElement.clientWidth;
      const edgeMargin = 8;
      const tipW = tooltip.offsetWidth;
      tooltip.style.position = 'fixed';
      // Horizontal: three-way fit check.
      //  1. Right-align (default): tooltip extends leftward from btn.right.
      //  2. Left-align: tooltip extends rightward from btn.left (used when the
      //     button is close to the left edge — common on narrow YouTube mobile).
      //  3. Center-align: neither directional placement fits; clamp the tooltip
      //     into the viewport and slide the notch inline so it still points at
      //     the button.
      tooltip.style.left = '';
      tooltip.style.right = '';
      tooltip.classList.remove('ff-annoying-tooltip--align-left');
      tooltip.classList.remove('ff-annoying-tooltip--align-center');
      tooltip.style.removeProperty('--ff-notch-x');
      const fitsRightAligned = btnRect.right - tipW >= edgeMargin;
      const fitsLeftAligned = btnRect.left + tipW <= viewportW - edgeMargin;
      if (fitsRightAligned) {
        tooltip.style.right = `${viewportW - btnRect.right}px`;
      } else if (fitsLeftAligned) {
        tooltip.style.left = `${Math.max(edgeMargin, btnRect.left)}px`;
        tooltip.classList.add('ff-annoying-tooltip--align-left');
      } else {
        const btnCenterX = btnRect.left + btnRect.width / 2;
        const idealLeft = btnCenterX - tipW / 2;
        const clampedLeft = Math.min(
          Math.max(edgeMargin, idealLeft),
          viewportW - edgeMargin - tipW,
        );
        tooltip.style.left = `${clampedLeft}px`;
        tooltip.classList.add('ff-annoying-tooltip--align-center');
        // Notch x measured from tooltip's own left edge; center of the 10px
        // notch lands on btnCenterX in viewport coords. Clamp inside the
        // rounded corners so the notch never draws into the border-radius arc.
        const notchInset = 12;
        const rawNotchX = btnCenterX - clampedLeft - 5;
        const notchX = Math.min(
          Math.max(notchInset, rawNotchX),
          tipW - notchInset - 10,
        );
        tooltip.style.setProperty('--ff-notch-x', `${notchX}px`);
      }
      // Place above the button; if clipped, place below
      tooltip.style.bottom = '';
      tooltip.style.top = '';
      const tentativeTop = btnRect.top - tooltip.offsetHeight - 8;
      if (tentativeTop < 0) {
        tooltip.style.top = `${btnRect.bottom + 8}px`;
        tooltip.classList.add('ff-annoying-tooltip--flipped');
      } else {
        tooltip.style.bottom = `${window.innerHeight - btnRect.top + 8}px`;
        tooltip.classList.remove('ff-annoying-tooltip--flipped');
      }
    };
    requestAnimationFrame(positionTooltip);

    // Reposition on scroll; dismiss if button leaves viewport
    const onScroll = () => {
      if (!tooltip.isConnected) {
        window.removeEventListener('scroll', onScroll, true);
        return;
      }
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.bottom < 0 || btnRect.top > window.innerHeight) {
        tooltip.remove();
        window.removeEventListener('scroll', onScroll, true);
        return;
      }
      positionTooltip();
    };
    window.addEventListener('scroll', onScroll, true);

    // Use prefetched result if available, otherwise fire a new request
    let cachedPromise = annoyingReasonsCache.get(article);
    if (!cachedPromise) {
      cachedPromise = chrome.runtime.sendMessage({
        type: 'suggestAnnoyingReasons',
        post: content.text,
        imageUrls: content.imageUrls || [],
        siteId: _deps.adapter.siteId
      });
      annoyingReasonsCache.set(article, cachedPromise);
    }

    (async () => {
    // Check if the promise is already resolved (settled) by racing with an instant resolve
    let response: { reasons: string[]; hadImages?: boolean } | null = null;
    const settled = await Promise.race([
      cachedPromise.then((r: { reasons: string[]; hadImages?: boolean }) => { response = r; return 'done' as const; }),
      Promise.resolve('pending' as const)
    ]);
    const alreadyDone = settled === 'done';

    if (!alreadyDone) {
      // Still loading — show spinner while we wait
      tooltip.replaceChildren(parseHTML(`<div class="ff-annoying-spinner"><div class="ff-spinner-dot"></div><div class="ff-spinner-dot"></div><div class="ff-spinner-dot"></div></div><span class="ff-annoying-thinking">Diagnosing annoyances</span><div class="ff-progress-bar"><div class="ff-progress-track"><div class="ff-progress-fill" data-stage="0"></div></div></div><a href="#" class="ff-missed-link">This should already be filtered</a>`));

      const progressListener = (message: { type: string; verified: number }) => {
        if (message.type === 'annoyingProgress') {
          const fill = tooltip.querySelector<HTMLElement>('.ff-progress-fill');
          if (fill) {
            const stage = Math.min(message.verified, 3);
            fill.dataset.stage = String(stage);
            fill.style.width = `${(stage / 3) * 100}%`;
          }
        }
      };
      chrome.runtime.onMessage.addListener(progressListener);

      const cleanupProgress = () => {
        chrome.runtime.onMessage.removeListener(progressListener);
      };

      tooltip.querySelector('.ff-missed-link')!.addEventListener('click', (linkEvent) => {
        linkEvent.preventDefault();
        linkEvent.stopPropagation();
        tooltip.remove();
        storeFilteredPost(article, content, 'User reported: should have been filtered');
        article.style.transition = 'opacity 0.3s ease';
        article.style.opacity = '0';
        setTimeout(() => hidePost(article), 300);
        chrome.runtime.sendMessage({
          type: 'overrideCacheEntry',
          post: formatPostForEvaluation(content),
          imageUrls: content.imageUrls || [],
          postUrl: content.postUrl || null,
          siteId: _deps.adapter.siteId,
          shouldHide: true,
          reasoning: 'User reported: should have been filtered'
        }).catch(err => console.error('[Sieve] Override cache error:', err));
      });
      try {
        response = await cachedPromise;
      } catch (err) {
        console.error('[Sieve] Why annoying error:', err);
        cleanupProgress();
        tooltip.replaceChildren(parseHTML('<span class="ff-annoying-empty">Error - try again</span>'));
        annoyingReasonsCache.delete(article);
        return;
      }
      cleanupProgress();
    }

    // Render results
    tooltip.replaceChildren();
    if (response && response.reasons?.length) {
      const resp = response;
      const label = document.createElement('span');
      label.className = 'ff-annoying-label';
      label.textContent = 'Block this due to:';
      tooltip.appendChild(label);
      resp.reasons.forEach(r => {
        const chip = document.createElement('button');
        chip.className = 'ff-annoying-chip';
        chip.textContent = r;
        if (DEBUG) {
          const imgBadge = document.createElement('span');
          imgBadge.className = 'ff-img-badge';
          imgBadge.textContent = resp.hadImages ? '[img]' : '[txt]';
          chip.appendChild(imgBadge);
        }
        chip.addEventListener('click', (ce) => {
          ce.stopPropagation();
          // Remove tooltip before the filter triggers re-evaluation and captures the post
          tooltip.remove();
          ensureFilterRepliesEnabled(article)
            .then(() => addFilterPhrase(r))
            .catch(err => console.error('[UI] addFilterPhrase failed:', err));
        });
        tooltip.appendChild(chip);
      });

      // "Something else" custom input
      const customWrapper = document.createElement('div');
      customWrapper.className = 'ff-annoying-custom-wrapper';

      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.className = 'ff-annoying-custom-input';
      customInput.placeholder = 'something else';

      const sendBtn = document.createElement('button');
      sendBtn.className = 'ff-annoying-send-btn';
      sendBtn.replaceChildren(parseHTML('<svg viewBox="0 0 24 24"><path d="M3 12h18M21 12l-6-6M21 12l-6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'));

      const submitCustomInput = () => {
        const value = customInput.value.trim();
        if (!value) return;
        tooltip.remove();
        ensureFilterRepliesEnabled(article)
          .then(() => addFilterPhrase(value))
          .catch(err => console.error('[UI] addFilterPhrase failed:', err));
        // Forcibly remove this post regardless of AI evaluation
        const reasoning = `User blocked: ${value}`;
        storeFilteredPost(article, content, reasoning, '', value);
        article.style.transition = 'opacity 0.3s ease';
        article.style.opacity = '0';
        setTimeout(() => hidePost(article), 300);
        chrome.runtime.sendMessage({
          type: 'overrideCacheEntry',
          post: formatPostForEvaluation(content),
          imageUrls: content.imageUrls || [],
          postUrl: content.postUrl || null,
          siteId: _deps.adapter.siteId,
          shouldHide: true,
          reasoning
        }).catch(err => console.error('[Sieve] Override cache error:', err));
      };

      customInput.addEventListener('click', (e) => e.stopPropagation());
      customInput.addEventListener('input', () => {
        customWrapper.classList.toggle('has-text', customInput.value.length > 0);
      });
      customInput.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.stopPropagation();
          submitCustomInput();
        }
      });
      sendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        submitCustomInput();
      });

      customWrapper.appendChild(customInput);
      customWrapper.appendChild(sendBtn);
      tooltip.appendChild(customWrapper);
    } else {
      tooltip.replaceChildren(parseHTML('<span class="ff-annoying-empty">No suggestions</span>'));
    }
      // "Should have been filtered" link
      const missedLink = document.createElement('a');
      missedLink.className = 'ff-missed-link';
      missedLink.textContent = 'This should already be filtered';
      missedLink.href = '#';
      missedLink.addEventListener('click', (linkEvent) => {
        linkEvent.preventDefault();
        linkEvent.stopPropagation();
        tooltip.remove();
        storeFilteredPost(article, content, 'User reported: should have been filtered');
        article.style.transition = 'opacity 0.3s ease';
        article.style.opacity = '0';
        setTimeout(() => hidePost(article), 300);
        chrome.runtime.sendMessage({
          type: 'overrideCacheEntry',
          post: formatPostForEvaluation(content),
          imageUrls: content.imageUrls || [],
          postUrl: content.postUrl || null,
          siteId: _deps.adapter.siteId,
          shouldHide: true,
          reasoning: 'User reported: should have been filtered'
        }).catch(err => console.error('[Sieve] Override cache error:', err));
      });
      tooltip.appendChild(missedLink);

    // Reposition after content change (height may differ from spinner)
    requestAnimationFrame(positionTooltip);
    })().catch(err => console.error('[UI] annoying reasons tooltip failed:', err));
  });

  // Outside-click tooltip dismissal is handled by a single module-level
  // listener registered via setupAnnoyingTooltipCloser — do NOT register a
  // per-button document listener here (it would accumulate one per post and
  // fire for every click on the page).
}

// Close any open .ff-annoying-tooltip when the user clicks outside of its
// button and the tooltip itself. Registered once per page from initUI.
// On iOS, use capture phase to swallow the dismissing click so the tap only
// closes the tooltip and doesn't also activate the thing it landed on.
export function setupAnnoyingTooltipCloser() {
  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    // If the click is on any why-annoying button, let that button's own
    // click handler manage the tooltip. Skip.
    if (target instanceof Element && target.closest('.ff-why-annoying-btn')) return;
    const tooltips = document.querySelectorAll('.ff-annoying-tooltip');
    if (tooltips.length === 0) return;
    let removedAny = false;
    tooltips.forEach((t) => {
      if (!t.contains(target)) {
        t.remove();
        removedAny = true;
      }
    });
    if (removedAny && _deps.IS_IOS) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

// Hide Sieve sidebar when Twitter's search suggestions menu is open (so it doesn't cover the dropdown)
export function setupSearchBarHide() {
  new MutationObserver(() => {
    const form = _deps.adapter.getSearchForm();
    const secondChild = form?.children[1];
    const menuOpen = secondChild && secondChild.innerHTML.trim() !== '';
    if (filterPhrasesContainer) {
      filterPhrasesContainer.style.display = menuOpen ? 'none' : '';
    }
  }).observe(document.body, { childList: true, subtree: true });
}

export function handleDOMMutation() {
  // Check if containers were disconnected
  if (filterPhrasesContainer && !filterPhrasesContainer.isConnected) {
    filterPhrasesContainer = null;
    filteredTabActive = false;
  }
  if (bottomFilterContainer && !bottomFilterContainer.isConnected) {
    bottomFilterContainer = null;
    bottomFilterExpanded = true;
  }
  if (mobileFilterContainer && !mobileFilterContainer.isConnected) {
    mobileFilterContainer = null;
  }
  if (_deps.adapter.filterBoxPlacement === 'banner') {
    if (!filterPhrasesContainer) {
      injectBannerFilterBox();
    } else {
      updateBannerFilterVisibility();
    }
    if (_deps.adapter.siteId === 'threads') {
      if (!bottomFilterContainer) {
        injectBottomFilterBox();
      } else {
        updateBottomFilterPosition();
        updateBottomFilterVisibility();
      }
    }
    return;
  }
  // Inject filter phrases input if not present
  if (!filterPhrasesContainer && document.querySelector(_deps.adapter.selectors.sidebar)) {
    injectFilterPhrasesInput();
  } else {
    updateSidebarFilterVisibility();
  }
  // Inject bottom filter box if not present
  if (!bottomFilterContainer) {
    injectBottomFilterBox();
  } else {
    updateBottomFilterVisibility();
  }
  // Inject mobile filter box if not present
  if (!mobileFilterContainer && document.querySelector(_deps.adapter.selectors.nav)) {
    injectMobileFilterBox();
  } else {
    updateMobileFilterVisibility();
  }
}
