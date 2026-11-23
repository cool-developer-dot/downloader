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

export type PlayerEngineAudioOption = {
  /** #553: the playing track's name ("English"); null when the video has one track or none. */
  trackLabel: string | null;
  /** #554: "+120 ms", "0 ms". */
  delayLabel: string;
  /** #574 */
  audioOnly: boolean;
  setAudioOnly: (on: boolean) => void;
  /** The Audio sheet (screen 19's Audio chip). */
  open: () => void;
};

export type PlayerEngineOption = {
  /** P14: present while an online stream plays. */
  stream: PlayerEngineStreamOption | null;
  /** P15: the Headset, keys & lock screen sheet. */
  headsetKeys: { open: () => void };
  /** P17: the audio tracks, the delay and Audio Only Mode. */
  audio: PlayerEngineAudioOption;
  /** P18 #644: "Off", "23 min left", "End of video". */
  sleep: { valueLabel: string; open: () => void };
  /** P18 #730: "No limit", "35 min left today". */
  limit: { valueLabel: string; open: () => void };
  /** P18 #712 */
  kidLock: { start: () => void };
  /** P19: "Rock", "Custom", "Off"; "150 %", "Off"; night mode and mono switches; the Audio sheet. */
  effects: {
    eqLabel: string;
    boostLabel: string;
    nightMode: boolean;
    mono: boolean;
    set: (patch: { nightMode?: boolean; mono?: boolean }) => void;
    open: () => void;
  };
};
