export function loadThreadsFixture(): void {
  document.body.innerHTML = `
    <div id="mount_0_0_test">
      <main>
        <div role="region" aria-label="Column body" id="threads-feed-column">
        <div data-pagelet="threads_feed_0">
          <div data-pressable-container="true" id="post-one">
            <header>
              <a href="/@alice"><img alt="alice's profile picture" src="https://cdn.example/alice.jpg"></a>
              <a href="/@alice"><span dir="auto">Alice</span></a>
              <a href="/@alice/post/AAA111?xmt=AQG"><span dir="auto">2h</span></a>
            </header>
            <div class="body"><span dir="auto">A text post about quiet mornings.</span></div>
            <img alt="Sunrise over a city" src="https://cdn.example/sunrise.jpg">
            <div class="actions">
              <div role="button"><svg role="img" aria-label="Like"></svg><span dir="auto">12</span></div>
              <div role="button"><svg role="img" aria-label="Comment"></svg><span dir="auto">3</span></div>
              <div role="button"><svg role="img" aria-label="Repost"></svg></div>
              <div role="button" id="share-one"><svg role="img" aria-label="Share"></svg></div>
            </div>
          </div>
        </div>
        <div data-pagelet="threads_feed_1">
          <div data-pressable-container="true" id="post-two">
            <header>
              <a href="/@bob"><img alt="bob's profile picture" src="https://cdn.example/bob.jpg"></a>
              <a href="/@bob"><span dir="auto">Bob</span></a>
              <a href="/@bob/post/BBB222"><span dir="auto">1h</span></a>
            </header>
            <div><span dir="auto">My take on this:</span></div>
            <div class="quote">
              <a href="/@carol"><span dir="auto">Carol</span></a>
              <div><span dir="auto">The quoted thread body.</span></div>
            </div>
            <video poster="https://cdn.example/poster.jpg"></video>
            <div class="actions">
              <div role="button"><svg role="img" aria-label="Like"></svg></div>
              <div role="button"><svg role="img" aria-label="Comment"></svg></div>
              <div role="button"><svg role="img" aria-label="Repost"></svg></div>
              <div role="button"><svg role="img" aria-label="Share"></svg></div>
            </div>
          </div>
        </div>
        <div data-pressable-container="true" id="not-a-post">
          <a href="/@alice">Alice's profile</a>
          <div role="button">Follow</div>
        </div>
        </div>
        <div id="threads-right-rail">
          <div id="threads-native-rail-card">Native Threads rail content</div>
        </div>
      </main>
    </div>
  `;
}
