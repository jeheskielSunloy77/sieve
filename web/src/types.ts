// ==================== Site IDs ====================

/** Known platform adapter identifiers — derived from the PLATFORMS literal
 *  in shared/platforms.ts. Adding a new platform there automatically extends
 *  this union. Re-exported here so existing `import { SiteId } from '../types'`
 *  call sites keep working without touching every consumer. */
import type { SiteId } from './shared/platforms';
export type { SiteId };

/** Where the filter box is rendered on a platform.
 *  - `sidebar`: Twitter-style — pinned in the right-hand column, with companion
 *    bottom and mobile variants injected as well.
 *  - `banner`: full-width strip inserted above the main feed. Used on
 *    platforms without a usable right-hand column. */
export type FilterBoxPlacement = 'sidebar' | 'banner';

/** Where a banner-style adapter wants the filter box inserted. */
export interface FilterBoxAnchor {
  parent: HTMLElement;
  insertBefore: Node | null;
}

// ==================== Core Evaluation ====================

/** Snapshot of one detector's contribution to an evaluation. Persisted in the
 *  cache so the popup can replay tabs identically on cache hits. */
export interface DetectorSnapshot {
  status: 'success' | 'error' | 'skipped';
  shouldHide?: boolean;
  reasoning?: string;
  category?: string | null;
  error?: string;
  /** Either pre-run skip reason or post-race "aborted because other detector
   *  hid first" — both render the same way in the popup. */
  skipReason?: string;
}

/** The cached verdict for a post — what parseAPIResponse produces and what gets stored. */
export interface EvaluationResult {
  shouldHide: boolean;
  reasoning: string;
  category?: string | null;
  rawResponse?: string | null;
  timestamp?: number;
  /** Which model produced this evaluation. */
  model?: string;
  /** Set by the background when the result came from the evaluation cache. */
  cached?: boolean;
  /** Per-detector snapshots so a cache hit can rebuild the same tab UI. */
  detectorStates?: { names: string[]; map: Record<string, DetectorSnapshot> };
}

/** The post data sent to a model for evaluation. */
export interface EvaluationPostData {
  text: string;
  imageUrls: string[];
}

// ==================== Pipeline Response ====================

/** What the pipeline returns to content scripts via chrome.runtime.sendMessage. */
export type PipelineResponse = EvaluationResult | PipelineError | PipelineRetry | null;

/** Evaluation failed — content should track for retry via error broadcasts. */
export interface PipelineError {
  error: 'auth' | 'rate_limit' | 'not_found' | 'server_error' | 'no_api_key';
  reasoning: string;
}

/** Transient signal — content should remove from processed and retry later. */
export interface PipelineRetry {
  retry: true;
  reasoning: string;
}

// ==================== Post Content ====================

/** Quoted tweet metadata, extracted from DOM or store. */
export interface QuoteContent {
  textHtml: string;
  author: string;
  handle: string;
  avatarUrl: string | null;
  timeText: string | null;
}

/** Extracted from DOM by the platform adapter. */
export interface PostContent {
  text: string;
  author: string;
  handle: string;
  avatarUrl: string | null;
  timeText: string | null;
  textHtml: string;
  quote: QuoteContent | null;
  postUrl: string | null;
  imageUrls: string[];
  /** Optional higher-quality URLs for the filtered-posts panel. `imageUrls`
   *  is what we send to the classifier (small, JPEG-guaranteed); when an
   *  adapter wants the panel to display a richer image (e.g. YouTube's
   *  hqdefault thumbnail vs. the classifier's mqdefault), it sets this.
   *  Falls back to `imageUrls` when absent. */
  displayImageUrls?: string[];
  hasMediaContainer: boolean;
  fromStore?: boolean;
  mediaBlurred?: boolean;
  /** LinkedIn-only: connection degree ("1st", "2nd", "3rd+", or null when
   *  not surfaced by the post). Other adapters leave this undefined. */
  degree?: string | null;
}

/** Stored for the "filtered posts" panel — includes captured display data for re-rendering. */
export interface FilteredPost {
  /** Snapshot of the post content at the time it was filtered. */
  post: PostContent;
  /** The evaluation text string sent to the AI (for cache key / feedback). */
  evaluationText: string;
  reasoning: string;
  rawResponse: string;
  category: string | null;
  timestamp: number;
}

// ==================== Models & Config ====================

/** A model in the catalog — covers predefined and custom models. */
export interface ModelDef {
  name: string;
  display: string;
  isFree?: boolean;
  supportsImages?: boolean;
  sizeGB?: number;
  apiKwargs?: Record<string, unknown>;
  api?: string;
}

