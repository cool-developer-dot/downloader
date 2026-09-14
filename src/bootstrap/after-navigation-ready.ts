/**
 * Yield until after NavigationContainerInner has committed.
 *
 * expo-router's useLinking calls setLastUnhandledLink inside the
 * getInitialURL Promise chain during the container's first render.
 * If that Promise settles before commit, React 19 / Fabric warns:
 * "Can't perform a React state update on a component that hasn't mounted yet"
 * (useLinking.native.js → onUnhandledLinking / url.then$argument_0).
 *
 * VidoraX trigger (not a browser/TikTok path):
 * expo-router `useStore` calls `linking.getInitialURL()` during
 * ContextNavigator render — before NavigationContainerInner exists.
 * getLinkingConfig caches that Promise, so any post-commit clock started
 * at first call can expire under concurrent React before the container
 * fiber mounts. Heavier route trees (e.g. Phase 2 browser) widen the window.
 *
 * Settlement policy:
 * 1) One macrotask — escape the current React render / useStore pass
 * 2) Triple rAF — wait past paint/commit on Hermes / Fabric
 * 3) One macrotask — final yield before useLinking setState
 *
 * Avoid InteractionManager/setImmediate — they can flush in the pre-commit
 * microtask window on Hermes.
 */
export function afterNavigationContainerReady(): Promise<void> {
  return new Promise((resolve) => {
    const afterPaint = () => {
      setTimeout(resolve, 0);
    };

    const scheduleFrames = () => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(afterPaint);
          });
        });
        return;
      }

      // Extremely defensive fallback (tests / unusual runtimes).
      setTimeout(() => {
        setTimeout(afterPaint, 0);
      }, 16);
    };

    // Escape the render pass that may have started getInitialURL from useStore
    // before NavigationContainerInner was created.
    setTimeout(scheduleFrames, 0);
  });
}
