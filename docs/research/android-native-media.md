# VidoraX: Native Download and Media Core, Technical Brief (Expo SDK 57 / RN 0.86 / Android)

Scope: how to build downloading (progressive, HLS, DASH), remuxing, background execution, storage and the WebView hooks natively in Kotlin inside this repo. Everything is checked against this repo read-only and against the docs and sources listed at the end. Anything I could not confirm is marked **UNVERIFIED**.

---

## 0. Summary

1. **No ffmpeg.** FFmpegKit is retired. Media3 1.9.0 is already in the build through expo-video. Add three artifacts at exactly 1.9.0: `media3-muxer`, `media3-inspector`, and optionally `media3-transformer`. Remux = Media3 extractors (`MediaExtractorCompat`) → `Mp4Muxer`. This works the same on every API level from 24 up.
2. **Don't use platform `MediaMuxer` as the main muxer.** On minSdk 24 it can't write:
   - AV1 into MP4 before API 34
   - Opus anywhere before API 29
   - VP9 into MP4 at all
   - B-frames on API 24 (support starts at 7.1 / API 25)
3. **Background execution:**
   - API 34+: one user-initiated data transfer (UIDT) job that runs the whole queue.
   - API 24–33: a `dataSync` foreground service (FGS).
   - Skip WorkManager: it has no UIDT support, and on Android 16 long-running workers count against the job quota.
4. **Output:** always a progressive MP4 (moov at the end), published to `MediaStore.Video` under `Movies/VidoraX/` with `IS_PENDING`. Exception: VP8/Vorbis sources go to WebM through `WebmMuxer`. MP3, AC-3 or E-AC-3 audio needs a Transformer transcode or gets dropped.
5. **Packaging:** one local Expo module, `modules/vidorax-media` (autolinked, no prebuild needed). Don't use inline modules: they compile into the `expo` Gradle project and can't declare their own dependencies or manifest entries. Don't keep hand-registered `ReactPackage`s either.
6. **Native owns the state** (queue, parts ledger, library) in its own SQLite file. JS talks to it only through the module's functions and events. The downloader must outlive the JS runtime and the Activity. `expo-file-system`'s `DownloadTask` does not survive app termination.
7. **WebView:** on Android the injection timing and frame scope of react-native-webview 13.16.1 are not good enough for detection. Patch in `WebViewCompat.addDocumentStartJavaScript` (all frames, runs before page scripts). Rewrite the existing `shouldInterceptRequest` hook, which currently runs under one global lock and uses reflection on every request.

### Verified project facts

| Item | Value | Evidence |
|---|---|---|
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 | `node_modules/react-native/gradle/libs.versions.toml:3-5`; merged manifest `android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml` |
| expo / expo-modules-core | 57.0.11 / 57.0.10 | node_modules package.json |
| expo-video | 57.0.2, bundles **Media3 1.9.0** (`media3-session`, `-exoplayer`, `-exoplayer-dash`, `-exoplayer-hls`, `-ui`, `-datasource-okhttp`) as `implementation` | `node_modules/expo-video/android/build.gradle` |
| Media3 artifacts in Gradle cache | common, container, database, datasource(-okhttp), decoder, exoplayer(-dash/-hls), extractor, session, ui. **No muxer, transformer or inspector.** | `~/.gradle/caches/modules-2/files-2.1/androidx.media3` |
| OkHttp | RN declares 4.9.2; 4.12.0 is also in the cache (Gradle picks the highest, **UNVERIFIED** without running `dependencies`) | `libs.versions.toml:37`, gradle cache |
| react-native-webview | 13.16.1, `androidx.webkit:webkit:1.14.0` | `node_modules/react-native-webview/android/gradle.properties:2` |
| expo-file-system / expo-sqlite | 57.0.2 / 57.0.1 | package.json |
| expo-media-library | not installed | node_modules |
| Foreground service / job service in app manifest | **none** | `android/app/src/main/AndroidManifest.xml` |

Important: expo-video declares Media3 as `implementation`, so those classes are **not** on your module's compile classpath. You must declare every Media3 artifact you use, at the same version (1.9.0). Mixed Media3 versions cause runtime `NoSuchMethodError`s. Media3 1.9.0 needs minSdk 23; the project is at 24, so that's fine.

---

## 1. Muxing / remuxing without re-encoding

### 1.1 Options

| Option | Verdict |
|---|---|
| `android.media.MediaMuxer` | Codec support depends on API level (table below). B-frames in MP4 only since Android 7.1. It takes `MediaFormat` directly. Fine for H.264/HEVC + AAC only, and not on API 24 if the source has B-frames. **Not recommended as the primary muxer.** |
| **`androidx.media3.muxer.Mp4Muxer`** (media3-muxer 1.9.0) | Pure Java writer, same behaviour on every API level. Writes `ctts` v1 (negative composition offsets) and `elst` for a non-zero start. **Recommended.** |
| `androidx.media3.muxer.FragmentedMp4Muxer` | Only if you want crash-tolerant partial output. Not needed. |
| `androidx.media3.muxer.WebmMuxer` (new in 1.9.0) | Opus, Vorbis, VP8, VP9. Use it for VP8/Vorbis sources, which `Mp4Muxer` doesn't list. |
| `androidx.media3.transformer.Transformer` | Uses `InAppMp4Muxer` by default in 1.9. Transmuxes when nothing forces a transcode; transcodes automatically when the muxer can't take the input (for example MP3 → AAC). Heavy and `@UnstableApi`. **Use as a fallback only.** |
| ffmpeg-kit | Officially retired early 2025 and release binaries removed (sources differ on exact dates). The author started a source-only "FFmpegKitNext" in July 2026, so you would build and license ffmpeg yourself (tens of MB per ABI, LGPL/GPL). **Don't.** |

### 1.2 Codec × container support

**Platform `MediaMuxer`.** From the AOSP `addTrack` Javadoc table (the MS Learn mirror of the AOSP docs reproduces it verbatim):

| Codec | MP4 | WebM | OGG | Supported from SDK |
|---|---|---|---|---|
| AAC, AMR-NB/WB, H.263, MPEG-4, AVC | yes | – | – | 16 (class is API 18) |
| Vorbis, VP8 | – | yes | – | 21 |
| VP9 | – | yes | – | 24 |
| HEVC | yes | – | – | 24 |
| Opus | – | yes | yes | 29 |
| Dolby Vision | yes | – | – | 33 |
| AV1 | yes | – | – | 34 |
| APV | yes | – | – | 36 |

- Class doc: B-frames in MP4 are supported "since Android Nougat MR1" (API 25).
- `setOrientationHint()` must be called before `start()`.
- Codec-specific data (csd) must go in the `MediaFormat` passed to `addTrack`, never in samples.
- MP3 is not in the table.

**Media3 `Mp4Muxer` 1.9.0** (source lists `SUPPORTED_VIDEO_SAMPLE_MIME_TYPES` / `SUPPORTED_AUDIO_SAMPLE_MIME_TYPES`):
- Video: AV1, H.263, H.264, H.265 (written as `hvc1`), MP4V, VP9 (`vp09`), APV, Dolby Vision.
- Audio: AAC, AMR-NB/WB, Opus, Vorbis, raw PCM, IAMF.
- **MP3 is not supported.** The box writer throws `IllegalArgumentException("Unsupported format: ...")`. AC-3/E-AC-3 are not listed either.

**Recommended output per source**

| Source video + audio | Output |
|---|---|
| H.264/HEVC + AAC (most HLS, DASH, social) | MP4 via `Mp4Muxer` |
| VP9 or AV1 + Opus/AAC | MP4 via `Mp4Muxer`. Playback support is a device decoder question: VP9-in-MP4 and Opus-in-MP4 are listed as playable on the supported-formats page; AV1 decode needs Android 10+. |
| VP8 and/or Vorbis | WebM via `WebmMuxer` (1.9 docs: you must wrap it in your own `Muxer.Factory` if using Transformer) |
| any + MP3/AC-3/E-AC-3 | Transformer transcoding audio to AAC, or video-only with a warning |

### 1.3 Demuxing: which extractor