/** A local model with backend-specific configuration. */
export interface LocalModelDef extends ModelDef {
  isLocal?: boolean;
  backend?: 'litertlm';
  extraBody?: Record<string, unknown>;
  inferenceParams?: Record<string, unknown>;
  // iOS on-device entries only — carried over from the native registry
  // (LocalInferenceService.models) via the injected __iosLocalModels global;
  // see shared/models.ts.
  sizeDisplay?: string;
  isSupportedOnThisDevice?: boolean;
  requiredRAMDisplay?: string;
  litertlmConfig?: {
    // Absolute URL to the `.litertlm` model asset.
    modelUrl: string;
    // Combined prompt + output token budget passed to mainExecutorSettings.maxNumTokens.
    maxTokens?: number;
    // Sampler knobs forwarded to SessionConfig.samplerParams. inferenceParams
    // override these per-call via the existing LocalBackend.generate(params) channel.
    topK?: number;
  };
}

/** A free model configured via environment variable credentials. */
export interface FreeModelDef extends ModelDef {
  id: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  apiBase?: string;
}

/** Typed map for PREDEFINED_MODELS — local models get extended fields. */
export interface PredefinedModelsMap {
  local: LocalModelDef[];
  iosLocal: LocalModelDef[];
  free?: FreeModelDef[];
  [provider: string]: (ModelDef | LocalModelDef | FreeModelDef)[] | undefined;
}

/** Runtime config for making an API call. Built by processBatch from Settings + ModelDef. */
export interface APIConfig {
  apiName: string;
  modelName: string;
  apiKey?: string | null;
  apiBase?: string;
  apiKwargs?: Record<string, unknown>;
  modelConfig?: ModelDef;
}

/** Fields shared between runtime Settings and the chrome.storage.local schema. */
interface SettingsBase {
  openaiApiKey: string;
  openaiApiBase: string;
  openrouterApiKey: string;
  geminiApiKey: string;
  geminiApiBase: string;
  anthropicApiKey: string;
  anthropicApiBase: string;
  enabled: boolean;
  selectedModel: string;
  customModels: ModelDef[];
  predefinedModelKwargs: Record<string, Record<string, unknown>>;
  aiTextDetectionThreshold: number;
  // Threshold applied instead of aiTextDetectionThreshold when the post
  // being evaluated is a reply/comment (permalink-view posts).
  aiTextReplyDetectionThreshold: number;
  aiImageDetectionThreshold: number;
  // When false, replies on permalink (/status/<id>) pages are not
  // submitted for evaluation. The main timeline is unaffected either way.
  // Defaults to true to preserve historical behavior.
  filterReplies: boolean;
  // Per-platform master switches. Default to true so existing installs
  // keep filtering on every supported platform; the content script reads
  // the matching key based on `adapter.siteId` and skips all processing
  // when its platform's switch is off. Stored in chrome.storage.local under
  // `${siteId}Enabled` keys (see enabledStorageKey in shared/platforms.ts);
  // this map is derived from those keys at settings-read time.
  platformEnabled: Partial<Record<SiteId, boolean>>;
  // When true on YouTube, filtered videos are left in the grid and shown
  // as a "Filtered by Sieve" placeholder card (see youtube.css). Default
  // false — remove the card outright, matching Twitter's behavior.
  youtubeShowPlaceholder: boolean;
}

export interface Settings extends SettingsBase {
  descriptions: string[];
  /** `descriptions` minus the phrases that only engage AI detection
   *  (AiFilterIntentState.aiPhrases). The exclusion applies only on the
   *  cloud model path — on local/BYOK models (no AI detector) this equals
   *  `descriptions`. Use this for filtering; `descriptions` remains the
   *  display/edit surface. */
  effectiveDescriptions: string[];
  /** Derived at settings-read time: the inferred "user wants AI content
   *  removed" state FOR THE SITE these settings were loaded for — true only
   *  when one of that site's own phrases was judged an AI-removal request
   *  (aiIntentActiveForSite). The sole gate for the AI text/image detectors —
   *  there is no manual toggle. Always false when getSettings was called
   *  without a siteId. */
  aiFilterIntentActive: boolean;
}

/** Persisted judgment of which of the user's filter phrases request removal
 *  of AI-generated content — from the backend's detectAiIntent route, or a
 *  local model's equivalent judgment. Written only by
 *  src/background/ai-intent.ts; read wherever the AI-detection state is
 *  computed (pipeline, popup, content UI, iOS bridge). */
export interface AiFilterIntentState {
  /** Verbatim filter phrases judged as AI-removal requests, across ALL
   *  platforms (the judge sees the union so each phrase is judged once).
   *  AI detection engages per platform: only where the platform's own list
   *  contains one of these (aiIntentActiveForSite). On the cloud model path
   *  these are also excluded from the tweet-filter categories (see
   *  Settings.effectiveDescriptions). */
  aiPhrases: string[];
  /** phraseSetKey of the phrase-set union the last successful intent
   *  judgment covered — lets refreshAiFilterIntent skip re-judging a set
   *  that was already judged (each set is judged once, authoritatively). */
  judgedSetKey: string | null;
  updatedAt: number;
}

