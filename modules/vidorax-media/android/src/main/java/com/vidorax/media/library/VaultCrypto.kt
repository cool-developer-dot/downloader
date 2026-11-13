package com.vidorax.media.library

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * A vault file failed authentication: changed, truncated, extended, its chunks reordered, or sealed with another key.
 * Nothing of it is trusted.
 */
internal class VaultIntegrityException(message: String) : IOException(message)

/** A per-file key, sealed by the vault's master key. */
internal class WrappedKey(val iv: ByteArray, val bytes: ByteArray)

/** Seals per-file keys with a master key that never leaves the Android Keystore (a software key in JVM tests). */
internal interface VaultKeyWrapper {
  fun wrap(key: ByteArray): WrappedKey

  fun unwrap(wrapped: WrappedKey): ByteArray
}

/**
 * The vault's file format, `VXV1` (File Encryption #463). Every file — a video, its thumbnail, its metadata — gets its
 * own random AES-256 key, sealed by the Keystore master key and stored in the file's header. The content is cut into
 * chunks of [CHUNK_SIZE] (1 MiB), each sealed with AES-GCM under its own nonce: the file's random 8-byte prefix and
 * the chunk index. Each chunk's additional authenticated data binds the format, the plaintext length, the chunk index
 * and whether it is the last chunk, so chunks cannot be reordered, dropped, repeated or cut off without failing.
 *
 *     magic "VXV1" | version u8 | chunk size i32 | iv length u8 | iv | wrapped key length u16 | wrapped key
 *     | nonce prefix (8) | plaintext length i64 | chunk 0 sealed (n + 16) | chunk 1 sealed | …
 *
 * An empty file is one empty chunk, so it is authenticated too. Pure arithmetic lives here; the streaming is in
 * [VaultCrypto]. src/private-vault/vault-format.ts mirrors this math for its tests.
 */
internal object VaultFormat {
  val MAGIC: ByteArray = byteArrayOf(0x56, 0x58, 0x56, 0x31)
  const val VERSION = 1
  const val CHUNK_SIZE = 1 shl 20
  const val MIN_CHUNK_SIZE = 1 shl 4
  const val MAX_CHUNK_SIZE = 1 shl 23
  const val KEY_BYTES = 32
  const val NONCE_PREFIX_BYTES = 8
  const val NONCE_BYTES = 12
  const val TAG_BYTES = 16
  const val TAG_BITS = 128
  const val MAX_IV_BYTES = 32
  const val MAX_WRAPPED_KEY_BYTES = 512

  /** The chunk index is 4 bytes of the nonce: at most 2^32 chunks (4 PiB at 1 MiB). */
  const val MAX_CHUNKS = 1L shl 32

  fun chunkCount(length: Long, chunkSize: Int): Long {
    require(length >= 0 && chunkSize > 0)
    return if (length == 0L) 1L else (length + chunkSize - 1) / chunkSize
  }

  /** Plaintext bytes in chunk [index]: [chunkSize] for every chunk but the last. */
  fun chunkLength(index: Long, length: Long, chunkSize: Int): Int {
    val start = index * chunkSize
    return if (start >= length) 0 else minOf(chunkSize.toLong(), length - start).toInt()
  }

  /** The 12-byte GCM nonce of chunk [index]: the file's prefix, then the index big-endian. Unique per chunk. */
  fun nonce(prefix: ByteArray, index: Long): ByteArray {
    require(prefix.size == NONCE_PREFIX_BYTES) { "nonce prefix must be $NONCE_PREFIX_BYTES bytes" }
    require(index in 0 until MAX_CHUNKS) { "chunk index out of range" }
    return ByteBuffer.allocate(NONCE_BYTES).put(prefix).putInt(index.toInt()).array()
  }

