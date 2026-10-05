import { describe, expect, it } from 'vitest';
import platformsConfig from '../../src/shared/platforms.config.json';
import { PLATFORM_IDS, platformById, platformFromHost } from '../../src/shared/platforms';

describe('Threads platform registration', () => {
  it('extends the shared site-id registry and runtime lookups', () => {
    expect(PLATFORM_IDS).toContain('threads');
    expect(platformById('threads')).toMatchObject({
      displayName: 'Threads',
      feedUrl: 'https://www.threads.com/',
    });
    expect(platformFromHost('www.threads.com')?.id).toBe('threads');
  });

  it('ships Threads on Chrome and Firefox but not Safari', () => {
    const threads = platformsConfig.find(platform => platform.id === 'threads');
    expect(threads).toMatchObject({
      targets: ['chrome', 'firefox'],
      manifestHost: 'https://*.threads.com/*',
      adapterScript: 'dist/ThreadsAdapter.js',
      cssPath: 'adapters/threads/threads.css',
    });
    expect(threads?.targets).not.toContain('safari');
  });
});

describe('LinkedIn platform registration', () => {
  it('ships LinkedIn on every supported desktop target', () => {
    const linkedin = platformsConfig.find(platform => platform.id === 'linkedin');
    expect(linkedin).toMatchObject({
      targets: ['chrome', 'firefox', 'safari'],
      manifestHost: 'https://*.linkedin.com/*',
      adapterScript: 'dist/LinkedInAdapter.js',
      cssPath: 'adapters/linkedin/linkedin.css',
    });
  });
});
