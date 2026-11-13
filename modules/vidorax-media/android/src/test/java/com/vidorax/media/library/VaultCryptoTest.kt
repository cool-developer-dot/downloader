package com.vidorax.media.library

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultCryptoTest {
  /** A software stand-in for the Keystore master key (JVM tests have no Android Keystore). */
  private class SoftwareKeys : VaultKeyWrapper {
    private val master: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val random = SecureRandom()

    override fun wrap(key: ByteArray): WrappedKey {
      val iv = ByteArray(12).also(random::nextBytes)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, master, GCMParameterSpec(128, iv))
      return WrappedKey(iv, cipher.doFinal(key))
    }

    override fun unwrap(wrapped: WrappedKey): ByteArray {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, master, GCMParameterSpec(128, wrapped.iv))
      return cipher.doFinal(wrapped.bytes)
    }
  }

  private val keys = SoftwareKeys()
  private val chunk = 64
  private val crypto = VaultCrypto(keys, chunkSize = chunk)

  private fun bytes(size: Int) = ByteArray(size) { (it * 31 + 7).toByte() }

  private fun seal(plain: ByteArray, using: VaultCrypto = crypto): ByteArray {
    val out = ByteArrayOutputStream()
    using.encrypt(ByteArrayInputStream(plain), plain.size.toLong(), out)
    return out.toByteArray()
  }

  private fun open(sealed: ByteArray, using: VaultCrypto = crypto): ByteArray {
    val out = ByteArrayOutputStream()
    using.decrypt(ByteArrayInputStream(sealed), out)
    return out.toByteArray()
  }

  private fun headerLength(sealed: ByteArray): Int {
    val ivLength = sealed[9].toInt() and 0xff
    val wrappedOffset = 10 + ivLength
    val wrappedLength = ((sealed[wrappedOffset].toInt() and 0xff) shl 8) or (sealed[wrappedOffset + 1].toInt() and 0xff)
    return VaultFormat.headerLength(ivLength, wrappedLength)
  }

  @Test
  fun roundTripsEmptyShortExactAndMultiChunkFiles() {
    for (size in listOf(0, 1, chunk - 1, chunk, chunk + 1, chunk * 5 + 3)) {
      val plain = bytes(size)
      val sealed = seal(plain)
      assertArrayEquals("size $size", plain, open(sealed))
      val ivLength = sealed[9].toInt() and 0xff
      assertEquals(VaultFormat.sealedLength(size.toLong(), chunk, ivLength, 48), sealed.size.toLong())
    }
  }

  @Test
  fun digestsOfBothPassesMatchTheSource() {
    val plain = bytes(chunk * 3 + 9)
    val sealedOut = ByteArrayOutputStream()
    val written = crypto.encrypt(ByteArrayInputStream(plain), plain.size.toLong(), sealedOut)
    val read = crypto.decrypt(ByteArrayInputStream(sealedOut.toByteArray()), null)
    val expected = MessageDigest.getInstance("SHA-256").digest(plain)
    assertArrayEquals(expected, written.sha256)
    assertArrayEquals(expected, read.sha256)
    assertEquals(plain.size.toLong(), read.length)
  }

  @Test
  fun aChangedByteFailsAuthentication() {
    val sealed = seal(bytes(chunk * 2))
    val tampered = sealed.copyOf().also { it[headerLength(sealed) + 5] = (it[headerLength(sealed) + 5] + 1).toByte() }
    assertThrows(VaultIntegrityException::class.java) { open(tampered) }
  }

  @Test
  fun droppingTheLastChunkIsDetected() {
    val sealed = seal(bytes(chunk * 3))
    val cut = sealed.copyOf(sealed.size - (chunk + VaultFormat.TAG_BYTES))
    assertThrows(VaultIntegrityException::class.java) { open(cut) }
  }

  @Test
  fun swappingTwoChunksIsDetected() {
    val sealed = seal(bytes(chunk * 3))
    val header = headerLength(sealed)
    val sealedChunk = chunk + VaultFormat.TAG_BYTES
    val swapped = sealed.copyOf()
    System.arraycopy(sealed, header, swapped, header + sealedChunk, sealedChunk)
    System.arraycopy(sealed, header + sealedChunk, swapped, header, sealedChunk)
    assertThrows(VaultIntegrityException::class.java) { open(swapped) }
  }

  @Test
  fun extraBytesAfterTheLastChunkAreDetected() {
    val sealed = seal(bytes(chunk + 1))
    assertThrows(VaultIntegrityException::class.java) { open(sealed + byteArrayOf(1, 2, 3)) }
  }

  @Test
  fun aChangedLengthInTheHeaderIsDetected() {
    val sealed = seal(bytes(chunk * 2))
    val lengthOffset = headerLength(sealed) - 8
    val changed = sealed.copyOf().also { it[lengthOffset + 7] = (it[lengthOffset + 7] - 1).toByte() }
    assertThrows(VaultIntegrityException::class.java) { open(changed) }
  }

  @Test
  fun anotherMasterKeyCannotOpenTheFile() {
    val sealed = seal(bytes(10))
    val stranger = VaultCrypto(SoftwareKeys(), chunkSize = chunk)
    assertThrows(VaultIntegrityException::class.java) { open(sealed, stranger) }
  }

  @Test
  fun notAVaultFileIsRefused() {
    assertThrows(VaultIntegrityException::class.java) { open(byteArrayOf(1, 2, 3, 4, 5)) }
    assertThrows(VaultIntegrityException::class.java) { open(ByteArray(0)) }
  }

  @Test
  fun sealingTheSameBytesTwiceGivesDifferentFiles() {
    val plain = bytes(chunk)
    assertNotEquals(seal(plain).toList(), seal(plain).toList())
  }

  @Test
  fun chunkMath() {
    assertEquals(1L, VaultFormat.chunkCount(0, 1 shl 20))
    assertEquals(1L, VaultFormat.chunkCount(1, 1 shl 20))
    assertEquals(1L, VaultFormat.chunkCount(1L shl 20, 1 shl 20))
    assertEquals(2L, VaultFormat.chunkCount((1L shl 20) + 1, 1 shl 20))
    assertEquals(1 shl 20, VaultFormat.chunkLength(0, (1L shl 20) + 1, 1 shl 20))
    assertEquals(1, VaultFormat.chunkLength(1, (1L shl 20) + 1, 1 shl 20))
    assertEquals(0, VaultFormat.chunkLength(0, 0, 1 shl 20))
  }

  @Test
  fun noncesAreUniquePerChunkAndCarryTheIndex() {
    val prefix = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0), VaultFormat.nonce(prefix, 0))
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 1, 2), VaultFormat.nonce(prefix, 258))
    assertArrayEquals(
      byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, -1, -1, -1, -1),
      VaultFormat.nonce(prefix, VaultFormat.MAX_CHUNKS - 1),
    )
    val seen = (0L until 1000L).map { VaultFormat.nonce(prefix, it).toList() }.toSet()
    assertEquals(1000, seen.size)
  }

  @Test
  fun aadBindsLengthIndexAndTheLastChunk() {
    val aad = VaultFormat.aad(length = 300, index = 2, isFinal = true)
    assertArrayEquals(
      byteArrayOf(0x56, 0x58, 0x56, 0x31, 1, 0, 0, 0, 0, 0, 0, 1, 44, 0, 0, 0, 0, 0, 0, 0, 2, 1),
      aad,
    )
    assertNotEquals(aad.toList(), VaultFormat.aad(300, 2, isFinal = false).toList())
  }
}
