/**
 * Faran's Player packages (P14–P19: streams, headset and keys, speed, audio tracks, sleep timer and limits, audio
 * effects). `playerEngine.ur.ts` mirrors it.
 */
export const playerEngineEn = {
  // P14 #663 Network stream (screen 52)
  streamTitle: 'Network stream',
  streamSubtitle: 'Play a video link without downloading it',
  streamPlaceholder: 'https://… or a .m3u8 link',
  streamLinkA11y: 'Video link',
  streamPaste: 'Paste',
  streamPlay: 'Play',
  streamChecking: 'Checking the link…',
  streamOpenA11y: 'Open a network stream',
  streamFormats:
    'Plays MP4, WebM, MKV, HLS (.m3u8) and DASH (.mpd) links. YouTube and protected (DRM) videos are not supported.',
  streamClipboardEmpty: 'Nothing to paste: copy a video link first.',
  streamErrorEmpty: 'Type or paste a video link first.',
  streamErrorInvalid: 'That doesn’t look like a web link.',
  streamErrorNotHttp: 'Only web links (https:// or http://) can be played here.',
  streamErrorYoutube: 'YouTube videos can’t be played or saved in VidoraX.',
  streamErrorDrm: 'This video is protected (DRM) and can’t be played in VidoraX.',
  streamErrorBlocked: 'Videos from this site can’t be played in VidoraX.',
  streamErrorNotMedia: 'This link opens a page, not a video. Open it in the Browser to find its video.',
  streamErrorNotFound: 'The video was not found (error 404).',
  streamErrorHttp: 'The server refused the link. It may have expired or need a sign-in.',
  streamErrorNetwork: 'Couldn’t reach the server. Check your connection and try again.',
  streamErrorUnsupported: 'This kind of link can’t be played here.',
  // P14 #672 Download integration
  streamDownloadInstead: 'Download instead',
  streamDownloadInsteadSub: 'Save it with the downloader and choose the quality',
  streamDownload: 'Download this stream',
  streamDownloadSub: 'Save it with the downloader',
  // P14 #670 Adaptive bitrate
  streamQuality: 'Stream quality',
  streamQualitySubtitle: 'Online streams change quality with your connection. Cap it to save data.',
  streamQualityAuto: 'Auto',
  streamQualityAutoSub: 'Adapts to your connection',
  streamQualitySaver: 'Data saver',
  streamQualitySaverSub: 'Up to 480p',
  streamQuality720: 'Up to 720p',
  streamQuality1080: 'Up to 1080p',
  streamQualityNow: '{cap} · {quality} now',
};