| Extractor | TS | Concatenated fMP4 (init + fragments) | WebM/MKV | Notes |
|---|---|---|---|---|
| `android.media.MediaExtractor` | yes ("not seekable" per supported-formats page) | likely (MPEG4Extractor handles `moof`). **UNVERIFIED** across OEMs for files with repeated `styp`/`sidx`. | yes | Behaviour varies by device and OS version; `getSampleSize()` is API 28+. |
| **`androidx.media3.inspector.MediaExtractorCompat`** (1.9) | yes | yes (`FragmentedMp4Extractor`) | yes | Drop-in replacement: same API as `MediaExtractor`, built on Media3 extractors. Constructors: `(Context)`, `(ExtractorsFactory, DataSource.Factory)`. `setDataSource` takes a path, `Uri` + headers, `FileDescriptor`, `AssetFileDescriptor` or `MediaDataSource`. Returns `android.media.MediaFormat`. The old `androidx.media3.exoplayer.MediaExtractorCompat` is deprecated. |
| Media3 `Extractor` API directly (`TsExtractor`, `FragmentedMp4Extractor`, `MatroskaExtractor` + your own `ExtractorOutput`/`TrackOutput`) | yes | yes | yes | Gives Media3 `Format` directly and is pure JVM, so it's unit-testable without a device. Costs about 150 more lines. |

The list of containers in `DefaultExtractorsFactory` (TS, MP4/fMP4, Matroska, ADTS, MP3, Ogg, FLAC, WAV, AMR, FLV, PS, AVI) is from memory of Media3, not fetched: **UNVERIFIED**.

**ADTS → AudioSpecificConfig:** you don't convert it yourself when you go through an extractor. Media3's `TsExtractor`/`AdtsReader` and the platform MPEG2-TS extractor strip ADTS headers and put the ASC in the format (`initializationData` / `csd-0`). High confidence, but test it with fixtures: **UNVERIFIED this session**.

### 1.4 Remux core (Kotlin sketch)

```kotlin
// build.gradle (module): implementation "androidx.media3:media3-muxer:1.9.0", "androidx.media3:media3-inspector:1.9.0"
class Remuxer(private val ctx: Context) {
  private class Src(val ex: MediaExtractorCompat, val inTrack: Int, var outTrack: Int = -1,
                    var hasSample: Boolean = true, val isVideo: Boolean)

  fun remuxToMp4(inputs: List<Pair<String, (MediaFormat) -> Boolean>>, out: File, rotationDeg: Int?) {
    val srcs = inputs.flatMap { (path, pick) ->
      val ex = MediaExtractorCompat(ctx).apply { setDataSource(path) }
      (0 until ex.trackCount).filter { pick(ex.getTrackFormat(it)) }.map { i ->
        ex.selectTrack(i); Src(ex, i, isVideo = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)!!.startsWith("video/"))
      }
    }
    FileOutputStream(out).use { fos ->
      val muxer = Mp4Muxer.Builder(SeekableMuxerOutput.of(fos))
        .setSampleCopyingEnabled(true)            // we reuse one ByteBuffer; the default is documented as "muxer takes ownership"
        .build()
      rotationDeg?.let { muxer.addMetadataEntry(Mp4OrientationData(it)) }
      srcs.forEach { s ->
        val mf = s.ex.getTrackFormat(s.inTrack)
        val f = MediaFormatUtil.createFormatFromMediaFormat(mf) // UNVERIFIED name; otherwise build Format manually from csd-0/csd-1
        s.outTrack = muxer.addTrack(f)
      }
      val baseUs = computeBaseUs(srcs)            // global minimum PTS over the first ~16 samples of each track (B-frame safe)
      var buf = ByteBuffer.allocateDirect(2 shl 20)
      val seenKey = BooleanArray(srcs.size)
      while (true) {
        // pick the source whose current sample has the smallest time (good-enough interleave; Mp4Muxer says the caller must interleave)
        val (idx, s) = srcs.withIndex().filter { it.value.hasSample }
          .minByOrNull { it.value.ex.sampleTime }?.let { it.index to it.value } ?: break
        val ex = s.ex
        if (ex.sampleTrackIndex != s.inTrack) { ex.advance(); continue }   // shared extractor, another selected track's sample
        val size = ex.sampleSize.toInt()
        if (size > buf.capacity()) buf = ByteBuffer.allocateDirect(size + (size shr 1))
        buf.clear()
        val n = ex.readSampleData(buf, 0)
        if (n < 0) { s.hasSample = false; continue }
        val sync = (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0
        if ((ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED) != 0) throw DrmProtected()
        if (s.isVideo && !seenKey[idx] && !sync) { ex.advance(); continue } // drop leading non-IDR frames
        if (s.isVideo && sync) seenKey[idx] = true
        buf.limit(n)
        muxer.writeSampleData(s.outTrack, buf,
          BufferInfo(ex.sampleTime - baseUs, n, if (sync) C.BUFFER_FLAG_KEY_FRAME else 0))
        s.hasSample = ex.advance()
      }
      muxer.close()
    }
    srcs.map { it.ex }.distinct().forEach { it.release() }
  }
}
```

API facts (verified from Media3 source):
- `Mp4Muxer.Builder(SeekableMuxerOutput)`; the `Builder(FileOutputStream)` constructor is deprecated.
- `addTrack(Format): Int`
- `writeSampleData(int, ByteBuffer, androidx.media3.muxer.BufferInfo)`
- `BufferInfo(presentationTimeUs, size, @C.BufferFlags flags)`
- `close()`
- Builder also has `setAnnexBToAvccConverter`, `setLastSampleDurationBehavior`, `setSampleBatchingEnabled`, `setAttemptStreamableOutputEnabled`.
- Everything is `@UnstableApi`: you need `@OptIn(UnstableApi::class)` and should expect changes on Media3 upgrades.

### 1.5 Pitfalls, with concrete handling

- **B-frames and timestamps.** Write samples in decode order with their PTS. `Mp4Muxer` derives composition offsets (`ctts` v1, signed) and writes `elst` for a non-zero start (verified in `Boxes.java`). Rebase using the minimum PTS over the first GOP, not the first sample's PTS; otherwise B-frames that come right after the IDR get negative times.
- **Rebase all tracks with one base, never per track.** Per-track rebasing destroys A/V sync. Exceptions:
  - DASH: subtract each representation's `presentationTimeOffset` when adaptation sets differ.
  - HLS packed audio (raw `.aac` rendition segments): the timestamp is in an ID3 `PRIV` frame, owner `com.apple.streaming.transportStreamTimestamp` (33-bit, 90 kHz; RFC 8216 §3.4). Standalone extractors ignore it, so parse it from the first audio segment and offset audio by `(id3Ts − firstVideoPts90k) / 90`.
- **Discontinuities (TS).** A concatenated TS with a `EXT-X-DISCONTINUITY` timestamp reset produces non-monotonic PTS. Handle each discontinuity group separately: concatenate each group to its own `.ts`, extract group by group, and add `offsetUs = previous group's end` (max over tracks of last PTS + frame duration).
  - If the `Format` (mime, size, csd) changes between groups (typical for ad insertion), one MP4 track can't hold both. Refuse, keep only the main group, or fall back to a Transformer transcode.
  - Within a group, Media3's TS extractor handles 33-bit PTS wraparound; the platform extractor is **UNVERIFIED**.
- **Buffer sizing.** Use `getSampleSize()` per sample and grow the buffer. `KEY_MAX_INPUT_SIZE` exists for MP4 (`stsz` max) but is often missing for TS. 4K HEVC keyframes can be several MB.
- **Edit lists in source MP4s.** Media3 `Mp4Extractor` applies them to timestamps (high confidence). Platform behaviour **UNVERIFIED**. Another reason to use Media3.
- **Rotation.** Read `MediaFormat.KEY_ROTATION` from the video track and write `Mp4OrientationData`. The platform muxer uses `setOrientationHint()` instead.
- **Huge files.**
  - `co64` for offsets over 4 GB: **UNVERIFIED** in `Mp4Muxer`. Test with a synthetic file over 4 GB.
  - Heap cost of sample tables for 2-hour content: **UNVERIFIED**, measure it.
  - Always stream; never read whole segments into memory.
  - Check `StorageManager.getAllocatableBytes()` (API 26+) for about 2× the size (segments + output) before downloading and again before remuxing.
- **Keep-as-fMP4 shortcut.** `init + concatenated fragments` is a valid fragmented MP4, but seeking and duration are poor in some gallery apps. Remuxing to progressive MP4 is IO-only and cheap, so always do it.
- **Validate the output.** Reopen it with `MediaExtractorCompat` and check: expected track count, duration within a frame of the plan, and |first audio PTS − first video PTS| under ~50 ms.

### 1.6 Transformer fallback (only when a transcode is unavoidable)

