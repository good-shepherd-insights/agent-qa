if (typeof window !== 'undefined') {
  // jsdom has no media resource loader; real duration behavior is exercised in Chromium.
  window.HTMLMediaElement.prototype.load = () => {}
  if (!window.matchMedia) {
    window.matchMedia = media => ({
      matches: false,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    })
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
}
