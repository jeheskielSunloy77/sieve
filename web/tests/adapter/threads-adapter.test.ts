/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../src/types';
import { loadThreadsFixture } from '../fixtures/threads-dom';

let ThreadsAdapter: new () => PlatformAdapter;

function setUrl(path: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } })
    .happyDOM.setURL(`https://www.threads.com${path}`);
}

beforeEach(async () => {
  setUrl('/');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  await import('../../adapters/threads/ThreadsAdapter.js');
  ThreadsAdapter = window.PostPatrolAdapter;
  loadThreadsFixture();
});

describe('Threads post discovery and extraction', () => {
  it('finds post cards without matching unrelated pressable containers', () => {
    const adapter = new ThreadsAdapter();
    expect(document.querySelectorAll(adapter.selectors.post)).toHaveLength(2);
  });

  it('extracts text, author metadata, canonical URL, and media', () => {
    const adapter = new ThreadsAdapter();
    const post = document.getElementById('post-one')!;
    const content = adapter.extractPostContent(post);

    expect(content.text).toBe('A text post about quiet mornings.');
    expect(content.author).toBe('Alice');
    expect(content.handle).toBe('@alice');
    expect(content.timeText).toBe('2h');
    expect(content.postUrl).toBe('https://www.threads.com/@alice/post/AAA111');
    expect(content.avatarUrl).toBe('https://cdn.example/alice.jpg');
    expect(content.imageUrls).toEqual(['https://cdn.example/sunrise.jpg']);
    expect(content.hasMediaContainer).toBe(true);
  });

  it('does not include profile pictures or engagement counts in evaluated content', () => {
    const adapter = new ThreadsAdapter();
    const content = adapter.extractPostContent(document.getElementById('post-one')!);
    expect(content.text).not.toContain('12');
    expect(content.text).not.toContain('3');
    expect(content.imageUrls).not.toContain('https://cdn.example/alice.jpg');
  });

  it('extracts unambiguous quoted content and a video poster', () => {
    const adapter = new ThreadsAdapter();
    const content = adapter.extractPostContent(document.getElementById('post-two')!);
    expect(content.text).toBe('My take on this: [Quoted: The quoted thread body.]');
    expect(content.quote).toMatchObject({
      author: 'Carol',
      handle: '@carol',
      textHtml: 'The quoted thread body.',
    });
    expect(content.imageUrls).toEqual(['https://cdn.example/poster.jpg']);
  });

  it('uses DOM extraction for the desktop pipeline store hook', async () => {
    const adapter = new ThreadsAdapter();
    const post = document.getElementById('post-one')!;
    await expect(adapter.extractPostContentFromStore(post)).resolves.toEqual(
      adapter.extractPostContent(post)
    );
  });
});

describe('Threads page and permalink behavior', () => {
  it.each(['/', '/search', '/search/topic', '/@alice/post/AAA111'])(
    'processes supported route %s',
    path => {
      setUrl(path);
      expect(new ThreadsAdapter().shouldProcessCurrentPage()).toBe(true);
    }
  );

  it.each(['/@alice', '/activity', '/settings'])('does not process %s', path => {
    setUrl(path);
    expect(new ThreadsAdapter().shouldProcessCurrentPage()).toBe(false);
  });

  it('identifies the main post and replies by permalink code', () => {
    setUrl('/@alice/post/AAA111');
    const adapter = new ThreadsAdapter();
    expect(adapter.isPermalinkView()).toBe(true);
    expect(adapter.isMainPost(document.getElementById('post-one')!)).toBe(true);
    expect(adapter.isMainPost(document.getElementById('post-two')!)).toBe(false);
  });
});

