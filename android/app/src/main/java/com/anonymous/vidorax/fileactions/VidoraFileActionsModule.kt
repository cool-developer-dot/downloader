/**
 * Android completed-file Open / Share via ACTION_VIEW / ACTION_SEND.
 *
 * Accepts ONLY Expo FileSystem FileProvider content:// URIs
 * (`${applicationId}.FileSystemFileProvider`) with temporary read grants.
 * Never logs URI query/path contents that may include tokens.
 * Never accepts raw file:// or arbitrary content:// authorities.
 *
 * Open contract (Phase 1 external playback):
 * - ACTION_VIEW + setDataAndType(contentUri, mime)
 * - ClipData carrying the same URI so FLAG_GRANT_READ_URI_PERMISSION
 *   reaches the target player (createChooser historically dropped grants
 *   when only Intent.data was set)
 * - Prefer direct startActivity so the temporary grant applies to the
 *   receiving activity; Android still shows a disambiguation sheet when
 *   multiple handlers exist
 *
 * Share contract (Phase 2):
 * - ACTION_SEND + type = media MIME (never text/plain)
 * - EXTRA_STREAM = content:// attachment (the actual video)
 * - ClipData + FLAG_GRANT_READ_URI_PERMISSION
 * - Intent.createChooser for the system Sharesheet
 * - NEVER put the filename in EXTRA_TEXT (that is the RN ShareModule
 *   text-only bug: Android Share.share ignores url and shares message only)
 */
