// Sieve Logo - Vector SVG with spring entry and hover animation

export function getSieveLogoHTML(customClass = ''): string {
  const classes = ['logo', 'v3', 'play', customClass].filter(Boolean).join(' ');
  return `
    <svg class="${classes}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
      <g class="mark">
        <g class="gMain"><g class="hMain"><path class="main" pathLength="1" fill="currentColor" fill-rule="evenodd" d="M 98 56 H 260 C 390 56 456 168 456 235 V 246 A 12 12 0 0 1 444 258 H 418 C 350 256 328 190 312 156 C 298 200 240 262 190 277 C 230 300 290 330 288 375 V 442 A 14 14 0 0 1 274 456 H 232 C 182 456 56 410 56 248 V 98 A 42 42 0 0 1 98 56 Z"/></g></g>
        <g class="gBlock"><g class="hBlock"><path class="block" pathLength="1" fill="currentColor" fill-rule="evenodd" d="M 336 375 C 340 335 350 308 420 302 H 436 A 20 20 0 0 1 456 322 V 422 A 34 34 0 0 1 422 456 H 350 A 14 14 0 0 1 336 442 Z"/></g></g>
      </g>
    </svg>
  `.trim();
}

export interface LogoIntroHandle {
  play: () => void;
}

export function initLogoAnimation(svgElement: SVGSVGElement | null): LogoIntroHandle | null {
  if (!svgElement) return null;
  const svg = svgElement;
  const extendedSvg = svg as SVGSVGElement & { __sieveLogoWired?: boolean; __sieveLogoHandle?: LogoIntroHandle };
  if (extendedSvg.__sieveLogoWired) {
    return extendedSvg.__sieveLogoHandle || null;
  }
  extendedSvg.__sieveLogoWired = true;

  function play() {
    svg.classList.remove('play');
    // Force DOM reflow so restarting the CSS animation works reliably
    void svg.getBoundingClientRect();
    svg.classList.add('play');
  }

  const handle: LogoIntroHandle = { play };
  extendedSvg.__sieveLogoHandle = handle;

  svg.addEventListener('click', (e) => {
    e.stopPropagation();
    play();
  });

  return handle;
}
