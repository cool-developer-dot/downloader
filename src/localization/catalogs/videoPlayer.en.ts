/**
 * Player strings: controls, gestures, menus, errors.
 * `videoPlayer.ur.ts` must mirror these keys (tsc enforces it). Reference as `t('videoPlayer.<key>')`.
 */
export const videoPlayerEn = {
  // P1 — screen 19, the Video player page.
  title: 'Video player',
  moreOptions: 'More options',
  moreOptionsHint: 'Stop, jump to a time, frame by frame, seek interval and orientation',
  chipSubs: 'Subs',
  chipSubsA11y: 'Subtitles',
  chipAudio: 'Audio',
  chipRotate: 'Rotate',
  chipLock: 'Lock',
  tileSkipBack: '{seconds} s',
  tileSkipBackA11y: 'Back {seconds} seconds',
  tileCustomSeek: 'Custom seek',
  tileCustomSeekHint: 'Choose how far skips and double taps jump',
  tileFrameByFrame: 'Frame by frame',
  tileAbRepeat: 'A–B repeat',
  tileAspectRatio: 'Aspect ratio',
  tileFilters: 'Filters',
  upNext: 'Up next',
  upNextSubtitle: 'Auto play next',
  // P1 — the ⋮ Video options menu (#520 Stop, #532 Jump to time).
  optionsTitle: 'Video options',
  stop: 'Stop',
  stopped: 'Stopped at the start',
  jumpToTime: 'Jump to time',
  seekInterval: 'Seek interval',
  // P1 #527 — seek interval.
  seekIntervalSubtitle: 'Skips and double taps jump {seconds} seconds',
  seekIntervalOption: '{seconds} seconds',
  // P1 #532 — jump to time.
  jumpTimeLabel: 'Time',
  jumpTimeHint: 'For example 1:24 or 1:02:03',
  jumpGo: 'Go',
  jumpErrorEmpty: 'Type a time.',
  jumpErrorInvalid: 'Type a time such as 1:24 or 1:02:03.',
  jumpErrorBeyond: 'This video is {duration} long.',
  jumpedTo: 'Jumped to {time}',
  // P1 #531 — frame by frame.
  frameTitle: 'Frame by frame',
  framePrevious: 'Previous frame',
  frameNext: 'Next frame',
  frameClose: 'Close frame by frame',
  frameNumber: 'Frame {frame}',
  framePosition: '{time}, frame {frame}',
  // P1 #545 — long press to fast forward.
  longPressSpeed: '{rate} speed',
  longPressStarted: 'Playing at {rate} while you hold',
  // P1 #527 — the seek interval in the full-screen controls and double-tap feedback.
  rewindSeconds: 'Rewind {seconds} seconds',
  forwardSeconds: 'Forward {seconds} seconds',
  rewoundSeconds: 'Back {seconds} seconds',
  forwardedSeconds: 'Forward {seconds} seconds',
  surfaceHint:
    'Tap to show controls. Swipe the left edge for brightness, the right edge for volume. Double tap the left third to go back {seconds} seconds, the middle to play or pause, the right third to skip {seconds} seconds. Hold to play at 2× speed. Pinch to zoom; while zoomed, double tap resets the zoom.',
} as const;
