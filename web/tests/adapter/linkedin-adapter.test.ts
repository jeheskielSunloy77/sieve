/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PlatformAdapter } from '../../src/types';

let LinkedInAdapter: new () => PlatformAdapter;

beforeEach(async () => {
  globalThis.chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-id/${path}`,
    } as unknown as typeof chrome.runtime,
  } as typeof chrome;

  // The adapter only claims `window.PostPatrolAdapter` when running on a
  // linkedin.com host (see LinkedInAdapter.ts). happy-dom defaults to
  // localhost, so point it at linkedin.com before the module's hostname
  // guard runs on import.
  (window as unknown as { happyDOM: { setURL(url: string): void } })
    .happyDOM.setURL('https://www.linkedin.com/feed/');

  await import('../../adapters/linkedin/LinkedInAdapter.js');
  LinkedInAdapter = window.PostPatrolAdapter;
});

// Real desktop SDUI actor header captured from the live feed (obfuscated class
// names). Wrapped in the FeedType listitem so the adapter treats it as desktop.
const ACTOR_HEADER = `
<a tabindex="0" href="https://www.linkedin.com/in/teddy-zheng/">
  <figure>
    <svg viewBox="0 0 128 128" role="img" aria-label="View Teddy Zheng’s profile"></svg>
  </figure>
</a>
<div>
  <div>
    <div>
      <div>
        <a tabindex="0" href="https://www.linkedin.com/in/teddy-zheng/">
          <div>
            <div aria-label="Teddy Zheng Premium Profile 3rd+">
              <div>
                <div><p><span>Teddy Zheng</span></p></div>
              </div>
              <div>
                <p><span><span> </span><span aria-hidden="true"><svg id="linkedin-bug-small" aria-hidden="true" viewBox="0 0 16 16"></svg></span><span> </span>• 3rd+</span></p>
              </div>
            </div>
          </div>
        </a>
      </div>
    </div>
    <div><p><span>Building something new | CS &amp; Film @ Harvard</span></p></div>
    <div><div></div></div>
    <div>
      <p><span>1d •<span> </span><svg id="globe-americas-small" aria-hidden="false" viewBox="0 0 16 16" role="img" aria-label="Visibility: Global"></svg></span></p>
    </div>
    <a tabindex="0" href="https://www.linkedin.com/in/teddy-zheng/"><div></div></a>
  </div>
</div>
`;

function makeDesktopPost(headerHtml: string): HTMLElement {
  const post = document.createElement('div');
  post.setAttribute('role', 'listitem');
  post.setAttribute('componentkey', 'FeedType:12345');
  const header = document.createElement('div');
  header.innerHTML = headerHtml;
  post.appendChild(header);
  document.body.appendChild(post);
  return post;
}

describe('LinkedIn desktop actor header extraction', () => {
  let adapter: PlatformAdapter;
  beforeEach(() => {
    document.body.replaceChildren();
    adapter = new LinkedInAdapter();
  });

  it('extracts author name from the identity aria-label (no control-menu button needed)', () => {
    const post = makeDesktopPost(ACTOR_HEADER);
    expect(adapter.extractPostContent(post).author).toBe('Teddy Zheng');
  });

  it('extracts the headline even when it is wrapped in a <span>, not a <p>', () => {
    const post = makeDesktopPost(ACTOR_HEADER);
    expect(adapter.extractPostContent(post).handle).toBe(
      'Building something new | CS & Film @ Harvard'
    );
  });

  it('extracts the connection degree', () => {
    const post = makeDesktopPost(ACTOR_HEADER);
    expect(adapter.extractPostContent(post).degree).toBe('3rd+');
  });

  it('extracts the timestamp', () => {
    const post = makeDesktopPost(ACTOR_HEADER);
    expect(adapter.extractPostContent(post).timeText).toBe('1d');
  });

  it('returns the headline, not a CTA link that sits between headline and timestamp', () => {
    // Posts can carry a profile CTA ("Book an appointment", "Visit my website")
    // on its own row below the headline. The headline must still win.
    const withCta = ACTOR_HEADER.replace(
      '<div><div></div></div>',
      '<div><a href="https://calendly.com/noah/intro">Book an appointment</a></div>'
    );
    const post = makeDesktopPost(withCta);
    expect(adapter.extractPostContent(post).handle).toBe(
      'Building something new | CS & Film @ Harvard'
    );
  });

  it('falls back to the CTA line when there is no headline', () => {
    // When the author has only a CTA and no headline, show the CTA (matches the
    // earlier "Visit my website" behaviour).
    const ctaOnly = ACTOR_HEADER
      .replace(
        '<div><p><span>Building something new | CS &amp; Film @ Harvard</span></p></div>',
        ''
      )
      .replace(
        '<div><div></div></div>',
        '<div><a href="https://example.com">Visit my website</a></div>'
      );
    const post = makeDesktopPost(ctaOnly);
    expect(adapter.extractPostContent(post).handle).toBe('Visit my website');
  });

  it('does not mistake the author name for the headline when no headline is present', () => {
    // Drop the headline node: the row that holds "Building something new …".
    const noHeadline = ACTOR_HEADER.replace(
      '<div><p><span>Building something new | CS &amp; Film @ Harvard</span></p></div>',
      ''
    );
    const post = makeDesktopPost(noHeadline);
    const content = adapter.extractPostContent(post);
    expect(content.author).toBe('Teddy Zheng');
    expect(content.handle).toBe('');
  });
});

describe('LinkedIn Groups legacy scaffold', () => {
  let adapter: PlatformAdapter;

  beforeEach(() => {
    document.body.replaceChildren();
    adapter = new LinkedInAdapter();
  });

  it('finds the legacy group right rail and primary column', () => {
    document.body.innerHTML = `
      <main class="scaffold-layout__main"></main>
      <aside class="scaffold-layout__aside"></aside>
    `;

    expect(document.querySelector(adapter.selectors.primaryColumn))
      .toBe(document.querySelector('.scaffold-layout__main'));
    expect(document.querySelector(adapter.selectors.sidebar))
      .toBe(document.querySelector('.scaffold-layout__aside'));
  });

  it('discovers and extracts a legacy group discussion card', () => {
    document.body.innerHTML = `
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:12345">
        <div class="update-components-actor">
          <img class="update-components-actor__avatar-image"
               src="https://media.licdn.com/dms/image/profile-displayphoto-shrink_100_100/example.jpg">
          <span class="update-components-actor__name">Ada Lovelace</span>
          <span class="update-components-actor__description">Computing pioneer</span>
          <span class="update-components-actor__sub-description">2d • Edited</span>
        </div>
        <div class="update-components-text"><span>Analytical engines for everyone</span></div>
        <a href="/feed/update/urn:li:activity:12345?trackingId=test">View post</a>
      </div>
    `;

    const post = document.querySelector<HTMLElement>(adapter.selectors.post)!;
    const content = adapter.extractPostContent(post);

    expect(post.classList.contains('feed-shared-update-v2')).toBe(true);
    expect(content.author).toBe('Ada Lovelace');
    expect(content.handle).toBe('Computing pioneer');
    expect(content.timeText).toBe('2d');
    expect(content.text).toBe('Analytical engines for everyone');
    expect(content.postUrl).toBe('https://www.linkedin.com/feed/update/urn:li:activity:12345');
    expect(adapter.getPostContentKey(post)).toBe('urn:li:activity:12345');
  });
});

describe('LinkedIn web feed gate', () => {
  let adapter: PlatformAdapter;

  beforeEach(() => {
    adapter = new LinkedInAdapter();
  });

  it('processes the signed-in home feed', () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } })
      .happyDOM.setURL('https://www.linkedin.com/feed/');
    expect(adapter.shouldProcessCurrentPage()).toBe(true);
  });

  const setURL = (url: string) => (window as unknown as {
      happyDOM: { setURL(url: string): void }
    }).happyDOM.setURL(url);

  it('processes numeric and slugged group discussion feeds', () => {
    setURL('https://www.linkedin.com/groups/13519405/');
    expect(adapter.shouldProcessCurrentPage()).toBe(true);
    setURL('https://www.linkedin.com/groups/marketing-professionals-12345678');
    expect(adapter.shouldProcessCurrentPage()).toBe(true);
  });

  it('skips the groups index and nested group routes', () => {
    setURL('https://www.linkedin.com/groups/');
    expect(adapter.shouldProcessCurrentPage()).toBe(false);
    setURL('https://www.linkedin.com/groups/13519405/manage/membership/requested/');
    expect(adapter.shouldProcessCurrentPage()).toBe(false);
    setURL('https://www.linkedin.com/groups/13519405/members/');
    expect(adapter.shouldProcessCurrentPage()).toBe(false);
  });

  it('skips permalink and non-feed routes in the web extension', () => {
    setURL('https://www.linkedin.com/feed/update/urn:li:activity:123');
    expect(adapter.shouldProcessCurrentPage()).toBe(false);
    setURL('https://www.linkedin.com/search/results/content/');
    expect(adapter.shouldProcessCurrentPage()).toBe(false);
    setURL('https://www.linkedin.com/in/example/');
    expect(adapter.shouldProcessCurrentPage()).toBe(false);
  });
});