export interface LocalModelStatus {
  state: 'not_downloaded' | 'downloading' | 'cached' | 'ready'
    | 'initializing' | 'error' | 'unsupported';
  progress?: number;
  text?: string;
  error?: string;
  reason?: string;
}

// ==================== Platform Adapter ====================

export interface PlatformSelectors {
  post: string;
  sidebar: string;
  sidebarContent: string;
  primaryColumn: string;
  nav: string;
  bottomBar: string;
  mutations: string;
  textContent: string;
}

export interface PlatformAdapter {
  siteId: SiteId;
  selectors: PlatformSelectors;
  /** Optional platform hydration barrier. Content processing and in-page UI
   *  injection wait for this before mutating a server-rendered application. */
  waitUntilReady?(): Promise<void>;
  /** Optional live primary-column lookup for responsive UI positioning when a
   *  stable CSS selector is unavailable. */
  getPrimaryColumn?(): HTMLElement | null;
  /** Where to render the filter box on this platform. Defaults to `'sidebar'`
   *  when omitted, for backwards compatibility with the original Twitter adapter. */
  filterBoxPlacement?: FilterBoxPlacement;
  /** Banner-style adapters return the anchor (parent + insertBefore reference)
   *  where the banner should be inserted in the page. Sidebar-style adapters
   *  don't need this — they use `selectors.sidebar`. */
  getFilterBoxAnchor?(): FilterBoxAnchor | null;
  extractPostContent(article: HTMLElement): PostContent;
  shouldProcessCurrentPage(): boolean;
  isMainPost(article: HTMLElement): boolean;
  /**
   * True when the current page is a permalink / conversation view — the
   * main post sits at the top and everything below it is replies. Used
   * by the "Filter replies/comments" toggle to gate evaluation on those
   * replies. Returns false on home / explore / search.
   */
  isPermalinkView(): boolean;
  getPostUrl(article: HTMLElement): string | null;
  getPostContentKey(article: HTMLElement): string;
  getPostContainer(article: HTMLElement): HTMLElement;
  hidePost(article: HTMLElement): void;
  getThemeMode(): 'light' | 'dim' | 'dark';
  extractPostContentFromStore(article: HTMLElement): Promise<PostContent | null>;
  cleanupFilteredPostHtml(tweetContent: HTMLElement, imageUrls: string[]): void;
  getShareButton(article: HTMLElement): HTMLElement | null;
  insertActionButton(article: HTMLElement, button: HTMLElement): void;
  getSearchForm(): HTMLElement | null;
}

// ==================== Pipeline Internals ====================

export interface ErrorState {
  type: 'auth' | 'rate_limit' | 'not_found' | 'server_error' | null;
  subType: string | null;
  count: number;
  apiDisplayName: string | null;
}

export interface PendingEvaluation {
  /** Per-call UUID so tab dispatch messages can be routed back to the
   *  originating article even when its postUrl is null (ads, etc.). */
  evaluationId: string;
  post: string;
  /** Raw post text without the "Author: " prefix. Used by AI text detection
   *  so the model only sees the post content, not author metadata. */
  rawText: string;
  imageUrls: string[];
  resolve: (result: PipelineResponse) => void;
  cacheKey: string;
  tabId: number | undefined;
  postUrl: string | null;
  siteId: SiteId;
  /** True when the post is a reply/comment (permalink-view post). Selects
   *  the reply-specific AI-text-detection threshold. */
  isReply: boolean;
}

// ==================== Chat Messages ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

// ==================== Chrome Extension Messages ====================

export type ContentToBackgroundMessage =
  | { type: 'pageLoad' }
  | { type: 'evaluatePost'; evaluationId: string; post: string; rawText: string; imageUrls: string[]; postUrl: string | null; siteId: SiteId; isReply?: boolean }
  | { type: 'suggestAnnoyingReasons'; post: string; imageUrls: string[]; siteId?: SiteId }
  | { type: 'clearCache' }
  | { type: 'clearSinglePost'; post: string; imageUrls: string[]; postUrl?: string | null; siteId?: SiteId }
  | { type: 'getReasoning'; post: string; imageUrls: string[]; postUrl?: string | null; siteId?: SiteId }
  | { type: 'getErrorStatus' }
  | { type: 'getAllLocalModelStatuses' }
  | { type: 'initializeLocalModel'; modelId: string }
  | { type: 'cancelLocalModelDownload'; modelId: string }
  | { type: 'preemptInference' }
  | { type: 'overrideCacheEntry'; post: string; imageUrls: string[]; shouldHide: boolean; reasoning?: string; postUrl?: string | null; siteId?: SiteId }
  | { type: 'launchOpenRouterAuth' };