  /** What chunk [index] authenticates besides its bytes: format, version, plaintext length, index, last-chunk flag. */
  fun aad(length: Long, index: Long, isFinal: Boolean): ByteArray =
    ByteBuffer.allocate(MAGIC.size + 1 + 8 + 8 + 1)
      .put(MAGIC)
      .put(VERSION.toByte())
      .putLong(length)
      .putLong(index)
      .put(if (isFinal) 1.toByte() else 0.toByte())
      .array()

  fun headerLength(ivLength: Int, wrappedLength: Int): Int =
    MAGIC.size + 1 + 4 + 1 + ivLength + 2 + wrappedLength + NONCE_PREFIX_BYTES + 8

  /** Size of the sealed file for [length] plaintext bytes. */
  fun sealedLength(length: Long, chunkSize: Int, ivLength: Int, wrappedLength: Int): Long =
    headerLength(ivLength, wrappedLength) + length + chunkCount(length, chunkSize) * TAG_BYTES
}

/** Streaming encryption and decryption in the [VaultFormat]; a whole file is never held in memory. */
internal class VaultCrypto(
  private val keys: VaultKeyWrapper,
  private val random: SecureRandom = SecureRandom(),
  private val chunkSize: Int = VaultFormat.CHUNK_SIZE,
) {
  /** SHA-256 and length of the plaintext a pass read or wrote, to compare the two. */
  class Digest(val sha256: ByteArray, val length: Long)

  /**
   * Seals exactly [length] bytes of [input] into [output] (neither is closed) and returns the plaintext's digest.
   * [progress] receives the plaintext bytes done after each chunk.
   */
  fun encrypt(input: InputStream, length: Long, output: OutputStream, progress: (Long) -> Unit = {}): Digest {
    require(length >= 0) { "negative length" }
    val chunks = VaultFormat.chunkCount(length, chunkSize)
    require(chunks <= VaultFormat.MAX_CHUNKS) { "file too large for the vault" }
    val key = ByteArray(VaultFormat.KEY_BYTES).also(random::nextBytes)
    val plain = ByteArray(chunkSize)
    try {
      val wrapped = keys.wrap(key)
      require(wrapped.iv.size in 1..VaultFormat.MAX_IV_BYTES && wrapped.bytes.size in 1..VaultFormat.MAX_WRAPPED_KEY_BYTES)
      val prefix = ByteArray(VaultFormat.NONCE_PREFIX_BYTES).also(random::nextBytes)
      val data = DataOutputStream(output)
      data.write(VaultFormat.MAGIC)
      data.writeByte(VaultFormat.VERSION)
      data.writeInt(chunkSize)
      data.writeByte(wrapped.iv.size)
      data.write(wrapped.iv)
      data.writeShort(wrapped.bytes.size)
      data.write(wrapped.bytes)
      data.write(prefix)
      data.writeLong(length)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val secret = SecretKeySpec(key, "AES")
      val digest = MessageDigest.getInstance("SHA-256")
      val sealed = ByteArray(chunkSize + VaultFormat.TAG_BYTES)
      var done = 0L
      for (index in 0 until chunks) {
        val size = VaultFormat.chunkLength(index, length, chunkSize)
        readFully(input, plain, size)
        digest.update(plain, 0, size)
        cipher.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(VaultFormat.TAG_BITS, VaultFormat.nonce(prefix, index)))
        cipher.updateAAD(VaultFormat.aad(length, index, index == chunks - 1))
        val written = cipher.doFinal(plain, 0, size, sealed, 0)
        data.write(sealed, 0, written)
        done += size
        progress(done)
      }
      data.flush()
      return Digest(digest.digest(), length)
    } finally {
      key.fill(0)
      plain.fill(0)
    }
  }

  /**
   * Opens a sealed [input] and writes the plaintext to [output] (null only verifies). Throws [VaultIntegrityException]
   * when anything fails to authenticate; bytes written before that point must be discarded by the caller.
   */
  fun decrypt(input: InputStream, output: OutputStream?, progress: (Long) -> Unit = {}): Digest {
    val data = DataInputStream(input)
    val header = readHeader(data)
    val key = try {
      keys.unwrap(header.wrapped)
    } catch (e: GeneralSecurityException) {
      throw VaultIntegrityException("The file key could not be opened")
    }
    val plain = ByteArray(header.chunkSize)
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val secret = SecretKeySpec(key, "AES")
      val digest = MessageDigest.getInstance("SHA-256")
      val sealed = ByteArray(header.chunkSize + VaultFormat.TAG_BYTES)
      val chunks = VaultFormat.chunkCount(header.length, header.chunkSize)
      var done = 0L
      for (index in 0 until chunks) {
        val size = VaultFormat.chunkLength(index, header.length, header.chunkSize)
        try {
          data.readFully(sealed, 0, size + VaultFormat.TAG_BYTES)
        } catch (e: EOFException) {
          throw VaultIntegrityException("The file is cut short")
        }
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(VaultFormat.TAG_BITS, VaultFormat.nonce(header.prefix, index)))
        cipher.updateAAD(VaultFormat.aad(header.length, index, index == chunks - 1))
        val opened = try {
          cipher.doFinal(sealed, 0, size + VaultFormat.TAG_BYTES, plain, 0)
        } catch (e: AEADBadTagException) {
          throw VaultIntegrityException("Chunk $index does not authenticate")
        }
        if (opened != size) throw VaultIntegrityException("Chunk $index has the wrong length")
        digest.update(plain, 0, opened)
        output?.write(plain, 0, opened)
        done += opened
        progress(done)
      }
      if (data.read() != -1) throw VaultIntegrityException("The file has bytes after its last chunk")
      output?.flush()
      return Digest(digest.digest(), header.length)
    } finally {
      key.fill(0)
      plain.fill(0)
    }
  }

  private class Header(val chunkSize: Int, val wrapped: WrappedKey, val prefix: ByteArray, val length: Long)

  private fun readHeader(data: DataInputStream): Header = try {
    val magic = ByteArray(VaultFormat.MAGIC.size)
    data.readFully(magic)
    if (!magic.contentEquals(VaultFormat.MAGIC)) throw VaultIntegrityException("Not a vault file")
    if (data.readUnsignedByte() != VaultFormat.VERSION) throw VaultIntegrityException("Unknown vault version")
    val chunkSize = data.readInt()
    if (chunkSize !in VaultFormat.MIN_CHUNK_SIZE..VaultFormat.MAX_CHUNK_SIZE) throw VaultIntegrityException("Bad chunk size")
    val ivLength = data.readUnsignedByte()
    if (ivLength !in 1..VaultFormat.MAX_IV_BYTES) throw VaultIntegrityException("Bad key header")
    val iv = ByteArray(ivLength).also(data::readFully)
    val wrappedLength = data.readUnsignedShort()
    if (wrappedLength !in 1..VaultFormat.MAX_WRAPPED_KEY_BYTES) throw VaultIntegrityException("Bad key header")
    val wrapped = ByteArray(wrappedLength).also(data::readFully)
    val prefix = ByteArray(VaultFormat.NONCE_PREFIX_BYTES).also(data::readFully)
    val length = data.readLong()
    if (length < 0 || VaultFormat.chunkCount(length, chunkSize) > VaultFormat.MAX_CHUNKS) {
      throw VaultIntegrityException("Bad length")
    }
    Header(chunkSize, WrappedKey(iv, wrapped), prefix, length)
  } catch (e: EOFException) {
    throw VaultIntegrityException("The header is cut short")
  }

  private fun readFully(input: InputStream, buffer: ByteArray, size: Int) {
    var read = 0
    while (read < size) {
      val n = input.read(buffer, read, size - read)
      if (n < 0) throw EOFException("The source ended early")
      read += n
    }
  }

  private companion object {
    const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