describe('Threads card and UI integration', () => {
  function mockRect(
    element: Element,
    { left, top, width, height }: { left: number; top: number; width: number; height: number }
  ): void {
    element.getBoundingClientRect = () => ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON() { return {}; },
    });
  }

  it('hides the whole card and marks it for generic restoration', () => {
    const adapter = new ThreadsAdapter();
    const post = document.getElementById('post-one')!;
    adapter.hidePost(post);
    expect(post.dataset.filteredByExtension).toBe('true');
    expect(post.style.display).toBe('none');
  });

  it('finds Share and inserts the PostPatrol action after it', () => {
    const adapter = new ThreadsAdapter();
    const post = document.getElementById('post-one')!;
    const share = document.getElementById('share-one')!;
    const button = document.createElement('button');
    adapter.insertActionButton(post, button);
    expect(share.nextElementSibling).toBe(button);
    expect(button.classList.contains('ff-why-annoying-btn--threads')).toBe(true);
  });

  it('anchors the persistent editor before native right-rail content', () => {
    const feed = document.getElementById('threads-feed-column')!;
    const post = document.getElementById('post-one')!;
    const rail = document.getElementById('threads-right-rail')!;
    const nativeCard = document.getElementById('threads-native-rail-card')!;
    mockRect(feed, { left: 250, top: 60, width: 638, height: 900 });
    mockRect(post, { left: 250, top: 60, width: 638, height: 400 });
    mockRect(rail, { left: 902, top: 60, width: 337, height: 700 });
    mockRect(nativeCard, { left: 902, top: 60, width: 337, height: 290 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [nativeCard, rail],
    });

    const adapter = new ThreadsAdapter();
    const anchor = adapter.getFilterBoxAnchor?.();
    expect(anchor?.parent).toBe(rail);
    expect(anchor?.insertBefore).toBe(nativeCard);
    expect(document.body.classList.contains('threads-has-right-rail')).toBe(true);
    expect(adapter.getPrimaryColumn?.()).toBe(feed);
  });

  it('detects a narrow, initially short signed-in right rail', () => {
    const feed = document.getElementById('threads-feed-column')!;
    const post = document.getElementById('post-one')!;
    const rail = document.getElementById('threads-right-rail')!;
    const nativeCard = document.getElementById('threads-native-rail-card')!;
    mockRect(feed, { left: 250, top: 60, width: 638, height: 900 });
    mockRect(post, { left: 250, top: 60, width: 638, height: 400 });
    mockRect(rail, { left: 902, top: 60, width: 220, height: 72 });
    mockRect(nativeCard, { left: 902, top: 60, width: 220, height: 48 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [nativeCard],
    });

    const anchor = new ThreadsAdapter().getFilterBoxAnchor?.();
    expect(anchor?.parent).toBe(rail);
    expect(anchor?.insertBefore).toBe(nativeCard);
    expect(document.body.classList.contains('threads-has-right-rail')).toBe(true);
  });

  it('detects Threads’ wide signed-in right-column wrapper', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    const feed = document.getElementById('threads-feed-column')!;
    const post = document.getElementById('post-one')!;
    const rail = document.getElementById('threads-right-rail')!;
    const nativeCard = document.getElementById('threads-native-rail-card')!;
    mockRect(feed, { left: 633, top: 70, width: 639, height: 900 });
    mockRect(post, { left: 633, top: 70, width: 639, height: 400 });
    mockRect(rail, { left: 1272, top: 70, width: 628, height: 700 });
    mockRect(nativeCard, { left: 1304, top: 484, width: 24, height: 24 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [rail],
    });

    const anchor = new ThreadsAdapter().getFilterBoxAnchor?.();
    expect(anchor?.parent).toBe(rail);
    expect(anchor?.insertBefore).toBe(nativeCard);
    expect(document.body.classList.contains('threads-has-right-rail')).toBe(true);
  });

  it('uses the bottom fallback below the wide-layout breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1279 });
    document.body.classList.add('threads-has-right-rail');
    const adapter = new ThreadsAdapter();
    expect(adapter.getFilterBoxAnchor?.()).toBe(null);
    expect(document.body.classList.contains('threads-has-right-rail')).toBe(false);
  });

  it('creates a fixed right-side host on a wide layout with an empty gutter', () => {
    const feed = document.getElementById('threads-feed-column')!;
    const post = document.getElementById('post-one')!;
    document.getElementById('threads-right-rail')!.remove();
    mockRect(feed, { left: 250, top: 60, width: 638, height: 900 });
    mockRect(post, { left: 250, top: 60, width: 638, height: 400 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [],
    });

    const adapter = new ThreadsAdapter();
    const anchor = adapter.getFilterBoxAnchor?.();
    const host = document.getElementById('postpatrol-threads-right-rail');
    expect(anchor?.parent).toBe(host);
    expect(host).toBeInstanceOf(HTMLElement);
    expect((host as HTMLElement).style.left).toBe('904px');
    expect((host as HTMLElement).style.top).toBe('72px');
    expect((host as HTMLElement).style.width).toBe('336px');
    expect((host as HTMLElement).style.display).toBe('block');
    expect(document.body.classList.contains('threads-has-right-rail')).toBe(true);
  });

  it('detects light and dark computed backgrounds', () => {
    const adapter = new ThreadsAdapter();
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    expect(adapter.getThemeMode()).toBe('light');
    document.body.style.backgroundColor = 'rgb(16, 16, 16)';
    expect(adapter.getThemeMode()).toBe('dark');
  });

  it('claims the global adapter only on a Threads hostname', () => {
    expect(new ThreadsAdapter().siteId).toBe('threads');
    expect(window.location.hostname).toBe('www.threads.com');
  });
});