export type BackgroundToContentMessage =
  | { type: 'ping' }
  | { type: 'latencyUpdate'; isHighLatency: boolean; medianLatency: number; selectedModel: string; hasAlternativeApis: boolean }
  | { type: 'errorStatusUpdate'; errorType: string | null; subType: string | null; count: number; apiDisplayName: string | null; selectedModel: string; hasAlternativeApis: boolean }
  | { type: 'reEvaluateErrors' }
  | { type: 'queueStatusUpdate'; pendingCount: number; isLocalModel: boolean; modelInitializing: boolean }
  | { type: 'getPositions'; postUrls: string[]; evaluationIds?: string[] }
  | { type: 'processingPost'; postUrl: string }
  | { type: 'annoyingProgress'; verified: number; total: number }
  | { type: 'evaluationStarted'; evaluationId: string; detectorNames: string[] }
  | { type: 'detectorResponse'; evaluationId: string; detectorName: string; shouldHide?: boolean; reasoning?: string; category?: string | null; error?: string; skipped?: boolean; skipReason?: string }
  | { type: 'triggerShareFilterPack' };

// ==================== Dependency Injection ====================

export interface PlatformContext {
  adapter: PlatformAdapter;
  descriptionsKey: DescriptionKey;
  IS_IOS: boolean;
}

export interface IOSUICallbacks {
  getIOSPageContainer: () => HTMLElement | null;
  getFFFabButton: () => HTMLElement | null;
  updateIOSFilteredCount: () => void;
  renderIOSCategories: (page: HTMLElement) => void;
}

export interface PostOperations {
  findPosts: () => HTMLElement[];
  extractPostContent: (article: HTMLElement) => PostContent;
  reEvaluateAllPosts: () => void;
  processExistingPosts: () => void;
  evaluatePost: (article: HTMLElement) => Promise<void>;
  reEvaluateSinglePost: (article: HTMLElement) => Promise<void>;
}

export interface PostState {
  processedPosts: WeakSet<HTMLElement>;
  postReasonings: WeakMap<HTMLElement, { shouldHide: boolean; reasoning: string; rawResponse?: string | null; isApiError?: boolean }>;
  pendingPosts: Set<HTMLElement>;
}

export interface ContentUIDeps extends PlatformContext, IOSUICallbacks, PostOperations, PostState {}

export interface IOSDeps {
  adapter: PlatformAdapter;
  descriptionsKey: DescriptionKey;
  showSettingsModal: () => void;
  renderFilteredPostsView: (container: HTMLElement) => void;
  updateTheme: () => void;
  addFilterPhrase: (phrase: string) => Promise<boolean>;
  removeFilterPhrase: (phrase: string) => Promise<void>;
  getFilteredPosts: () => FilteredPost[];
}

// ==================== Chrome Storage Schema ====================

/** Per-site description keys, derived from SiteId. */
type DescriptionKeys = { [K in SiteId as `descriptions_${K}`]: string[] };

/** Per-platform master-switch keys, derived from SiteId. Adding a new
 *  platform automatically extends this map. */
type PlatformEnabledKeys = { [K in SiteId as `${K}Enabled`]: boolean };

/** Valid storage keys for site-specific descriptions. */
export type DescriptionKey = `descriptions_${SiteId}`;

/** Typed schema for chrome.storage.local keys. */
export type StorageSchema = SettingsBase & {
  authErrorApis: Record<string, boolean>;
  cachedDynamicModels?: Record<string, ModelDef[]>;
  // Inferred "user wants AI content removed" state, judged from the phrase
  // list (backend detectAiIntent route / local model) and re-checked only
  // when the list changes. The sole on/off control for AI detection — there
  // is no manual toggle.
  aiFilterIntent: AiFilterIntentState;
  localModelStatuses: Record<string, LocalModelStatus>;
  // Model key ("local:...") the user picked from the headline radios while
  // its weights weren't downloaded yet. The previous model keeps filtering;
  // the background flips selectedModel to this and clears it once the
  // download lands (see the localModelStatuses storage listener).
  pendingLocalModelSelection: string;
  evaluationCache: Record<string, EvaluationResult>;
  // First-run "REMOVE AI" badge on the AI-detection sparkle. Set (permanently)
  // the first time AI detection turns on; from then on the indicator renders
  // as the plain sparkle icon.
  aiIndicatorBadgeDismissed: boolean;
  lastSeenVersion: string;
} & DescriptionKeys & PlatformEnabledKeys;

// ==================== API Response Types ====================

/** Shape of an OpenAI-compatible chat completions response. */
export interface DirectAPIResponse {
  choices: Array<{
    message: { content: string };
  }>;
}