package com.anonymous.vidorax.fileactions

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = VidoraFileActionsModule.NAME)
class VidoraFileActionsModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  companion object {
    const val NAME: String = "VidoraFileActions"
  }

  @ReactMethod
  fun openContentUri(contentUri: String, mimeType: String?, promise: Promise) {
    try {
      val uri = parseTrustedContentUri(contentUri) ?: run {
        promise.reject("URI_CREATION_FAILED", "Invalid content URI")
        return
      }
      val mime = resolveMime(mimeType, uri)
      val intent = buildViewIntent(uri, mime)

      if (!hasCompatibleViewHandler(intent)) {
        promise.reject("NO_COMPATIBLE_APP", "No app is available to open this file")
        return
      }

      startViewIntent(intent)
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      promise.reject("NO_COMPATIBLE_APP", "No app is available to open this file")
    } catch (_: Exception) {
      promise.reject("OPEN_FAILED", "Unable to open this file")
    }
  }

  @ReactMethod
  fun shareContentUri(contentUri: String, mimeType: String?, title: String?, promise: Promise) {
    try {
      val uri = parseTrustedContentUri(contentUri) ?: run {
        promise.reject("URI_CREATION_FAILED", "Invalid content URI")
        return
      }
      val mime = resolveShareMime(mimeType, uri)
      val safeTitle = sanitizeTitle(title)

      val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        // Attachment is the completed media — never filename-as-text.
        putExtra(Intent.EXTRA_STREAM, uri)
        // Optional caption/subject only. Do NOT set EXTRA_TEXT to the filename:
        // React Native's ShareModule uses text/plain + EXTRA_TEXT and ignores
        // file URLs on Android, which produced "share video name only" bugs.
        if (safeTitle != null) {
          putExtra(Intent.EXTRA_SUBJECT, safeTitle)
        }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newUri(reactContext.contentResolver, "media", uri)
      }

      if (!hasCompatibleSendHandler(intent)) {
        promise.reject("NO_COMPATIBLE_APP", "No app is available to share this file")
        return
      }

      // Temporary read grants for chooser targets (ClipData + flags cover most
      // OEMs; explicit grants keep EXTRA_STREAM readable after createChooser).
      grantReadToSendTargets(intent, uri)

      val chooser = Intent.createChooser(intent, safeTitle).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      val activity = reactContext.currentActivity
      if (activity != null) {
        activity.startActivity(chooser)
      } else {
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(chooser)
      }
      // Resolving here means the Sharesheet was launched. User dismiss/cancel
      // is not an error and is not reported back by startActivity.
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      promise.reject("NO_COMPATIBLE_APP", "No app is available to share this file")
    } catch (_: Exception) {
      promise.reject("SHARE_FAILED", "Unable to share this file")
    }
  }

  @ReactMethod
  fun canOpenContentUri(contentUri: String, mimeType: String?, promise: Promise) {
    try {
      val uri = parseTrustedContentUri(contentUri) ?: run {
        promise.resolve(false)
        return
      }
      val mime = resolveMime(mimeType, uri)
      val intent = buildViewIntent(uri, mime)
      promise.resolve(hasCompatibleViewHandler(intent))
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  private fun buildViewIntent(uri: Uri, mime: String): Intent {
    return Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, mime)
      // ClipData is required for temporary URI grants to survive handoff to
      // external receivers (and any system intermediate). Share already set this;
      // Open previously did not — that caused "cannot open / unsupported file"
      // in external players while VidoraX internal Play still worked.
      clipData = ClipData.newUri(reactContext.contentResolver, "media", uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }

  private fun startViewIntent(intent: Intent) {
    val activity = reactContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(intent)
    }
  }

  private fun hasCompatibleViewHandler(intent: Intent): Boolean {
    return queryIntentActivities(intent).isNotEmpty() ||
      resolveActivity(intent) != null
  }

  private fun hasCompatibleSendHandler(intent: Intent): Boolean {
    return queryIntentActivities(intent).isNotEmpty() ||
      resolveActivity(intent) != null
  }

  private fun resolveActivity(intent: Intent): android.content.pm.ResolveInfo? {
    val pm = reactContext.packageManager
    val matchFlags = PackageManager.MATCH_DEFAULT_ONLY
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.resolveActivity(
        intent,
        PackageManager.ResolveInfoFlags.of(matchFlags.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      pm.resolveActivity(intent, matchFlags)
    }
  }

  private fun queryIntentActivities(intent: Intent): List<android.content.pm.ResolveInfo> {
    val pm = reactContext.packageManager
    val matchFlags = PackageManager.MATCH_DEFAULT_ONLY
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(
        intent,
        PackageManager.ResolveInfoFlags.of(matchFlags.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(intent, matchFlags)
    }
  }

  private fun grantReadToSendTargets(intent: Intent, uri: Uri) {
    val targets = queryIntentActivities(intent)
    for (info in targets) {
      val packageName = info.activityInfo?.packageName ?: continue
      try {
        reactContext.grantUriPermission(
          packageName,
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
      } catch (_: Exception) {
        // Best-effort; ClipData + intent flags remain the primary grant path.
      }
    }
  }

  /**
   * Only Expo FileSystem FileProvider URIs are accepted.
   * Blocks arbitrary MediaStore / other-app content:// grant launches.
   */
  private fun parseTrustedContentUri(raw: String): Uri? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) {
      return null
    }
    if (!trimmed.startsWith("content://", ignoreCase = true)) {
      return null
    }
    val uri = Uri.parse(trimmed)
    if (!uri.scheme.equals("content", ignoreCase = true)) {
      return null
    }
    if (uri.scheme.equals("file", ignoreCase = true)) {
      return null
    }
    val expectedAuthority = "${reactContext.packageName}.FileSystemFileProvider"
    val authority = uri.authority
    if (authority.isNullOrEmpty() || authority != expectedAuthority) {
      return null
    }
    return uri
  }

  private fun resolveMime(mimeType: String?, uri: Uri): String {
    val trimmed = mimeType?.trim()?.lowercase()
    if (!trimmed.isNullOrEmpty() && trimmed.contains('/') && trimmed != "*/*") {
      return trimmed
    }
    val last = uri.lastPathSegment ?: return "video/*"
    val dot = last.lastIndexOf('.')
    if (dot <= 0 || dot == last.length - 1) {
      // Prefer video/* over */* so package-visibility queries for video handlers apply.
      return "video/*"
    }
    val ext = last.substring(dot + 1).lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "video/*"
  }

  /** Share MIME must never collapse to text/plain (filename-only sharesheet). */
  private fun resolveShareMime(mimeType: String?, uri: Uri): String {
    val mime = resolveMime(mimeType, uri)
    if (mime == "text/plain" || mime.startsWith("text/")) {
      return resolveMime(null, uri)
    }
    return mime
  }

  private fun sanitizeTitle(title: String?): String? {
    val trimmed = title?.trim() ?: return null
    if (trimmed.isEmpty()) {
      return null
    }
    if (trimmed.contains("://") || trimmed.startsWith("http", ignoreCase = true)) {
      return null
    }
    return if (trimmed.length > 120) trimmed.take(119) + "…" else trimmed
  }
}
