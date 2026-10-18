package com.vidorax.media.library

import android.Manifest
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.StoragePermissionException
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume

/** A vault file failed authentication; it is not decrypted or exported. */
class VaultCorruptException(message: String) : CodedException("ERR_VAULT_CORRUPT", message, null)

/** The folder picked for an export can no longer be written. */
class VaultFolderAccessException(message: String) : CodedException("ERR_FOLDER_ACCESS", message, null)

/**
 * The vault's master key: AES-256-GCM, generated inside the Android Keystore and never exportable. It only ever seals
 * the per-file keys; it is not tied to the App Lock PIN (the PIN guards the Private section's screen).
 */
internal object KeystoreVaultKeys : VaultKeyWrapper {
  private const val PROVIDER = "AndroidKeyStore"
  private const val ALIAS = "vidorax_private_vault_v1"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  @Synchronized
  private fun masterKey(): SecretKey {
    val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        // The Keystore picks every IV, so a master-key IV can never repeat.
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  override fun wrap(key: ByteArray): WrappedKey {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, masterKey())
    return WrappedKey(cipher.iv, cipher.doFinal(key))
  }

  override fun unwrap(wrapped: WrappedKey): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(VaultFormat.TAG_BITS, wrapped.iv))
    return cipher.doFinal(wrapped.bytes)
  }
}

/** What the vault keeps about an item, sealed in `<id>.vxm`; never in the library database. */
internal data class VaultMeta(
  val id: String,
  val title: String,
  val mimeType: String,
  val extension: String,
  val durationMs: Long?,
  val sizeBytes: Long,
  val width: Int?,
  val height: Int?,
  val createdAt: Long,
  val addedAt: Long,
  val hasThumbnail: Boolean,
) {
  fun toJson(): String = JSONObject()
    .put("v", 1)
    .put("id", id)
    .put("title", title)
    .put("mimeType", mimeType)
    .put("extension", extension)
    .put("durationMs", durationMs ?: JSONObject.NULL)
    .put("sizeBytes", sizeBytes)
    .put("width", width ?: JSONObject.NULL)
    .put("height", height ?: JSONObject.NULL)
    .put("createdAt", createdAt)
    .put("addedAt", addedAt)
    .put("hasThumbnail", hasThumbnail)
    .toString()

  fun toJs(): Map<String, Any?> = mapOf(
    "id" to id,
    "title" to title,
    "mimeType" to mimeType,
    "durationMs" to durationMs?.toDouble(),
    "sizeBytes" to sizeBytes.toDouble(),
    "width" to width,
    "height" to height,
    "createdAt" to createdAt.toDouble(),
    "addedAt" to addedAt.toDouble(),
    "hasThumbnail" to hasThumbnail,
  )

  companion object {
    fun fromJson(text: String): VaultMeta {
      val json = JSONObject(text)
      return VaultMeta(
        id = json.getString("id"),
        title = json.getString("title"),
        mimeType = json.getString("mimeType"),
        extension = FileNames.safeExtension(json.getString("extension")),
        durationMs = if (json.isNull("durationMs")) null else json.getLong("durationMs"),
        sizeBytes = json.getLong("sizeBytes"),
        width = if (json.isNull("width")) null else json.getInt("width"),
        height = if (json.isNull("height")) null else json.getInt("height"),
        createdAt = json.getLong("createdAt"),
        addedAt = json.getLong("addedAt"),
        hasThumbnail = json.optBoolean("hasThumbnail", false),
      )
    }
  }
}

/**
 * Private downloads (#459, #463): a separate encrypted vault in no-backup storage (`noBackupFilesDir/vault`). The
 * library, its database and its files are only ever read here: JavaScript removes the original through its usual
 * delete path, and only after [moveIn] resolved with a verified encrypted copy. A failure leaves the original alone.
 *
 * Playback decrypts to one temporary file in the private cache (`cacheDir/vault-play`), which [clearPlayback] deletes
 * when the player closes or the app leaves the foreground, and [cleanUp] at every start. Nothing here is logged.
 */
