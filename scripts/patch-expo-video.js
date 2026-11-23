/**
 * Faran's Player packages (P15, P17, P18, P19): three hooks in expo-video's Android sources for modules/vidorax-media.
 *
 * expo-video builds its ExoPlayer and its media sessions inside its own classes, before any app code can reach the
 * player. The app needs two things there:
 *
 * 1. PCM audio processors in the player's audio sink (P17 #554 audio delay, P19 #555 mono, #556 balance, #557 night
 *    mode, #558 normalization). Android's audiofx effects can't mix channels or shift sound in time; only an
 *    `AudioProcessor` in the sink's chain can. The patched factory builds exactly the sink the stock
 *    `DefaultRenderersFactory` builds (float output and audio-output playback parameters as before) with the hook's
 *    processors first. Each player keeps its own instances in `extraAudioProcessors`.
 * 2. The player a media session controls (P15 #661 headset button, #701 remotes, the notification's ⏮ ⏭). expo-video
 *    plays one item, so a session's "next" / "previous" (a headset double press, a Bluetooth remote's ⏭) has nowhere
 *    to go. The hook lets the app give each session a forwarding player that hands those commands to the Player's own
 *    queue; everything else reaches the ExoPlayer unchanged.
 * 3. The moment a player is released (P18 countdown, P19 audio effects, P15 session player). JavaScript can't ask for it
 *    in time: `useVideoPlayer` releases the player in its own unmount cleanup, and a native call queued after it finds
 *    the player gone. The hook runs on the main thread just before the ExoPlayer is released.
 *
 * The hooks live in one object (`VideoPlayerHooks`); with nothing registered expo-video behaves exactly as stock.
 * The app builds expo-video from source for this (`expo.autolinking.android.buildFromSource` in package.json): the
 * prebuilt AAR would ignore these sources.
 *
 * Runs at postinstall and is idempotent. Every edit is an exact text replacement: when an anchor is missing, for example
 * after upgrading expo-video, it exits non-zero rather than shipping a player whose sound and headset settings
 * silently do nothing.
 *
 * Usage: node scripts/patch-expo-video.js [expo-video package directory]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VIDEO_DIR = path.join('android', 'src', 'main', 'java', 'expo', 'modules', 'video');
const MARKER = 'VidoraX patch (scripts/patch-expo-video.js)';

const HOOKS_FILE = path.join(VIDEO_DIR, 'player', 'VideoPlayerHooks.kt');
const HOOKS_SOURCE = `package expo.modules.video.player

import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/**
 * ${MARKER}: what the app may add to every expo-video player.
 *
 * - [audioProcessors] is called once per player, on the thread that creates it, before its ExoPlayer is built, and
 *   returns new processor instances for that player (they are stateful, never shared). They run first in the audio
 *   sink's chain, before expo-video's speed and silence processing.
 * - [sessionPlayerFactory] gives each media session of a player the \`Player\` it controls (one that forwards to the
 *   ExoPlayer). Called on the main thread when a session is built: once for the player's basic session and again
 *   when the playback service takes it over.
 * - [onRelease] is called once per player on the main thread when it is released, just before its ExoPlayer is
 *   (still usable then), so the app can drop what it kept for it.
 *
 * Null (the default) keeps expo-video's stock behaviour.
 */
@OptIn(UnstableApi::class)
object VideoPlayerHooks {
  @JvmStatic
  @Volatile
  var audioProcessors: (() -> Array<AudioProcessor>)? = null

  @JvmStatic
  @Volatile
  var sessionPlayerFactory: ((owner: VideoPlayer, player: ExoPlayer) -> Player)? = null

  @JvmStatic
  fun sessionPlayer(owner: VideoPlayer, player: ExoPlayer): Player =
    runCatching { sessionPlayerFactory?.invoke(owner, player) }.getOrNull() ?: player

  @JvmStatic
  @Volatile
  var onRelease: ((owner: VideoPlayer) -> Unit)? = null

