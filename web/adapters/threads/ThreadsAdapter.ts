import type {
  FilterBoxAnchor,
  PlatformAdapter,
  PlatformSelectors,
  PostContent,
  QuoteContent,
} from '../../src/types';

const POST_PATH_RE = /^\/@([^/]+)\/post\/([^/?#]+)/;

const SieveThreadsAdapter = class ThreadsAdapter implements PlatformAdapter {
  siteId = 'threads' as const;
  filterBoxPlacement = 'banner' as const;

  selectors: PlatformSelectors = {
    // Threads' CSS classes are generated. These semantic hooks are present in
    // both the authenticated feed and the public logged-out renderer.
    post: '[data-pressable-container="true"]:has(a[href*="/post/"]):has([role="button"])',
    sidebar: '',
    sidebarContent: '',
    primaryColumn: '[role="region"]',
    nav: 'nav, header',
    bottomBar: '',
    mutations: 'span[dir="auto"], img, video',
    textContent: 'span[dir="auto"]',
    caret: 'svg[aria-label="More"], [role="button"][aria-label="More"]',
    dropdown: '[role="dialog"], [role="menu"]',
  };

  constructor() {
    window.addEventListener('resize', () => {
      if (document.getElementById('sieve-threads-right-rail') || document.getElementById('postpatrol-threads-right-rail')) {
        const feed = this.getPrimaryColumn();
        if (feed) {
          const feedRect = feed.getBoundingClientRect();
          this._getFallbackRail(feedRect);
        }
      }
    }, { passive: true });
  }

  waitUntilReady(): Promise<void> {
    // Threads streams SSR markup and then hydrates it. Mutating post cards
    // during that hand-off produces React hydration errors, so wait until the
    // app mount has been quiet briefly. The cap prevents a busy feed from
    // blocking Sieve forever.
    const mount = document.querySelector<HTMLElement>('div[id^="mount_"]');
    if (!mount) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      let quietTimer: ReturnType<typeof setTimeout>;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(quietTimer);
        clearTimeout(capTimer);
        observer.disconnect();
        resolve();
      };
      const armQuietTimer = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, 350);
      };
      const observer = new MutationObserver(armQuietTimer);
      observer.observe(mount, { childList: true, subtree: true });
      armQuietTimer();
      const capTimer = setTimeout(finish, 2500);
    });
  }

  private _cleanText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private _postPath(article: HTMLElement): string | null {
    for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]')) {
      const href = link.getAttribute('href');
      if (!href) continue;
      try {
        const url = new URL(href, window.location.origin);
        if (POST_PATH_RE.test(url.pathname) && !url.pathname.endsWith('/media')) {
          return url.pathname;
        }
      } catch { /* ignore malformed links */ }
    }
    return null;
  }

  private _bodyElements(article: HTMLElement): HTMLElement[] {
    const seen = new Set<string>();
    const result: HTMLElement[] = [];
    for (const span of article.querySelectorAll<HTMLElement>('span[dir="auto"]')) {
      if (span.closest('a, [role="button"]')) continue;
      // Prefer the outermost semantic text span so nested formatting does not
      // cause the same body to be evaluated more than once.
      if (span.parentElement?.closest('span[dir="auto"]')) continue;
      const text = this._cleanText(span.textContent ?? '');
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(span);
    }
    return result;
  }

  private _profileLink(article: HTMLElement): HTMLAnchorElement | null {
    return Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]'))
      .find(link => {
        const href = link.getAttribute('href') ?? '';
        return /^\/@[^/]+\/?$/.test(href) && this._cleanText(link.textContent ?? '').length > 0;
      }) ?? null;
  }

  private _extractQuote(article: HTMLElement, bodies: HTMLElement[]): QuoteContent | null {
    if (bodies.length < 2) return null;
    const quoteBody = bodies[1];
    const profileLinks = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]'))
      .filter(link => /^\/@[^/]+\/?$/.test(link.getAttribute('href') ?? ''));
    const quoteProfiles = profileLinks.filter(link =>
      link.compareDocumentPosition(quoteBody) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const quoteProfile = quoteProfiles[quoteProfiles.length - 1];
    const quoteHref = quoteProfile?.getAttribute('href') ?? '';
    const quoteHandle = quoteHref.match(/^\/@([^/]+)/)?.[1] ?? '';
    return {
      textHtml: quoteBody.innerHTML,
      author: this._cleanText(quoteProfile?.textContent ?? quoteHandle),
      handle: quoteHandle ? `@${quoteHandle}` : '',
      avatarUrl: null,
      timeText: null,
    };
  }

  extractPostContent(article: HTMLElement): PostContent {
    const profileLink = this._profileLink(article);
    const profilePath = profileLink?.getAttribute('href') ?? '';
    const username = profilePath.match(/^\/@([^/]+)/)?.[1] ?? '';
    const author = this._cleanText(profileLink?.textContent ?? username);
    const handle = username ? `@${username}` : '';

    const avatar = Array.from(article.querySelectorAll<HTMLImageElement>('img[src]'))
      .find(img => /profile picture/i.test(img.alt));
    const avatarUrl = avatar && !avatar.src.startsWith('data:') ? avatar.src : null;

    const postPath = this._postPath(article);
    const postLink = postPath
      ? Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'))
          .find(link => {
            try { return new URL(link.href, window.location.origin).pathname === postPath; }
            catch { return false; }
          })
      : null;
    const timeText = this._cleanText(postLink?.textContent ?? '') || null;
    const postUrl = postPath ? `${window.location.origin}${postPath}` : null;

    const bodies = this._bodyElements(article);
    const primaryBody = bodies[0] ?? null;
    const quote = this._extractQuote(article, bodies);
    const textParts = bodies.map((body, index) => {
      const text = this._cleanText(body.textContent ?? '');
      return index === 0 ? text : `[Quoted: ${text}]`;
    });

    const imageUrls: string[] = [];
    for (const img of article.querySelectorAll<HTMLImageElement>('img[src]')) {
      const url = img.currentSrc || img.src;
      if (!url || url.startsWith('data:') || url.startsWith('blob:')) continue;
      if (/profile picture/i.test(img.alt)) continue;
      if (!imageUrls.includes(url)) imageUrls.push(url);
    }
    for (const video of article.querySelectorAll<HTMLVideoElement>('video[poster]')) {
      const poster = video.getAttribute('poster') ?? '';
      let url = poster;
      try { url = new URL(poster, window.location.href).href; }
      catch { /* keep the raw poster when URL normalization fails */ }
      if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !imageUrls.includes(url)) {
        imageUrls.push(url);
      }
    }

    return {
      text: textParts.join(' '),
      author,
      handle,
      avatarUrl,
      timeText,
      textHtml: primaryBody?.innerHTML ?? '',
      quote,
      postUrl,
      imageUrls,
      hasMediaContainer: imageUrls.length > 0 || article.querySelector('video') !== null,
    };
  }

  shouldProcessCurrentPage(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/search' || path.startsWith('/search/') || POST_PATH_RE.test(path);
  }

  isPermalinkView(): boolean {
    return POST_PATH_RE.test(window.location.pathname);
  }

  isMainPost(article: HTMLElement): boolean {
    if (!this.isPermalinkView()) return false;
    const pageCode = window.location.pathname.match(POST_PATH_RE)?.[2];
    const articleCode = this._postPath(article)?.match(POST_PATH_RE)?.[2];
    return !!pageCode && pageCode === articleCode;
  }

  getPostUrl(article: HTMLElement): string | null {
    const path = this._postPath(article);
    return path ? `${window.location.origin}${path}` : null;
  }

  getPostContentKey(article: HTMLElement): string {
    return this.getPostUrl(article)
      ?? this._cleanText(this._bodyElements(article)[0]?.textContent ?? '').slice(0, 200);
  }

  getPostContainer(article: HTMLElement): HTMLElement {
    return article;
  }

  hidePost(article: HTMLElement): void {
    const container = this.getPostContainer(article);
    container.dataset.filteredByExtension = 'true';
    container.style.display = 'none';
  }

  getThemeMode(): 'light' | 'dim' | 'dark' {
    const candidates = [document.body, document.documentElement];
    for (const element of candidates) {
      const match = window.getComputedStyle(element).backgroundColor
        .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) continue;
      const [, r, g, b] = match.map(Number);
      if (r + g + b < 384) return 'dark';
      if (r + g + b > 600) return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  extractPostContentFromStore(article: HTMLElement): Promise<PostContent | null> {
    // Threads exposes no stable public client store. Returning the DOM result
    // prevents the desktop pipeline from exhausting its store retries.
    return Promise.resolve(this.extractPostContent(article));
  }

  cleanupFilteredPostHtml(postContent: HTMLElement, _imageUrls: string[]): void {
    postContent.style.display = '';
    postContent.style.opacity = '1';
    postContent.removeAttribute('data-filtered-by-extension');
    postContent.querySelectorAll('[role="button"], video').forEach(element => element.remove());
  }

  getShareButton(article: HTMLElement): HTMLElement | null {
    const icon = article.querySelector<SVGElement>('svg[aria-label="Share"], svg[aria-label="Send"]');
    if (icon) return icon.closest<HTMLElement>('[role="button"]');
    // Accessible labels are localized. Threads renders Share as the final
    // role=button in a post card, after Like, Comment, and Repost.
    const buttons = Array.from(article.querySelectorAll<HTMLElement>('[role="button"]'));
    return buttons[buttons.length - 1] ?? null;
  }

  insertActionButton(article: HTMLElement, button: HTMLElement): void {
    button.classList.add('ff-why-annoying-btn--threads');
    const share = this.getShareButton(article);
    if (share) {
      share.insertAdjacentElement('afterend', button);
      return;
    }
    const comment = article.querySelector<SVGElement>('svg[aria-label="Comment"]');
    const actionRow = comment?.closest<HTMLElement>('[role="button"]')?.parentElement?.parentElement;
    (actionRow ?? article).appendChild(button);
  }

  getCaretButton(article: HTMLElement): HTMLElement | null {
    const svg = article.querySelector('svg[aria-label="More"]');
    if (svg) return svg.closest<HTMLElement>('[role="button"]') || svg.parentElement;
    return article.querySelector<HTMLElement>('[role="button"][aria-label="More"]');
  }

  getSearchForm(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="search"]')
      ?? document.querySelector<HTMLElement>('input[type="search"]')
      ?? document.querySelector<HTMLElement>('input[placeholder*="Search" i]');
  }

  getPrimaryColumn(): HTMLElement | null {
    const posts = Array.from(document.querySelectorAll<HTMLElement>(this.selectors.post));
    const firstVisible = posts.find(post => {
      const rect = post.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? posts[0];
    return firstVisible?.closest<HTMLElement>('[role="region"]') ?? null;
  }

  private _setFallbackRailVisible(visible: boolean): void {
    const host = document.getElementById('sieve-threads-right-rail') || document.getElementById('postpatrol-threads-right-rail');
    if (host instanceof HTMLElement) host.style.display = visible ? 'block' : 'none';
  }

  private _getFallbackRail(feedRect: DOMRect): HTMLElement | null {
    const availableWidth = window.innerWidth - feedRect.right;
    // Keep enough room for the compact desktop card plus breathing room from
    // the scrollbar. This covers Threads layouts with an empty right gutter.
    if (availableWidth < 300) return null;

    let host = document.getElementById('sieve-threads-right-rail') || document.getElementById('postpatrol-threads-right-rail');
    if (!(host instanceof HTMLElement)) {
      host = document.createElement('div');
      host.id = 'sieve-threads-right-rail';
      host.className = 'sieve-threads-right-rail postpatrol-threads-right-rail';
      document.body.appendChild(host);
    }

    const width = Math.min(336, availableWidth - 24);
    host.style.left = `${Math.round(feedRect.right + 16)}px`;
    host.style.top = '72px';
    host.style.width = `${Math.round(width)}px`;
    host.style.display = 'block';
    return host;
  }

  getFilterBoxAnchor(): FilterBoxAnchor | null {
    const feed = this.getPrimaryColumn();
    if (!feed || window.innerWidth < 1280) {
      document.body.classList.remove('threads-has-right-rail');
      this._setFallbackRailVisible(false);
      return null;
    }

    const feedRect = feed.getBoundingClientRect();
    if (feedRect.width <= 0) {
      document.body.classList.remove('threads-has-right-rail');
      this._setFallbackRailVisible(false);
      return null;
    }

    const sampleX = Math.min(window.innerWidth - 1, feedRect.right + 24);
    const sampleY = Math.max(72, feedRect.top + 24);
    const pointElements = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(sampleX, sampleY)
      : [];
    const mount = document.querySelector<HTMLElement>('div[id^="mount_"]') ?? document.body;
    const eligibleRails = (pool: Element[]): HTMLElement[] =>
      pool.filter((element): element is HTMLElement => {
        if (!(element instanceof HTMLElement) || element === feed || element.contains(feed)) return false;
        const rect = element.getBoundingClientRect();
        // Signed-in Threads can render an initially short sidebar (or a
        // narrower one than the public logged-out view). Its column is still
        // positioned beside the feed, so use that stable geometry instead of
        // requiring a full-height card to have already loaded.
        return rect.left >= feedRect.right - 1
          && rect.right <= window.innerWidth + 1
          && rect.left <= window.innerWidth - 160
          && rect.width >= 180
          // The signed-in desktop shell can reserve the entire remaining
          // viewport width for its otherwise sparse right column.
          && rect.width <= window.innerWidth - feedRect.right + 1
          && rect.height >= 32
          && rect.top <= feedRect.top + 160;
      });
    // Include the whole mount even when the hit-test finds a nested card: we
    // want the sidebar column itself so Sieve remains above native cards.
    const candidates = Array.from(new Set(eligibleRails([
      ...pointElements,
      ...Array.from(mount.querySelectorAll<HTMLElement>('div')),
    ])));
    candidates.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return (aRect.left - feedRect.right) - (bRect.left - feedRect.right)
        || (bRect.height - aRect.height)
        || (bRect.width - aRect.width)
        || (aRect.top - bRect.top);
    });

    const rail = candidates[0] ?? this._getFallbackRail(feedRect);
    this._setFallbackRailVisible(rail !== null);
    document.body.classList.toggle('threads-has-right-rail', rail !== null);
    return rail ? { parent: rail, insertBefore: rail.firstElementChild } : null;
  }
};

if (/(^|\.)threads\.com$/i.test(location.hostname)) {
  window.SieveAdapter = SieveThreadsAdapter;
  window.PostPatrolAdapter = SieveThreadsAdapter;
}
