/**
 * jsdom does not implement everything the renderer touches. These shims keep
 * the component tests focused on behaviour rather than environment gaps.
 */

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom's canvas has no 2d context; the effects layer already handles a null
// context by doing nothing, so a stub keeps the console quiet.
HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];