  @JvmStatic
  fun released(owner: VideoPlayer) {
    runCatching { onRelease?.invoke(owner) }
  }
}
`;

/** Each edit: the file, its stock text and the patched text. */
const EDITS = [
  {
    file: path.join(VIDEO_DIR, 'player', 'VideoPlayer.kt'),
    anchor: `  private var renderersFactory = DefaultRenderersFactory(context)
    .forceEnableMediaCodecAsynchronousQueueing()
    .setEnableDecoderFallback(true)`,
    patched: `  /** ${MARKER}: this player's extra audio processors (see VideoPlayerHooks). */
  val extraAudioProcessors: Array<androidx.media3.common.audio.AudioProcessor> =
    VideoPlayerHooks.audioProcessors?.invoke() ?: emptyArray()
  private var renderersFactory = object : DefaultRenderersFactory(context) {
    // The stock factory's sink (same float output and playback-parameter settings) with the extra processors first.
    override fun buildAudioSink(
      context: Context,
      enableFloatOutput: Boolean,
      enableAudioOutputPlaybackParameters: Boolean
    ): androidx.media3.exoplayer.audio.AudioSink =
      androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(context)
        .setEnableFloatOutput(enableFloatOutput)
        .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParameters)
        .setAudioProcessors(extraAudioProcessors)
        .build()
  }
    .forceEnableMediaCodecAsynchronousQueueing()
    .setEnableDecoderFallback(true)`,
  },
  {
    file: path.join(VIDEO_DIR, 'player', 'VideoPlayer.kt'),
    anchor: `  var mediaSession: MediaSession = buildBasicMediaSession(context, player)`,
    patched: `  // ${MARKER}: the session controls the player VideoPlayerHooks gives (the ExoPlayer itself by default).
  var mediaSession: MediaSession = buildBasicMediaSession(context, VideoPlayerHooks.sessionPlayer(this, player))`,
  },
  {
    file: path.join(VIDEO_DIR, 'player', 'VideoPlayer.kt'),
    anchor: `    GlobalScope.launch(Dispatchers.Main) {
      firstFrameEventGenerator.release()`,
    patched: `    GlobalScope.launch(Dispatchers.Main) {
      // ${MARKER}: the app drops what it kept for this player, while the ExoPlayer still works.
      VideoPlayerHooks.released(this@VideoPlayer)
      firstFrameEventGenerator.release()`,
  },
  {
    file: path.join(VIDEO_DIR, 'utils', 'MediaSessionUtils.kt'),
    anchor: `internal fun buildBasicMediaSession(context: Context, player: ExoPlayer): MediaSession {`,
    patched: `// ${MARKER}: any Player (VideoPlayerHooks may give one that forwards to the ExoPlayer).
internal fun buildBasicMediaSession(context: Context, player: androidx.media3.common.Player): MediaSession {`,
  },
  {
    file: path.join(VIDEO_DIR, 'playbackService', 'ExpoVideoPlaybackService.kt'),
    anchor: `      val mediaSession = MediaSession.Builder(this@ExpoVideoPlaybackService, player)`,
    patched: `      // ${MARKER}: the session controls the player VideoPlayerHooks gives (the ExoPlayer itself by default).
      val mediaSession = MediaSession.Builder(
        this@ExpoVideoPlaybackService,
        expo.modules.video.player.VideoPlayerHooks.sessionPlayer(videoPlayer, player)
      )`,
  },
];

function fail(message) {
  console.error(`patch-expo-video: ${message}`);
  process.exit(1);
}

function patchFile(packageDir, file, edits) {
  const fullPath = path.join(packageDir, file);
  if (!fs.existsSync(fullPath)) {
    fail(`${file} not found; expo-video changed`);
  }
  let source = fs.readFileSync(fullPath, 'utf8');
  let changed = false;
  for (const edit of edits) {
    if (source.includes(edit.patched)) {
      continue;
    }
    const count = source.split(edit.anchor).length - 1;
    if (count !== 1) {
      fail(`expected this text in ${file} exactly once, found ${count}; expo-video changed:\n${edit.anchor}`);
    }
    source = source.replace(edit.anchor, edit.patched);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(fullPath, source);
  }
  return changed;
}

function main() {
  const packageDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'node_modules', 'expo-video'));
  if (!fs.existsSync(path.join(packageDir, VIDEO_DIR))) {
    // A web-only or iOS-only install has no Android sources: nothing to patch.
    console.log(`patch-expo-video: no Android sources in ${packageDir}, skipped`);
    return;
  }
  const hooksPath = path.join(packageDir, HOOKS_FILE);
  let changed = false;
  if (!fs.existsSync(hooksPath) || fs.readFileSync(hooksPath, 'utf8') !== HOOKS_SOURCE) {
    fs.writeFileSync(hooksPath, HOOKS_SOURCE);
    changed = true;
  }
  const byFile = new Map();
  for (const edit of EDITS) {
    byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit]);
  }
  for (const [file, edits] of byFile) {
    changed = patchFile(packageDir, file, edits) || changed;
  }
  console.log(changed ? 'patch-expo-video: patched' : 'patch-expo-video: already patched');
}

if (require.main === module) {
  main();
}

module.exports = { EDITS, HOOKS_FILE, HOOKS_SOURCE, MARKER };
