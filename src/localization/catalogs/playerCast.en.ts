/**
 * P13 #667 Chromecast: the Player's Cast button, device sheet, "Casting to …" and its messages. `playerCast.ur.ts`
 * mirrors it.
 */
export const playerCastEn = {
  castButton: 'Cast to a TV',
  castButtonActive: 'Casting to {device}. Open to stop or change the volume',
  sheetTitle: 'Cast to a TV',
  sheetSubtitle: 'Cast devices on this Wi-Fi. The video plays on the TV; this phone is the remote.',
  sheetEmpty: 'Looking for Cast devices on this Wi-Fi…',
  deviceA11y: 'Cast to {device}',
  thisDevice: 'the TV',
  connecting: 'Connecting to {device}…',
  connectingNoName: 'Connecting…',
  castingTo: 'Casting to {device}',
  connectedHint: 'Play, pause and the timeline on this phone control the TV.',
  statePlaying: 'Playing on the TV',
  statePaused: 'Paused on the TV',
  stateBuffering: 'Loading on the TV…',
  stateFinished: 'Finished on the TV',
  stateIdle: 'Ready on the TV',
  volume: 'TV volume',
  volumeDown: 'TV volume down',
  volumeUp: 'TV volume up',
  stopCasting: 'Stop casting',
  stopCastingHint: 'The video continues on this phone from where the TV was.',
  stopped: 'Stopped casting. Playing on this phone.',
  dropped: 'Lost the connection to the TV. Paused on this phone.',
  // Blocked, each with its reason
  blockedPrivate: 'Videos in the Private Folder are never cast.',
  blockedDownloading: 'This video is still downloading. Cast it when it has finished.',
  blockedStream: 'This stream can’t play on a TV: it needs the website’s own connection.',
  blockedOther: 'This video can’t be cast.',
  // Errors
  noWifi: 'Connect this phone to the same Wi-Fi as the TV.',
  connectFailed: 'Couldn’t connect to the TV. Try again.',
  deviceGone: 'That TV is no longer available.',
  unavailable: 'Casting isn’t available on this phone.',
  fileUnavailable: 'The video file can’t be read for casting.',
  loadFailed: 'The TV couldn’t play this video.',
  volumeFailed: 'Couldn’t change the TV’s volume.',
};