Verified from 1.9 source:
- `ExoPlayerAssetLoader` configures `DefaultTrackSelector.Parameters.setForceHighestSupportedBitrate(true)` and uses `DefaultMediaSourceFactory`. There's no explicit rejection of adaptive or live input.
- `ExoAssetLoaderBaseRenderer` has a bypass path (`shouldEnableBypass` → `feedConsumerFromInput`) that passes encoded samples through.
- `TransformerUtil.shouldTranscodeAudio/Video` forces a transcode when any of these hold: more than one sequence or item (unless `Composition.transmuxAudio/transmuxVideo`), gaps, effects, speed change, muxer doesn't support the MIME type, pixel aspect ratio ≠ 1, HDR mode ≠ keep.

HLS/DASH as Transformer input is **not documented** as supported, so it is **UNVERIFIED** in practice. Spike it before relying on it.

```kotlin
val t = Transformer.Builder(ctx).setLooper(handlerThread.looper)   // single application thread; listener callbacks arrive on it
  .setAudioMimeType(MimeTypes.AUDIO_AAC).addListener(listener).build()
t.start(EditedMediaItem.Builder(MediaItem.fromUri(localFile)).build(), outPath)
// Separate video + audio files:
Composition.Builder(EditedMediaItemSequence.withVideoFrom(listOf(v)), EditedMediaItemSequence.withAudioFrom(listOf(a)))
  .setTransmuxVideo(true).setTransmuxAudio(true).build()
```

Progress: `getProgress(ProgressHolder)`. One export at a time per instance.

---

## 2. HLS download

**Parse with Media3; don't write a parser.**
- `androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser().parse(uri, inputStream)` returns `HlsMultivariantPlaylist` or `HlsMediaPlaylist`.
- For media playlists that use `EXT-X-DEFINE` IMPORT, use the constructor that takes the multivariant playlist.
- Verified parser behaviour:
  - If `METHOD=AES-128` has no `IV`, the parser sets `encryptionIV = Long.toHexString(segmentMediaSequence)`.
  - A `BYTERANGE` without an offset carries on from the previous segment's offset.
  - `EXT-X-MAP BYTERANGE` is supported.
  - `SAMPLE-AES` becomes `DrmInitData` with scheme `cbcs`; `SAMPLE-AES-CTR` becomes `cenc`.
  - `Segment` constructor fields: url, initializationSegment, title, durationUs, relativeDiscontinuitySequence, relativeStartTimeUs, drmInitData, fullSegmentEncryptionKeyUri, encryptionIV, byteRangeOffset, byteRangeLength, hasGapTag, parts.
- Resolve relative URLs against the playlist's `baseUri` (`UriUtil.resolve`).
- Transport: use the same OkHttp client and headers as the downloader, for example `OkHttpDataSource.Factory(client).setDefaultRequestProperties(headers)` (declare `media3-datasource-okhttp:1.9.0` explicitly).

**Variant selection.**
1. Filter out variants whose `CODECS` the device can't decode (`MediaCodecList`, or Media3 `MediaCodecUtil`).
2. Pick by the user's preferred height, then highest `BANDWIDTH`.
3. If the variant has an `AUDIO` group, choose the `EXT-X-MEDIA TYPE=AUDIO` rendition in that `GROUP-ID` (RFC 8216: `STREAM-INF AUDIO` must match an audio `GROUP-ID`). Prefer `DEFAULT=YES`, then `AUTOSELECT=YES` matching the device language.
4. A rendition with a `URI` is a separate playlist to download and mux. A rendition without a `URI` means the audio is muxed into the variant.

**Refuse (surface as "DRM protected" or "unsupported"):**
- `METHOD=SAMPLE-AES` / `SAMPLE-AES-CTR`
- any non-`identity` `KEYFORMAT` (FairPlay `com.apple.streamingkeydelivery`, Widevine/PlayReady `urn:uuid:`)
- `skd://` key URIs
- `SAMPLE_FLAG_ENCRYPTED` samples at remux time

**AES-128 (support it; the current JS refuses it).** Key facts from RFC 8216:
- AES-128-CBC with PKCS7 padding. JCA `PKCS5Padding` is identical for 16-byte blocks.
- If `IV` is absent, the IV is the media sequence number as a 128-bit big-endian value, zero-padded on the left.
- An `EXT-X-KEY` applies to following segments **and** to `EXT-X-MAP` init sections until the next key tag.

```kotlin
fun ivBytes(hex: String): ByteArray = hex.removePrefix("0x").removePrefix("0X").padStart(32, '0')
  .chunked(2).map { it.toInt(16).toByte() }.toByteArray()
fun decrypting(input: InputStream, key: ByteArray, iv: ByteArray): InputStream =
  CipherInputStream(input, Cipher.getInstance("AES/CBC/PKCS5Padding").apply {
    init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv)) })
```

- Fetch keys with the same cookies and headers as segments, and cache them per key URI.
- Decrypt while downloading and store plaintext segments. Resuming then works at segment granularity: a partially written encrypted segment can't resume mid-CBC, so restart that segment.
- After decrypting, sniff the result (TS sync byte `0x47` at offsets 0 and 188; fMP4 `styp`/`moof`). `CipherInputStream` may swallow padding errors (**UNVERIFIED** on Android).
- With byte-range segments, whether each sub-range is independently encrypted with its own IV is **UNVERIFIED**; test with real streams.

**Byte ranges.** Send `Range: bytes=offset-(offset+length-1)` and require a `206` whose `Content-Range` start equals `offset`.

**Live vs VOD.**
- No `EXT-X-ENDLIST` → live. `PLAYLIST-TYPE=EVENT` → growing.
- Refuse live in v1. Optional later: "record from now" by polling the playlist every target duration.
- VOD: `PLAYLIST-TYPE=VOD` or `ENDLIST` present.

**Gaps.** `hasGapTag` segments can't be downloaded. Fail, or skip and insert a discontinuity (**design choice**).

**Output strategy.**
- TS variant: download segments (3–6 in parallel, bounded per host) to `parts/NNNNN.ts`. Byte-concatenate per discontinuity group, then remux each group into one MP4 with offsets (§1.5).
- fMP4 variant: download `init.mp4` + `NNNNN.m4s`, concatenate `init + segments` into one file, then remux. With a separate audio rendition, concatenate its own init + segments and mux the two files together.
- Packed audio renditions (`.aac`/`.ec3`): apply the ID3 PRIV timestamp alignment. E-AC-3 needs a transcode (§1.2).

---

## 3. DASH download

**Parse with Media3.** `androidx.media3.exoplayer.dash.manifest.DashManifestParser().parse(uri, stream)` → `DashManifest` → periods → `adaptationSets` (type `C.TRACK_TYPE_VIDEO/AUDIO`) → `representations`.

- **Refuse** when:
  - `manifest.dynamic == true` (live), or
  - `representation.format.drmInitData != null` (`ContentProtection`).
- **Choose:** best decodable video by height and bitrate, and best audio by bitrate and language within the same period. Multi-period (ad-stitched) content: v1 handles the first/main period only and flags the rest.
- **Addressing** (all resolved by Media3):
  - `SegmentTemplate` with `$Number$`/`$Time$`/`SegmentTimeline`, or `SegmentList`: `representation.getIndex()` returns a `DashSegmentIndex`. Iterate `getFirstSegmentNum()` over `getSegmentCount(periodDurationUs)`, and use `getSegmentUrl(n).resolveUri(baseUrl)` plus `start`/`length`. The init segment is `representation.getInitializationUri()`. Media3 expands the URL templates internally.
  - `SegmentBase` with `indexRange` (single file per representation, typical for Instagram/Facebook-style separate A/V MP4s; **UNVERIFIED** for those sites today): just download the whole `BaseURL` file, which is already a complete (fragmented) MP4 with init and `sidx`. You only need `sidx` for parallel ranges: `DashUtil.loadChunkIndex(dataSource, trackType, representation)` returns a `ChunkIndex` (offsets, sizes, times).
  - `BaseURL`: `representation.baseUrls` (multiple base URLs exist for CDN failover; try them in order).
- **Mux:** video file(s) + audio file(s) → `Mp4Muxer` with one timeline; subtract `presentationTimeOffset` per representation if they differ.

---

## 4. Reliable background downloads (Android 14/15/16)

### 4.1 Platform rules (verified)

