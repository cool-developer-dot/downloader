/**
 * Whether the player's views (full Player, mini player) hold a video surface. Both use a TextureView, which keeps its
 * surface while the activity is stopped although nothing draws it: with background play the decoder then cannot hand
 * out a frame, so a seek from the media notification or the lock screen never becomes ready (Media3 gives up after ten
 * minutes). While VidoraX is stopped with background play on, the views let go of the player (it plays sound only);
 * they take it back when the app is active again. A PiP window is a paused, not stopped, activity: never affected.
 */

export type VideoSurfaceAttachment = {
  attached: boolean;
  /** Bumped on every re-attach, so views redraw a paused frame into their new surface. */
  generation: number;
};

export function createVideoSurfaceAttachment() {
  let state: VideoSurfaceAttachment = { attached: true, generation: 0 };
  const listeners = new Set<() => void>();
  const set = (next: VideoSurfaceAttachment) => {
    if (next.attached === state.attached) {
      return;
    }
    state = next;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A view failing must not break the others.
      }
    });
  };
  return {
    get: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The activity stopped (screen off, left without PiP, PiP dismissed). */
    onActivityStopped(backgroundPlayback: boolean): void {
      if (backgroundPlayback) {
        set({ attached: false, generation: state.generation });
      }
    },
    /** VidoraX is in front again. */
    onAppActive(): void {
      set({ attached: true, generation: state.generation + 1 });
    },
  };
}