class PrivateVault internal constructor(
  private val context: Context,
  private val library: LibraryStore,
  private val crypto: VaultCrypto = VaultCrypto(KeystoreVaultKeys),
  private val now: () -> Long = System::currentTimeMillis,
) {
  private val root: File get() = File(context.noBackupFilesDir, VAULT_DIR)
  private val playRoot: File get() = File(context.cacheDir, PLAY_DIR)
  private val resolver: ContentResolver get() = context.contentResolver

  /**
   * Encrypts library item [id] into the vault, verifies the encrypted copy (every chunk authenticated and the same
   * SHA-256 as the source), then commits it. Resolves with the new vault item; the library item is untouched.
   */
  suspend fun moveIn(id: String): Map<String, Any?> = writeLock.withLock {
    val item = library.get(id) ?: throw NotFoundException("Unknown library item $id")
    withContext(Dispatchers.IO) {
      val source = item.file
      if (!source.isFile) throw NotFoundException("The file of $id is missing")
      val length = source.length()
      val folder = root
      if (!folder.isDirectory && !folder.mkdirs()) throw StorageException("Could not create the vault")
      if (folder.usableSpace < length + length / SEALING_OVERHEAD_DIVISOR + FREE_SPACE_MARGIN_BYTES) {
        throw StorageException("Not enough free space to move this video to Private")
      }
      val vaultId = UUID.randomUUID().toString()
      val progress = LongArray(2).also { it[1] = length }
      running[id] = progress
      try {
        val contentPart = part(vaultId, CONTENT)
        val written = FileInputStream(source).use { input ->
          FileOutputStream(contentPart).use { file ->
            val output = BufferedOutputStream(file, IO_BUFFER_BYTES)
            crypto.encrypt(BufferedInputStream(input, IO_BUFFER_BYTES), length, output) { progress[0] = it }
              .also { output.flush(); file.fd.sync() }
          }
        }
        // Verified before anything is committed: a copy that does not read back is never kept.
        val check = FileInputStream(contentPart).use { crypto.decrypt(BufferedInputStream(it, IO_BUFFER_BYTES), null) }
        if (check.length != length || !MessageDigest.isEqual(check.sha256, written.sha256)) {
          throw StorageException("The encrypted copy did not verify")
        }
        val thumbnail = item.thumbnail?.takeIf { it.isFile && it.length() in 1..MAX_THUMBNAIL_BYTES }
        val hasThumbnail = thumbnail != null && runCatching { sealSmall(thumbnail.readBytes(), part(vaultId, THUMBNAIL)) }.isSuccess
        val meta = VaultMeta(
          id = vaultId,
          title = Titles.clamp(item.title),
          mimeType = item.mimeType,
          extension = FileNames.safeExtension(item.file.extension),
          durationMs = item.durationMs,
          sizeBytes = length,
          width = item.width,
          height = item.height,
          createdAt = item.completedAt,
          addedAt = now(),
          hasThumbnail = hasThumbnail,
        )
        sealSmall(meta.toJson().toByteArray(Charsets.UTF_8), part(vaultId, META))
        // Commit: content, thumbnail, then metadata — an item is only listed once its metadata exists.
        commit(vaultId, CONTENT)
        if (hasThumbnail) commit(vaultId, THUMBNAIL)
        commit(vaultId, META)
        meta.toJs()
      } catch (e: Exception) {
        removeFiles(vaultId)
        throw mapFailure(e, "Could not move this video to Private")
      } finally {
        running.remove(id)
      }
    }
  }

  /**
   * Every vault item, newest first. An item that cannot be read — the device key that sealed it was lost, or its file
   * is gone — is never hidden: it is listed as `unreadable` (its id, size on disk and date) so it can still be deleted.
   */
  suspend fun list(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val files = root.listFiles { file -> file.isFile && file.name.endsWith(".$META") }.orEmpty()
    files.mapNotNull { file ->
      val id = file.name.removeSuffix(".$META")
      if (!isVaultId(id)) return@mapNotNull null
      val content = file(id, CONTENT)
      val meta = if (content.isFile) runCatching { readMeta(id) }.getOrNull()?.takeIf { it.id == id } else null
      if (meta != null) meta.addedAt to meta.toJs() else file.lastModified() to unreadableJs(id, content, file)
    }.sortedByDescending { it.first }.map { it.second }
  }

  /** What is known about an item that cannot be opened: nothing of its sealed content, only what the disk says. */
  private fun unreadableJs(id: String, content: File, meta: File): Map<String, Any?> = mapOf(
    "id" to id,
    "unreadable" to true,
    "title" to "",
    "mimeType" to "application/octet-stream",
    "durationMs" to null,
    "sizeBytes" to (if (content.isFile) content.length() else 0L).toDouble(),
    "width" to null,
    "height" to null,
    "createdAt" to 0.0,
    "addedAt" to meta.lastModified().toDouble(),
    "hasThumbnail" to false,
  )

  /** The item's thumbnail as a `data:` URI (held in memory by JavaScript only), or null when it has none. */
  suspend fun thumbnail(vaultId: String): String? = withContext(Dispatchers.IO) {
    requireVaultId(vaultId)
    val file = file(vaultId, THUMBNAIL)
    if (!file.isFile) return@withContext null
    // A thumbnail that does not open is simply not shown.
    val bytes = runCatching { openSmall(file) }.getOrNull() ?: return@withContext null
    "data:image/webp;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  /**
   * Decrypts the item to a temporary file in the private cache for the player and resolves with its `file://` URI.
   * Any earlier playback file is removed first, so at most one exists.
   */
  suspend fun openForPlayback(vaultId: String): String = withContext(Dispatchers.IO) {
    requireVaultId(vaultId)
    val meta = readMetaOrThrow(vaultId)
    clearPlaybackFiles()
    val folder = playRoot
    if (!folder.isDirectory && !folder.mkdirs()) throw StorageException("Could not prepare playback")
    val target = File(folder, "${UUID.randomUUID()}.${meta.extension}")
    try {
      decryptInto(vaultId, meta) { FileOutputStream(target) }
      Uri.fromFile(target).toString()
    } catch (e: Exception) {
      target.delete()
      throw mapFailure(e, "Could not open this video")
    }
  }

  /** Deletes the temporary playback file(s). Never throws. */
  fun clearPlayback() {
    runCatching { clearPlaybackFiles() }
  }

  /** At start: playback leftovers, half-written vault files, and content whose metadata was never committed. */
  suspend fun cleanUp() = withContext(Dispatchers.IO) {
    clearPlayback()
    writeLock.withLock {
      val files = root.listFiles().orEmpty()
      val committed = files.filter { it.name.endsWith(".$META") }.map { it.name.removeSuffix(".$META") }.toSet()
      for (file in files) {
        val id = file.name.substringBefore('.')
        if (file.name.endsWith(PART_SUFFIX) || id !in committed) runCatching { file.delete() }
      }
    }
  }

  /** Removes the item from the vault (all of its files). */
  suspend fun delete(vaultId: String) {
    requireVaultId(vaultId)
    writeLock.withLock { withContext(Dispatchers.IO) { removeFiles(vaultId) } }
  }

  /**
   * Export to the Gallery: decrypts into `Movies/VidoraX` (audio into `Music/VidoraX`) and resolves with the new
   * item's URI. Android 7-9 need the storage permission (ERR_STORAGE_PERMISSION without it).
   */
  suspend fun exportToGallery(vaultId: String): String = withContext(Dispatchers.IO) {
    requireVaultId(vaultId)
    val meta = readMetaOrThrow(vaultId)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) publish(vaultId, meta) else writeLegacy(vaultId, meta)
    } catch (e: Exception) {
      throw mapFailure(e, "Could not export this video")
    }
  }

  /** Export to a folder the user picked (a persisted Storage Access Framework tree). Resolves with the new file. */
  suspend fun exportToFolder(vaultId: String, treeUri: String): String = withContext(Dispatchers.IO) {
    requireVaultId(vaultId)
    val meta = readMetaOrThrow(vaultId)
    val tree = runCatching { Uri.parse(treeUri.trimEnd('/')) }.getOrNull()
    if (tree == null || tree.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(tree)) {
      throw InvalidRequestException("Not a picked folder")
    }
    if (resolver.persistedUriPermissions.none { it.uri == tree && it.isWritePermission }) {
      throw VaultFolderAccessException("The chosen folder can no longer be written")
    }
    val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    val document = try {
      DocumentsContract.createDocument(resolver, parent, meta.mimeType, galleryFileName(meta.title, meta.extension))
    } catch (e: SecurityException) {
      throw VaultFolderAccessException("The chosen folder can no longer be written")
    } catch (e: IOException) {
      throw VaultFolderAccessException("The chosen folder was moved or deleted")
    } ?: throw StorageException("The folder did not create the file")
    try {
      decryptInto(vaultId, meta) { resolver.openOutputStream(document, "w") ?: throw IOException("The folder did not open the file") }
      document.toString()
    } catch (e: Exception) {
      runCatching { DocumentsContract.deleteDocument(resolver, document) }
      throw mapFailure(e, "Could not export this video")
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun publish(vaultId: String, meta: VaultMeta): String {
    val audioOnly = meta.mimeType.startsWith("audio/")
    val collection = if (audioOnly) {
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
      MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    }
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, galleryFileName(meta.title, meta.extension))
      put(MediaStore.MediaColumns.TITLE, Titles.clamp(meta.title))
      put(MediaStore.MediaColumns.MIME_TYPE, meta.mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, galleryRoot(audioOnly) + "/")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(collection, values) ?: throw IOException("MediaStore did not create an item")
    try {
      decryptInto(vaultId, meta) { resolver.openOutputStream(uri, "w") ?: throw IOException("MediaStore did not open the item") }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      runCatching { resolver.delete(uri, null, null) }
      throw e
    }
    return uri.toString()
  }

  private suspend fun writeLegacy(vaultId: String, meta: VaultMeta): String {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
      throw StoragePermissionException("Saving to the gallery needs the storage permission on Android 9 and older")
    }
    val audioOnly = meta.mimeType.startsWith("audio/")
    @Suppress("DEPRECATION")
    val folder = File(Environment.getExternalStorageDirectory(), galleryRoot(audioOnly))
    if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create the gallery folder")
    val target = generateSequence(1) { it + 1 }
      .map { copy -> File(folder, galleryFileName(meta.title, meta.extension, copy)) }
      .first { !it.exists() }
    try {
      decryptInto(vaultId, meta) { FileOutputStream(target) }
    } catch (e: Exception) {
      target.delete()
      throw e
    }
    return suspendCancellableCoroutine { continuation ->
      MediaScannerConnection.scanFile(context, arrayOf(target.path), arrayOf(meta.mimeType)) { _, uri ->
        continuation.resume(uri?.toString() ?: Uri.fromFile(target).toString())
      }
    }
  }

  /** Streams the item's plaintext into the stream [open] gives (closed afterwards), with progress under its id. */
  private fun decryptInto(vaultId: String, meta: VaultMeta, open: () -> OutputStream) {
    val progress = LongArray(2).also { it[1] = meta.sizeBytes }
    running[vaultId] = progress
    try {
      FileInputStream(file(vaultId, CONTENT)).use { input ->
        open().use { sink ->
          val output = BufferedOutputStream(sink, IO_BUFFER_BYTES)
          crypto.decrypt(BufferedInputStream(input, IO_BUFFER_BYTES), output) { progress[0] = it }
          output.flush()
        }
      }
    } finally {
      running.remove(vaultId)
    }
  }

  /** Seals a small byte array (metadata, thumbnail) to [target] and checks it reads back. */
  private fun sealSmall(bytes: ByteArray, target: File) {
    FileOutputStream(target).use { file ->
      crypto.encrypt(ByteArrayInputStream(bytes), bytes.size.toLong(), file)
      file.fd.sync()
    }
    val opened = openSmall(target) ?: throw StorageException("The encrypted file did not verify")
    if (!MessageDigest.isEqual(opened, bytes)) throw StorageException("The encrypted file did not verify")
  }

  /** Opens a small sealed file; null when it is too large to be one of ours. */
  private fun openSmall(file: File): ByteArray? {
    if (file.length() > MAX_THUMBNAIL_BYTES + SMALL_FILE_OVERHEAD_BYTES) return null
    val out = ByteArrayOutputStream()
    FileInputStream(file).use { crypto.decrypt(it, out) }
    return out.toByteArray()
  }

  private fun readMeta(vaultId: String): VaultMeta {
    val bytes = openSmall(file(vaultId, META)) ?: throw VaultIntegrityException("Metadata too large")
    return VaultMeta.fromJson(String(bytes, Charsets.UTF_8))
  }

  private fun readMetaOrThrow(vaultId: String): VaultMeta {
    if (!file(vaultId, META).isFile || !file(vaultId, CONTENT).isFile) throw NotFoundException("Unknown private item")
    return try {
      readMeta(vaultId)
    } catch (e: VaultIntegrityException) {
      throw VaultCorruptException("This private item cannot be opened")
    } catch (e: Exception) {
      throw VaultCorruptException("This private item cannot be opened")
    }
  }

  private fun clearPlaybackFiles() {
    playRoot.takeIf { it.exists() }?.deleteRecursively()
  }

  private fun file(vaultId: String, kind: String) = File(root, "$vaultId.$kind")

  private fun part(vaultId: String, kind: String) = File(root, "$vaultId.$kind$PART_SUFFIX")

  private fun commit(vaultId: String, kind: String) {
    if (!part(vaultId, kind).renameTo(file(vaultId, kind))) throw IOException("Could not commit the vault file")
  }

  private fun removeFiles(vaultId: String) {
    for (kind in listOf(META, THUMBNAIL, CONTENT)) {
      runCatching { file(vaultId, kind).delete() }
      runCatching { part(vaultId, kind).delete() }
    }
  }

  private fun requireVaultId(vaultId: String) {
    if (!isVaultId(vaultId)) throw InvalidRequestException("Not a private item id")
  }

  private fun mapFailure(e: Exception, message: String): Exception = when (e) {
    is CancellationException -> e
    is CodedException -> e
    is VaultIntegrityException -> VaultCorruptException("This private item cannot be opened")
    is SecurityException -> VaultFolderAccessException("The chosen folder can no longer be written")
    else -> StorageException(message, e)
  }

  internal companion object {
    const val VAULT_DIR = "vault"
    const val PLAY_DIR = "vault-play"
    const val CONTENT = "vxv"
    const val THUMBNAIL = "vxt"
    const val META = "vxm"
    const val PART_SUFFIX = ".part"
    const val IO_BUFFER_BYTES = 1 shl 16
    const val MAX_THUMBNAIL_BYTES = 4L * 1024 * 1024
    const val SMALL_FILE_OVERHEAD_BYTES = 1024L
    const val FREE_SPACE_MARGIN_BYTES = 32L * 1024 * 1024

    /** 16 tag bytes per 1 MiB chunk, rounded up generously. */
    const val SEALING_OVERHEAD_DIVISOR = 32_768L

    private val VAULT_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    /** One vault write at a time (move in, delete, clean-up). */
    private val writeLock = Mutex()

    /** Bytes done / total of a running move (keyed by library id) or decryption (keyed by vault id). Memory only. */
    private val running = ConcurrentHashMap<String, LongArray>()

    fun isVaultId(id: String): Boolean = VAULT_ID.matches(id)

    fun progress(key: String): Pair<Long, Long>? = running[key]?.let { it[0] to it[1] }
  }
}