**Android 15** (target 35+):
- `dataSync` and `mediaProcessing` FGS: **6 h per 24 h**, shared across the app's services of that type. The timer resets when the user brings the app to the foreground.
- At the limit, `Service.onTimeout(int,int)` is called; you must call `stopSelf()` within seconds or get a `RemoteServiceException`.
- Starting another one after the limit throws `ForegroundServiceStartNotAllowedException("Time limit already exhausted for foreground service type dataSync")`.
- `BOOT_COMPLETED` receivers can't start `dataSync`.
- Holding `SYSTEM_ALERT_WINDOW` only permits FGS starts from the background if an overlay window is **visible**. This app declares SAW at `AndroidManifest.xml:5`, and nothing in `src`, the Kotlin sources or `app.json` uses it.

**UIDT jobs** (API 34+):
- Manifest: `RUN_USER_INITIATED_JOBS`; the service is a `JobService` with `BIND_JOB_SERVICE`.
- Builder: `JobInfo.Builder.setUserInitiated(true)` plus a network constraint; `setEstimatedNetworkBytes` recommended.
- Call `JobService.setNotification(params, id, notif, JOB_END_NOTIFICATION_POLICY_DETACH)` (mandatory).
- Scheduling only works while the app is visible or has a background-activity-launch exemption; otherwise the result is `RESULT_FAILURE`.
- The user can stop the job from Task Manager; that kills the process without calling `onStopJob`.
- **No Jetpack library supports UIDT.** Google's documented fallback below API 34 is a WorkManager or FGS path.

**Android 16:**
- Jobs that start while the app is visible and keep running after it becomes invisible, or that run concurrently with an FGS, now count against the job runtime quota. This affects WorkManager, JobScheduler and DownloadManager. The guidance is to use UIDT for user-initiated transfers.
- `STOP_REASON_TIMEOUT_ABANDONED` if `JobParameters` is garbage-collected, so hold a strong reference.
- `setImportantWhileForeground` no longer does anything.
- The WorkManager long-running doc says long-running workers "can exhaust your app's job quota" on Android 16.
- WorkManager 2.10 added `STOP_REASON_FOREGROUND_SERVICE_TIMEOUT`.

**Notifications** (API 33+): if `POST_NOTIFICATIONS` is denied, FGS notices still appear in Task Manager but not in the notification drawer.

### 4.2 Recommended runner design

| API level | Runner | Type / permissions |
|---|---|---|
| 34–36+ | **One queue-runner UIDT job** (fixed job ID) that processes every queued download (N concurrent) and the remux step, and finishes when the queue is empty | `RUN_USER_INITIATED_JOBS`, `ACCESS_NETWORK_STATE` |
| 24–33 | **One `dataSync` FGS**, started from the user's tap, stopped when the queue is empty. The 6 h limit doesn't apply here: it's an Android 15+ rule, and those devices take the UIDT path. | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`; call `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_DATA_SYNC)` within the start window |

Why a single queue-runner job:
- You can't schedule new UIDT jobs from the background, for example when one finishes while the app is closed. So one job must drain the queue in-process.
- Calling `JobScheduler.schedule()` with the ID of a **running** job stops and reschedules that job (per `JobScheduler.schedule` Javadoc; not fetched this session). So when the user adds a download while the runner is alive, write it to the DB and notify the in-process engine. Don't reschedule.

```kotlin
fun ensureRunner(ctx: Context, estBytes: Long, wifiOnly: Boolean) {
  if (Build.VERSION.SDK_INT >= 34) {
    val js = ctx.getSystemService(JobScheduler::class.java)
    if (DownloadEngine.isRunnerAlive || js.getPendingJob(RUNNER_ID) != null) { DownloadEngine.kick(); return }
    val r = js.schedule(JobInfo.Builder(RUNNER_ID, ComponentName(ctx, DownloadJobService::class.java))
      .setUserInitiated(true)
      .setRequiredNetworkType(if (wifiOnly) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_ANY)
      .setEstimatedNetworkBytes(estBytes, 0).build())
    if (r != JobScheduler.RESULT_SUCCESS) throw RunnerScheduleFailed()   // app not visible
  } else ContextCompat.startForegroundService(ctx, Intent(ctx, DownloadForegroundService::class.java))
}
class DownloadJobService : JobService() {
  private var params: JobParameters? = null                                // strong ref (Android 16)
  override fun onStartJob(p: JobParameters): Boolean {
    params = p
    setNotification(p, NOTIF_ID, Notifs.progress(this), JOB_END_NOTIFICATION_POLICY_DETACH)
    DownloadEngine.get(this).runQueue(
      onBytes = { total -> updateTransferredNetworkBytes(p, total, 0) },
      onIdle = { jobFinished(p, false); params = null })
    return true
  }
  override fun onStopJob(p: JobParameters): Boolean { DownloadEngine.get(this).suspendAll(p.stopReason); return true }
}
```

- UIDT runtime cap: the docs only say the system stops jobs that run "longer than necessary". No fixed number is documented.
- Running a short remux inside a UIDT job: acceptable in practice, but policy is **UNVERIFIED**.
- Play Console requires declaring FGS types (**UNVERIFIED** detail).

### 4.3 Process-death recovery

- Persist every state transition **before** its side effect (native SQLite, WAL).
- The parts ledger stores, per segment/range: `bytes_done`, `state`, `etag/last-modified`. Write parts to `*.part` and atomically rename on completion.
- On app launch (visible, so scheduling is allowed):
  - DB rows marked `RUNNING` with no live runner → `QUEUED`, then `ensureRunner()`.
  - Temp directories with no DB row → delete.
- UIDT `setPersisted(true)` survives reboot but needs `RECEIVE_BOOT_COMPLETED`. Optional.

### 4.4 HTTP layer

- **OkHttp** (already in the APK; one singleton client): HTTP/2 multiplexing for segment bursts, connection pooling, interceptors.
  - `HttpURLConnection` works, but there's no reason to use it.
  - OkHttp's `BridgeInterceptor` doesn't add transparent gzip when a `Range` header is present, so byte offsets stay correct. Still send `Accept-Encoding: identity` on media requests.
- **Cookies:**
  - Snapshot at enqueue: `CookieManager.getInstance().getCookie(mediaUrl)` for the **media URL's** host, not the page's.
  - Refresh from `CookieManager` on retry, through an interceptor that sets the `Cookie` header per request.
  - Initializing `CookieManager` in a cold process started only by the job service is **UNVERIFIED**, so rely on the snapshot.
  - Cookies and headers are credentials. Store them in `noBackupFilesDir`: the manifest has `allowBackup="true"` (`AndroidManifest.xml:40`).
- **Headers:**
  - `User-Agent` = the exact UA string of the WebView tab that produced the URL; some signed CDN URLs are bound to the UA.
  - `Referer` = the page URL, or better the `Referer` observed on the intercepted request (`MediaNetworkBridge.kt` already captures `requestReferer`).
  - `Origin` when the page fetched the media through CORS.
- **Resume:**
  - Send `Range: bytes=N-` + `If-Range: <ETag or Last-Modified>`.
  - `206` with `Content-Range` start == N → append.
  - `200` → server ignored or changed the file → truncate and restart.
  - `416` → check `Content-Range: */total` for completion.
  - `403`/`410` on a signed URL → state `NEEDS_REFRESH`. The URL must be re-resolved from the page; native can't mint a new one.
  - Semantics: RFC 9110 (not fetched this session).
- **Parallel ranges** (progressive only):
  - Probe with `Range: bytes=0-0`. Only if you get a 206 with a total over about 20 MB: preallocate with `RandomAccessFile.setLength`, use 3–4 ranges written by `FileChannel` positional writes, and keep a chunk ledger.
  - Default **off** for social CDNs (throttling or 403s on parallel ranges: **UNVERIFIED** per host). For HLS/DASH, the parallelism is concurrent segments.

---

## 5. Storage (Android 10–16)

- **Working area:** `noBackupFilesDir/downloads/<id>/` (or `getExternalFilesDir(null)`). No permission needed. Delete on completion or cancel.
- **Final location:** `MediaStore.Video.Media.getContentUri(VOLUME_EXTERNAL_PRIMARY)` with `RELATIVE_PATH="Movies/VidoraX"` (or `Movies/VidoraX/<Source>`) and `IS_PENDING=1`. Write, then set `IS_PENDING=0`.
  - Videos in `DCIM/`, `Movies/` and `Pictures/` are auto-scanned into `MediaStore.Video`, so they appear in Gallery apps.
  - `MediaStore.Downloads` exists on API 29+, but files there aren't in the Video table.
  - On Android 10+ the app needs **no storage permission** to create or modify items it owns.

