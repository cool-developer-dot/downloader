/**
 * What Faran's Player packages (P14–P19) give the options sheet: `PlayerOptionContext.engine`, built by
 * `usePlayerEngine` on the Player screen. Each package adds its part; a part is null when it doesn't apply to the
 * video playing (stream rows only for online streams).
 */

export type PlayerEngineStreamOption = {
  /** "Auto · 720p now", "Up to 720p · 480p now", or the cap alone before the first picture. */
  qualityLabel: string;
  openQuality: () => void;
  /** P14 #672: hand the link to the downloader (the Player carries on in the mini player). */
  download: () => void;
};

export type PlayerEngineOption = {
  /** P14: present while an online stream plays. */
  stream: PlayerEngineStreamOption | null;
};