```kotlin
val values = ContentValues().apply {
  put(MediaStore.Video.Media.DISPLAY_NAME, name); put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
  put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/VidoraX"); put(MediaStore.Video.Media.IS_PENDING, 1) }
val uri = resolver.insert(collection, values)!!
try { resolver.openOutputStream(uri, "w")!!.use { o -> tmp.inputStream().use { it.copyTo(o, 1 shl 16) } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
} catch (t: Throwable) { resolver.delete(uri, null, null); throw t }
// Re-query DISPLAY_NAME afterwards: MediaProvider may rename on collision (UNVERIFIED exact behaviour)
```

  - Muxing straight into the pending item through `openFileDescriptor(uri,"rw")` + `SeekableMuxerOutput.of(FileOutputStream(pfd.fileDescriptor))` avoids the copy. Seekable FUSE fds for this are **UNVERIFIED**; default to mux into temp, then copy.
- **API 24–28:** no `RELATIVE_PATH`/`IS_PENDING`. Options:
  - keep the file private and export through SAF (what `VidoraMediaExportModule` does today), or
  - write to `Environment.getExternalStoragePublicDirectory(DIRECTORY_MOVIES)` with `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=28`) and call `MediaScannerConnection.scanFile`.
  - Today's manifest declares READ/WRITE with `maxSdkVersion=32` (`AndroidManifest.xml:4,7`); WRITE does nothing above 28.
- **Deletion:**
  - Owned items: `ContentResolver.delete`.
  - Not owned (for example after reinstall, when ownership goes to the old install): `MediaStore.createDeleteRequest(resolver, uris)` on API 30+, launched with `startIntentSenderForResult`. The Expo DSL has `OnActivityResult` (`ModuleDefinitionBuilder.kt:164`). On API 29 catch `RecoverableSecurityException`.
  - Reading files from a previous install needs `READ_MEDIA_VIDEO` (33+) / `READ_EXTERNAL_STORAGE`. Recommend **not** adopting old files.
- **Thumbnails:**
  - API 29+: `ContentResolver.loadThumbnail(uri, Size(512, 288), null)`, or `ThumbnailUtils.createVideoThumbnail(File, Size, CancellationSignal)`.
  - Otherwise: `MediaMetadataRetriever.getScaledFrameAtTime(timeUs, OPTION_CLOSEST_SYNC, w, h)` (API 27), or `getFrameAtTime` on 24–26.
  - Take the frame at about 10% of duration (min 1 s) to avoid black intros. Cache as WebP in `cacheDir/thumbs/<id>.webp`.
  - Media3 1.9 `media3-inspector` also has `FrameExtractor` (API not fetched: **UNVERIFIED** names).
- **Metadata:**
  - `MediaMetadataRetriever`: `METADATA_KEY_DURATION`, `VIDEO_WIDTH`, `VIDEO_HEIGHT`, `VIDEO_ROTATION`, `BITRATE`, `VIDEO_FRAME_COUNT`.
  - **Codec MIME isn't available publicly:** `METADATA_KEY_VIDEO_CODEC_MIME_TYPE` is `@hide @SystemApi` in AOSP. Record codecs from the remux step (you already hold the `Format`s), or use `MediaExtractorCompat.getTrackFormat(i).getString(KEY_MIME)`.
  - Media3 `MetadataRetriever.Builder(ctx, mediaItem).build()` has `retrieveTrackGroups()`, `retrieveDurationUs()` (`ListenableFuture`) and is `AutoCloseable`.
- **Library reconciliation:** on launch, query your own MediaStore items for your content URIs and mark rows `missing` when the user deleted them in Gallery. Optionally register a `ContentObserver`.

---

## 6. Expo SDK 57 specifics

### 6.1 Local module (no prebuild needed for this repo)

- Autolinking scans `./modules` by default: `node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js:170-172`, `nativeModulesDir ?? './modules'`.
- `android/settings.gradle` already calls `expoAutolinking.useExpoModules()`, so a Gradle sync or `npx expo run:android` picks the module up. This is based on reading the autolinking code, not on running a build.
- Scaffold: `npx create-expo-module@latest --local` (the docs' layout is `modules/<name>/{android,ios,src,expo-module.config.json,index.ts}`).

```json
// modules/vidorax-media/expo-module.config.json   (same shape as node_modules/expo-video/expo-module.config.json)
{ "platforms": ["android"], "android": { "modules": ["com.vidorax.media.VidoraMediaModule"] } }
```

```groovy
// modules/vidorax-media/android/build.gradle   (template: node_modules/expo-video/android/build.gradle)
plugins { id 'com.android.library'; id 'expo-module-gradle-plugin' }
android { namespace "com.vidorax.media" }
dependencies {
  def media3 = "1.9.0"   // MUST equal expo-video's androidxMedia3Version
  implementation "androidx.media3:media3-muxer:$media3"
  implementation "androidx.media3:media3-inspector:$media3"
  implementation "androidx.media3:media3-exoplayer-hls:$media3"
  implementation "androidx.media3:media3-exoplayer-dash:$media3"
  implementation "androidx.media3:media3-datasource-okhttp:$media3"
  implementation "androidx.media3:media3-transformer:$media3"   // only if the transcode fallback ships
  implementation "com.squareup.okhttp3:okhttp:4.12.0"
}
```

- The module's own `android/src/main/AndroidManifest.xml` declares the permissions, the `JobService` (`android:permission="android.permission.BIND_JOB_SERVICE"`, `exported=false`), the `dataSync` service and the notification-action receiver. Library manifests merge into the app, so no hand edits to `android/app` are needed.
- **Inline modules** (SDK 56+, experimental) aren't suitable here. The Gradle plugin mirrors inline `.kt` files into the `expo` package project's source set (`ExpoAutolinkingPlugin.kt:47-66`, `src/main/java/inline/modules/`), so they can't have their own dependencies or manifest. The docs require prebuild after config changes.
- **Make the repo prebuild-safe.** Right now these would be wiped or broken by `npx expo prebuild --clean`:
  - hand-registered packages in `MainApplication.kt:24-31`
  - the postinstall script that copies Kotlin into `android/` and patches `MainApplication.kt` (`scripts/apply-player-native-modules.js`)
  - the postinstall script that edits `node_modules` Java (`scripts/apply-webview-media-hook.js`)

  Move all Kotlin into `modules/`, and replace the node_modules edit with a `patch-package` patch.

### 6.2 Module API shape

Verified in docs and `expo-modules-core` 57.0.10:
- `AsyncFunction(...) Coroutine { }` (`AsyncFunctionBuilder.kt:260-264`); it can't take a `Promise`.
- `Events(...)` + `sendEvent`.
- `OnStartObserving/OnStopObserving`.
- `OnActivityResult`, `OnNewIntent`.
- `Record` with `@Field`; enums implement `Enumerable`.
- `appContext.backgroundCoroutineScope`.
- `SharedObject.emit(event, payload)` single payload; the vararg form is `@Deprecated` (`SharedObject.kt:47-64`).

```kotlin
class VidoraMediaModule : Module() {
  private val engine get() = DownloadEngine.get(requireNotNull(appContext.reactContext))
  override fun definition() = ModuleDefinition {
    Name("VidoraMedia")
    Events("onProgress", "onStateChange")
    OnStartObserving("onProgress") { engine.setListener { e -> sendEvent("onProgress", e.toBundle()) } }  // throttle to ≤4 Hz per id
    OnStopObserving("onProgress") { engine.setListener(null) }
    AsyncFunction("probe") Coroutine { url: String, headers: Map<String, String> -> Probe.run(url, headers).toMap() }
    AsyncFunction("enqueue") Coroutine { req: EnqueueRecord -> engine.enqueue(req) }   // calls ensureRunner() while app is visible
    AsyncFunction("pause") Coroutine { id: String -> engine.pause(id) }
    AsyncFunction("resume") Coroutine { id: String -> engine.resume(id) }
    AsyncFunction("cancel") Coroutine { id: String -> engine.cancel(id) }
    AsyncFunction("listLibrary") Coroutine { cursor: String?, limit: Int -> engine.library(cursor, limit) }
    OnActivityResult { _, p -> DeleteRequests.onResult(p.requestCode, p.resultCode) }
  }
}
```

Use module-level events keyed by download id rather than one `SharedObject` per download. Downloads outlive JS reloads, and shared objects are tied to the JS runtime.

### 6.3 expo-video 57.0.2 (Media3 1.9.0 underneath)

- 57.0.0 has no user-facing changes (local CHANGELOG). 56.1.x added Android `exitFullscreen`, fixed a PiP fragment crash after process death, and fixed HLS track dedupe.
- **Source:** `useVideoPlayer(source, setup?)`. `VideoSource` fields: `uri`, `headers`, `metadata`, `useCaching`, `contentType: 'auto'|'progressive'|'hls'|'dash'|'smoothStreaming'`, `drm`. Local library playback via `content://` or `file://` URIs (ExoPlayer's default data source handles both; not tested this session).
- **`VideoView` props** (`VideoView.types.d.ts`):
  - `nativeControls` (default true)
  - `contentFit` (`contain`/`cover`/`fill`)
  - `fullscreenOptions` (`enable`, `orientation`, `autoExitOnRotate`, `keepFullscreenOnPiPStop`)
  - `allowsPictureInPicture`, `startsPictureInPictureAutomatically` (Android 12+)
  - `surfaceType` (`surfaceView` default; use `textureView` only for overlapping views; documented `cover` bug)
  - `onFirstFrameRender`, `useExoShutter`
  - `buttonOptions` (`showSeekForward`, `showSeekBackward`, `showSubtitles`, `showSettings`, `showPlayPause`, `showBottomBar`, …) for the native controls
- **Player:**
  - `timeUpdateEventInterval` (seconds; 0 disables)
  - `playbackRate`, `loop`, `muted`, `volume`, `bufferOptions`, `keepScreenOnWhilePlaying`, `staysActiveInBackground`, `showNowPlayingNotification`
  - `audioTrack` / `subtitleTrack` / `availableAudioTracks` / `availableSubtitleTracks`, `availableVideoTracks`
  - `seekBy`, `seekTolerance`, `scrubbingModeOptions` (`scrubbingModeEnabled` suppresses playback until reset)
  - `replaceAsync`, `generateThumbnailsAsync(times, {maxWidth,maxHeight})`
  - `bitrate` is deprecated in favour of `peakBitrate`/`averageBitrate`
- **Events** (`VideoPlayerEvents.types.d.ts`): `statusChange`, `playingChange`, `playbackRateChange`, `volumeChange`, `mutedChange`, `playToEnd`, `timeUpdate`, `sourceChange`, `availableSubtitleTracksChange`, `subtitleTrackChange`, `availableAudioTracksChange`, `audioTrackChange`, `videoTrackChange`, `sourceLoad`, `isExternalPlaybackActiveChange`. Subscribe with `useEvent`/`useEventListener` from `expo`.
- **Custom controls pattern:**
  - `nativeControls={false}` with an overlay.
  - `player.timeUpdateEventInterval = 0.25` while controls are visible, 0 when hidden.
  - Scrubbing: set `scrubbingModeOptions.scrubbingModeEnabled` during drag and assign `currentTime` on release.
  - Double-tap: `seekBy(±10)`.
- **PiP / background:** `app.json` lists `"expo-video"` with no options, so PiP and background playback aren't configured. Config plugins only apply at prebuild. Either adopt prebuild, or mirror exactly what `node_modules/expo-video/plugin/build/withExpoVideo.js` adds (not inspected in detail: **UNVERIFIED** entries, including `supportsPictureInPicture` on the activity).

### 6.4 expo-file-system 57

- `File`/`Directory`/`Paths`. On Android, `Paths.document` and `Paths.cache` are the app's internal directories (`FileSystemModule.kt:27-43`).
- `File.contentUri`, `File.info()`; `File.open(mode)` → `FileHandle.readBytes/writeBytes/offset/size`.
- `File.downloadFileAsync(url, dest, {headers, idempotent})`; `File.createDownloadTask(...)` → `DownloadTask` with `pause/pauseAsync/resumeAsync/savable/fromSavable`.
- **Docs: `DownloadTask` doesn't survive app termination.** It can't be the core downloader.
- Legacy API: `expo-file-system/legacy`.
- `content://` (SAF) URIs don't support `ReadWrite` mode.
- 57.0.2 fixed `rename()` breaking `.uri` for names with spaces.

### 6.5 expo-sqlite 57

- API: `openDatabaseAsync(name, {enableChangeListener, useNewConnection}, dir)`, `runAsync/getFirstAsync/getAllAsync/getEachAsync`, `prepareAsync`, `withExclusiveTransactionAsync` (prefer it over `withTransactionAsync`), the `db.sql` tagged template (`.first()`, `.each()`, `.values()`), `SQLiteProvider`/`useSQLiteContext`, `addDatabaseChangeListener`.
- Default directory is `filesDir/SQLite` (`SQLiteModule.kt:35-36`).
- **Don't open one database file from both expo-sqlite and Kotlin.** expo-sqlite ships its own SQLite build (this repo enables FTS in `gradle.properties`), separate from the system SQLite. Two SQLite copies in one process on the same file is a documented corruption risk (sqlite.org "How To Corrupt", multiple copies of SQLite in one process; not fetched this session).
- The native engine should own `vidorax-media.db` (Room or `SQLiteOpenHelper`), and JS reads it only through the module. JS-only data (history, bookmarks) can stay in expo-sqlite.
- Today download records are in AsyncStorage (`src/downloads/engine/persistence.ts:232,258`) and the catalog is in SQLite (`src/storage/sqlite/schema.ts:93`): two sources of truth.

### 6.6 expo-media-library

Not installed, and not needed if the module does MediaStore itself.

---

## 7. react-native-webview 13.16.1 on Android (verified in node_modules source)

| Topic | Actual behaviour | Consequence / action |
|---|---|---|
| `injectedJavaScriptBeforeContentLoaded` | Runs via `evaluateJavascript` from `onPageStarted` (`RNCWebViewClient.java:85-90` → `RNCWebView.java:311`). Docs: "not 100% reliable" on Android. | Races page scripts, so MSE/fetch hooks miss early calls. Patch in `WebViewCompat.addDocumentStartJavaScript(webView, js, setOf("*"))`, gated on `WebViewFeature.isFeatureSupported(DOCUMENT_START_SCRIPT)`. Per androidx docs it runs "before any of the page's JavaScript code". Keep the `ScriptHandler` and `remove()` it on prop change. Use `Collections.singleton("*")` in patches. |
| `injectedJavaScriptForMainFrameOnly=false` | Setters store the values (`RNCWebViewManagerImpl.kt:502,507`) but the fields `RNCWebView.java:66-67` are **never read**. Docs: "mandatory for Android". | No iframe injection today. Document-start scripts registered with `"*"` cover frames matching the origin rules (the docs for `addWebMessageListener` say "any frame whose origin matches"; the per-frame wording for document-start scripts: **UNVERIFIED**). Guard scripts with `if (window.__vdx) return`. |
| `onMessage` from iframes | Bridge is `addWebMessageListener(webView, "ReactNativeWebView", Set.of("*"))` (`RNCWebView.java:259-264`); fallback `addJavascriptInterface` (269). The object is available in every matching frame; `isMainFrame` is ignored and `sourceOrigin` becomes the event `url`. | Iframes **can** post. Treat every message as untrusted, and don't read `nativeEvent.url` as the page URL. The object may appear after a document-start script runs (**UNVERIFIED** ordering), so queue messages until `window.ReactNativeWebView` exists. |
| Multiple windows | `setSupportMultipleWindows(true)` is forced (`RNCWebViewManagerImpl.kt:79`). `onCreateWindow` creates a bare `new WebView(context)` (`RNCWebChromeClient.java:89-91`) with default settings, never attached, and only reports the first navigation if `onOpenWindow` is set. | Without `onOpenWindow`, popup and `target=_blank` players silently go nowhere. Handle `onOpenWindow` by opening a tab. |
| Downloads (`Content-Disposition`) | Built-in `DownloadListener` sends everything to `DownloadManager` → public Downloads, with a permission gate and cookies for `scheme://host` only (`RNCWebViewManagerImpl.kt:94,113-114`). | Patch it to call the native engine with `(url, userAgent, contentDisposition, mimetype, contentLength)` and `getCookie(fullUrl)`. |
| Media settings | `mediaPlaybackRequiresUserAction` → `mediaPlaybackRequiresUserGesture` (537), default true. `allowsFullscreenVideo` default false. `allowsProtectedMedia` default false. `mixedContentMode` default `NEVER_ALLOW` (84). `thirdPartyCookiesEnabled` default true (709-711). | Set `mediaPlaybackRequiresUserAction={false}` so page players start and their network requests become observable. Enable fullscreen video. A page asking for protected media is a DRM signal: tell the user "can't save". |
| Cookies | Process-wide `CookieManager`, shared with native. The client calls `flush()` in `onPageFinished`. | Read `getCookie(mediaUrl)` in native; call `flush()` on app background. |

**Existing `shouldInterceptRequest` hook** (applied by `scripts/apply-webview-media-hook.js`):
- `RNCWebViewClient.java:168-178` does `Class.forName` + `getMethod` + `invoke` via reflection **on every subresource request**.
- `MediaNetworkBridge.observeRequestFrom` is `@Synchronized` (`MediaNetworkBridge.kt:132`). WebView calls `shouldInterceptRequest` on background threads, and a resource isn't fetched until the callback returns. One global lock plus about 10 regexes per URL serializes resource loading on heavy pages (Instagram/TikTok).
- `hasCookie` (159) is probably always false, because intercepted request headers generally don't carry `Cookie` (**UNVERIFIED**, community reports).
- The ServiceWorker client (353) is process-global, and its candidates carry `webViewId=-1`, so they can't be tied to a tab.

Fix:
1. A static `volatile` observer interface on `RNCWebViewClient`, set once by the module (no reflection).
2. A lock-free prefilter: cheap `endsWith`/`contains` checks before any regex.
3. Emit only candidates.

`shouldInterceptRequest` never gives you response headers or bodies unless you perform the request yourself, which breaks cookies, range and CORS semantics. Don't.

**Detecting blob:/MSE players** (TikTok/Instagram/YouTube-style):
- Don't ship media bytes over the bridge.
- A document-start script wraps `MediaSource.prototype.addSourceBuffer` (codec strings), `fetch` / `XMLHttpRequest.prototype.open` (URLs + Range, filtered by media heuristics in JS) and `play` events on `HTMLMediaElement` (`currentSrc`, `videoWidth/Height`, `duration`).
- Correlate those with the native network observer, then re-download natively (strip range params to fetch the full file).
- Per-site URL patterns (Instagram `bytestart/byteend`, TikTok cookie/Referer requirements) are **UNVERIFIED**, and yt-dlp's history shows they change often.
- **YouTube:** SABR streaming and per-video, session-bound PO tokens make direct `googlevideo` downloads impractical. Declare it unsupported. There's also Play policy risk for downloader apps.

---

## 8. Recommended architecture

```
JS (Expo Router)                                   Kotlin: modules/vidorax-media (Application-scoped singleton, coroutines)
────────────────                                   ───────────────────────────────────────────────────────────────────────
Browser tab (webview + patch-package patch)  ──►  WebBridge: DocumentStart script mgmt, NetworkObserver (static hook), CookieSnapshot
  candidates → Detection store (rank/dedupe)       Probe: HEAD/Range 0-0 sniff → progressive | HLS | DASH | separate A/V; DRM/live; variants
  "Download" sheet (variant picker)          ──►  Engine: queue + state machine + per-host limits; OkHttp transfer (Range/If-Range, AES-128)
Library UI (list, thumbs, delete, share)     ◄──  Remuxer: MediaExtractorCompat → Mp4Muxer / WebmMuxer; Transformer fallback (audio transcode)
Player (expo-video, custom controls)              Publisher: MediaStore Movies/VidoraX (IS_PENDING), thumbnails, metadata, delete requests
  requireNativeModule('VidoraMedia')              Store: vidorax-media.db (downloads, parts, library_items) — single source of truth
  AsyncFunction + Events (≤4 Hz)                  Runners: UIDT JobService (34+) | dataSync FGS (24–33); notifications w/ Pause/Cancel actions
```

**States** (persisted before side effects):
`QUEUED → PROBING → DOWNLOADING ⇄ PAUSED | WAITING_NETWORK | WAITING_RETRY → PROCESSING → PUBLISHING → COMPLETED`, with terminal `FAILED(code)`, `NEEDS_REFRESH` (expired signed URL), `CANCELLED`.

**Tables:**
- `downloads(id, state, error_code, page_url, kind, video_url, audio_url, headers_json, cookie_snapshot, title, variant_json, est_bytes, bytes_done, temp_dir, output_uri, attempts, created_at, updated_at)`
- `parts(download_id, idx, track, url, byte_offset, byte_length, key_uri, iv, disc_seq, state, bytes_done, etag)`
- `library_items(id, download_id, content_uri, mediastore_id, display_name, relative_path, mime, container, vcodec, acodec, width, height, rotation, duration_ms, size_bytes, thumb_path, source_host, created_at, missing)`

**Split of responsibilities:**
- JS: UI, detection ranking, variant choice, library presentation, player.
- Native: everything that touches network bytes, files, MediaStore, background execution and persistence of download state.

**Testing** (replaces the 130 `verify-*.ts` scripts):
- JVM unit tests: segment planning from m3u8/mpd fixture strings, IV derivation, Range/Content-Range parsing, state transitions, OkHttp `MockWebServer` (206/200-on-range/416/403/slow).
- Instrumented tests: remux corpus covering TS H.264+AAC with B-frames, TS with a discontinuity, fMP4 HLS with separate audio rendition, packed AAC with ID3, DASH SegmentBase A/V, SegmentTemplate `$Time$`, VP9+Opus, AV1+Opus, HEVC 10-bit, a 90°-rotated MP4, and a synthetic file over 4 GB. Assert track count, duration, A/V start delta, and that ExoPlayer plays to `STATE_ENDED`.

**Order of work:**
1. **Spike (3–5 days):** Mp4Muxer on the corpus, plus Transformer on local HLS/DASH as fallback evidence.
2. Progressive + separate A/V + MediaStore + runners + library.
3. HLS (TS/fMP4, AES-128, renditions, byte-range).
4. DASH.
5. WebView detection rewrite.
6. Player polish.

### Keep / refactor / delete (my scope)

Keep-worthy (port the ideas, fix the bugs):
- `VidoraMediaExportModule.kt`: the MediaStore flow is solid — insert `IS_PENDING=1`, stream copy, byte-count check, publish, clean up pending on failure — plus path-containment and name/MIME sanitizers.
  - Bugs to fix when porting:
    - One `pendingSaf` slot (35, 137): a second SAF export overwrites the first promise, which then never settles.
    - `deletePendingMediaStoreUri` (74-84) deletes **any** content URI JS passes, including published files the app owns.
- `MediaNetworkBridge.kt`: the prefilter heuristics (media/segment/init/API regex lists), dedupe, rate limiting, and not logging URLs or cookies are worth porting. The structure (global lock, reflection entry point, RN-bridge `DeviceEventEmitter`) is not.
- `VidoraCookieBridgeModule.kt` is trivial and correct. Fold it into the module.
- `VidoraDownloadNotificationsModule.kt`: the channel and PendingIntent code is reusable. It's explicitly "NOT a foreground service" (line 4), which is why downloads die with the process.

Delete or replace:
- JS transfer and HLS engine (`src/downloads/engine/**`, ~18K lines per `wc`). It refuses AES-128 (`hls/playlist.ts:201-205`), `BYTERANGE` (232-245) and `GAP`, and saves TS HLS as raw `.ts` (`playlist.ts:523-524`).
- `scripts/apply-player-native-modules.js`
- `scripts/apply-webview-media-hook.js` → becomes a patch-package patch
- `SYSTEM_ALERT_WINDOW` (`AndroidManifest.xml:5`, unused)

Manifest notes for targetSdk 36:
- `android:screenOrientation="portrait"` (`AndroidManifest.xml:50`) is ignored on displays with smallest width ≥ 600 dp, so the player can't assume a portrait lock.
- `enableOnBackInvokedCallback="false"` (40) is still a valid predictive-back opt-out on 16.

---

## 9. UNVERIFIED items (confirm in the spike)

- `MediaFormatUtil.createFormatFromMediaFormat` exact name; `Mp4Muxer` `co64` over 4 GB; `Mp4Muxer` heap use on long content; `setSampleCopyingEnabled` default.
- Platform `MediaExtractor` on concatenated fMP4 with repeated `styp`/`sidx`, and its edit-list and PTS-wrap handling across OEMs.
- ADTS→ASC and csd population through `MediaExtractorCompat` (high confidence, not fetched).
- Transformer with HLS/DASH input end to end (code path exists; not documented as supported).
- AES-128 + `BYTERANGE` IV semantics per sub-range; `CipherInputStream` swallowing padding errors on Android.
- Order of document-start script vs web-message-listener object injection; per-frame wording for document-start scripts.
- `Cookie` absent from intercepted request headers.
- MediaStore display-name collision renaming; seekable `rw` fds on FUSE for direct muxing.
- `withExpoVideo.js` exact manifest changes.
- UIDT `setNotification` deadline and runtime cap; policy on running a remux inside a UIDT job; Play Console FGS declaration details.
- OkHttp version Gradle resol

<!-- next block -->

ution (4.9.2 declared by RN, 4.12.0 in cache; run `./gradlew :app:dependencies` to confirm).
- Social-site specifics: Instagram/Facebook separate A/V MP4 with `bytestart/byteend` params, TikTok cookie and Referer requirements, parallel-range throttling per CDN.
- Numbers: remux throughput for about 1 GB (expect seconds to tens of seconds; measure), notification update rate limits.

---

## 10. Sources

**Muxing / demuxing / Media3**
- MediaMuxer reference: https://developer.android.com/reference/android/media/MediaMuxer
- MediaMuxer AOSP source (class doc, B-frames since 7.1, writeSampleData): https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/media/java/android/media/MediaMuxer.java
- MediaMuxer.addTrack codec table (mirror of AOSP Javadoc): https://learn.microsoft.com/en-us/dotnet/api/android.media.mediamuxer.addtrack?view=net-android-34.0
- Android supported media formats: https://developer.android.com/media/platform/supported-formats
- Mp4Muxer source: https://raw.githubusercontent.com/androidx/media/release/libraries/muxer/src/main/java/androidx/media3/muxer/Mp4Muxer.java
- Mp4Muxer Boxes (ctts v1, elst, fourccs, MP3 unsupported): https://raw.githubusercontent.com/androidx/media/release/libraries/muxer/src/main/java/androidx/media3/muxer/Boxes.java
- Media3 BufferInfo: https://raw.githubusercontent.com/androidx/media/release/libraries/muxer/src/main/java/androidx/media3/muxer/BufferInfo.java
- Media3 1.9.0 what's new (inspector, WebmMuxer context, InAppMp4Muxer default): https://android-developers.googleblog.com/2025/12/media3-190-whats-new.html
- Media3 1.9.0 release (minSdk 23, WebmMuxer): https://github.com/androidx/media/releases/tag/1.9.0 and https://newreleases.io/project/github/androidx/media/release/1.9.0
- Media3 release notes: https://github.com/androidx/media/blob/release/RELEASENOTES.md
- MediaExtractorCompat guide: https://developer.android.com/media/media3/inspector/extract-samples
- MediaExtractorCompat source: https://raw.githubusercontent.com/androidx/media/release/libraries/inspector/src/main/java/androidx/media3/inspector/MediaExtractorCompat.java
- Media3 MetadataRetriever: https://developer.android.com/media/media3/inspector/retrieve-metadata
- Transformer supported formats: https://developer.android.com/media/media3/transformer/supported-formats
- Transformer getting started: https://developer.android.com/media/media3/transformer/getting-started
- TransformerUtil (transcode vs transmux): https://raw.githubusercontent.com/androidx/media/release/libraries/transformer/src/main/java/androidx/media3/transformer/TransformerUtil.java
- ExoPlayerAssetLoader: https://raw.githubusercontent.com/androidx/media/release/libraries/transformer/src/main/java/androidx/media3/transformer/ExoPlayerAssetLoader.java
- ExoAssetLoaderBaseRenderer (bypass path): https://raw.githubusercontent.com/androidx/media/release/libraries/transformer/src/main/java/androidx/media3/transformer/ExoAssetLoaderBaseRenderer.java
- Composition (setTransmuxAudio/Video): https://raw.githubusercontent.com/androidx/media/release/libraries/transformer/src/main/java/androidx/media3/transformer/Composition.java
- MediaMetadataRetriever AOSP source (codec MIME key is @hide SystemApi): https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/media/java/android/media/MediaMetadataRetriever.java

**ffmpeg-kit status**
- https://github.com/arthenica/ffmpeg-kit
- https://tanersener.medium.com/saying-goodbye-to-ffmpegkit-33ae939767e1
- https://www.itpathsolutions.com/ffmpegkit-shutdown-what-to-do-next

**HLS / DASH**
- RFC 8216 (HLS): https://www.rfc-editor.org/rfc/rfc8216
- HlsPlaylistParser source: https://raw.githubusercontent.com/androidx/media/release/libraries/exoplayer_hls/src/main/java/androidx/media3/exoplayer/hls/playlist/HlsPlaylistParser.java
- DashUtil source: https://raw.githubusercontent.com/androidx/media/release/libraries/exoplayer_dash/src/main/java/androidx/media3/exoplayer/dash/DashUtil.java
- Media3 downloading media (DownloadManager/DownloadService): https://developer.android.com/media/media3/exoplayer/downloading-media

**Background work / notifications**
- Android 15 behavior changes: https://developer.android.com/about/versions/15/behavior-changes-15
- dataSync migration alternatives: https://developer.android.com/about/versions/15/changes/datasync-migration
- Android 16 behavior changes (all apps, job quotas): https://developer.android.com/about/versions/16/behavior-changes-all
- Android 16 behavior changes (target 36): https://developer.android.com/about/versions/16/behavior-changes-16
- User-initiated data transfer jobs: https://developer.android.com/develop/background-work/background-tasks/uidt
- WorkManager long-running workers: https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running
- WorkManager releases (2.10 FGS timeout stop reason): https://developer.android.com/jetpack/androidx/releases/work
- Foreground service types: https://developer.android.com/develop/background-work/services/fg-service-types
- Notification runtime permission: https://developer.android.com/develop/ui/views/notifications/notification-permission
- RFC 9110 (Range / If-Range; not fetched this session): https://www.rfc-editor.org/rfc/rfc9110

**Storage**
- MediaStore shared media: https://developer.android.com/training/data-storage/shared/media
- SQLite corruption with multiple SQLite copies in one process (not fetched this session): https://www.sqlite.org/howtocorrupt.html

**Expo SDK 57**
- expo-video v57: https://docs.expo.dev/versions/v57.0.0/sdk/video/
- expo-file-system v57: https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/
- expo-sqlite v57: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/
- Expo Modules API: https://docs.expo.dev/modules/module-api/
- Local Expo module setup: https://docs.expo.dev/modules/get-started/
- Inline modules reference: https://docs.expo.dev/modules/inline-modules-reference/
- Expo SDK 57 changelog: https://expo.dev/changelog/sdk-57

**WebView**
- react-native-webview props reference: https://raw.githubusercontent.com/react-native-webview/react-native-webview/master/docs/Reference.md
- androidx WebViewCompat source (addDocumentStartJavaScript, addWebMessageListener): https://raw.githubusercontent.com/androidx/androidx/androidx-main/webkit/webkit/src/main/java/androidx/webkit/WebViewCompat.java

**Platform / policy risk**
- YouTube SABR forcing, 403s: https://github.com/yt-dlp/yt-dlp/issues/15689
- YouTube SABR + PO tokens explainer: https://vidferry.com/blog/youtube-downloader-not-working-2026/
- TikTok direct URL 403: https://github.com/yt-dlp/yt-dlp/issues/13771
- Google Play Developer Program Policy: https://support.google.com/googleplay/android-developer/answer/17190352?hl=en
- Downloader apps and Google Play: https://www.androidheadlines.com/2026/05/beyond-the-app-store-why-the-best-media-downloaders-arent-on-google-play.html

**Repo files cited (read-only)**
- `/Users/mac/Downloads/vidorax-mobile/android/app/src/main/AndroidManifest.xml`
- `/Users/mac/Downloads/vidorax-mobile/android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt`
- `/Users/mac/Downloads/vidorax-mobile/android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt`
- `/Users/mac/Downloads/vidorax-mobile/android/app/src/main/java/com/anonymous/vidorax/mediadetection/VidoraCookieBridgeModule.kt`
- `/Users/mac/Downloads/vidorax-mobile/android/app/src/main/java/com/anonymous/vidorax/mediaexport/VidoraMediaExportModule.kt`
- `/Users/mac/Downloads/vidorax-mobile/android/app/src/main/java/com/anonymous/vidorax/notifications/VidoraDownloadNotificationsModule.kt`
- `/Users/mac/Downloads/vidorax-mobile/scripts/apply-webview-media-hook.js`
- `/Users/mac/Downloads/vidorax-mobile/scripts/apply-player-native-modules.js`
- `/Users/mac/Downloads/vidorax-mobile/src/downloads/engine/hls/playlist.ts`
- `/Users/mac/Downloads/vidorax-mobile/src/downloads/engine/persistence.ts`
- `/Users/mac/Downloads/vidorax-mobile/src/storage/sqlite/schema.ts`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/expo-video/android/build.gradle`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebChromeClient.java`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js`
- `/Users/mac/Downloads/vidorax-mobile/node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/ExpoAutolinkingPlugin.kt`