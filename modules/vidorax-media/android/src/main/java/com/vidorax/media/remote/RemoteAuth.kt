package com.vidorax.media.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** A browser, extension or CLI paired with this phone. Only a hash of its token is kept. */
data class PairedClient(
  val id: String,
  val name: String,
  val tokenHash: String,
  val createdAt: Long,
  val lastSeenAt: Long,
)

interface PairedClientStorage {
  fun load(): List<PairedClient>

  fun save(clients: List<PairedClient>)
}

class InMemoryPairedClientStorage(initial: List<PairedClient> = emptyList()) : PairedClientStorage {
  @Volatile var saved: List<PairedClient> = initial
    private set

  var saves = 0
    private set

  override fun load(): List<PairedClient> = saved

  override fun save(clients: List<PairedClient>) {
    saved = clients
    saves += 1
  }
}

/** SharedPreferences `vidorax_remote`, key `paired_clients`: id, name, token hash and times — never a token. */
class SharedPreferencesPairedClientStorage(context: Context) : PairedClientStorage {
  private val prefs = context.applicationContext.getSharedPreferences(RemotePrefs.FILE, Context.MODE_PRIVATE)

  override fun load(): List<PairedClient> {
    val raw = prefs.getString(KEY, null) ?: return emptyList()
    return runCatching {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        PairedClient(
          id = item.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null,
          name = item.optString("name"),
          tokenHash = item.optString("tokenHash").takeIf { it.length == 64 } ?: return@mapNotNull null,
          createdAt = item.optLong("createdAt"),
          lastSeenAt = item.optLong("lastSeenAt"),
        )
      }
    }.getOrDefault(emptyList())
  }

  override fun save(clients: List<PairedClient>) {
    val array = JSONArray()
    clients.forEach { client ->
      array.put(
        JSONObject()
          .put("id", client.id)
          .put("name", client.name)
          .put("tokenHash", client.tokenHash)
          .put("createdAt", client.createdAt)
          .put("lastSeenAt", client.lastSeenAt),
      )
    }
    prefs.edit().putString(KEY, array.toString()).apply()
  }

  private companion object {
    const val KEY = "paired_clients"
  }
}

/**
 * P6 pairing and tokens. The phone shows a 6-digit PIN while Remote control runs; a browser (or the extension, or
 * the CLI) that sends it gets a random 256-bit token, kept by the phone only as a SHA-256 hash.
 *
 * Wrong PINs are rate limited for everyone at once: after [ATTEMPTS_PER_LOCK] wrong PINs pairing is locked for
 * [BASE_LOCK_MS], doubling with each further lock (at most [MAX_LOCK_MS]); after [MAX_FAILURES_PER_PIN] wrong PINs
 * the PIN is withdrawn until the user asks the phone for a new one. Guessing one PIN in a million with 15 tries is a
 * 1-in-66,000 chance, and the user sees the lock on the phone.
 */
class RemoteAuth(
  private val storage: PairedClientStorage,
  private val clock: () -> Long = System::currentTimeMillis,
  private val random: SecureRandom = SecureRandom(),
  /** Pairing, a lock, a new PIN or a forgotten client: the phone's Remote control screen shows it. */
  var onChange: () -> Unit = {},
) {
  sealed class PairResult {
    data class Paired(val token: String, val client: PairedClient) : PairResult()

    data class WrongPin(val attemptsLeft: Int) : PairResult()

    data class Locked(val retryAfterMs: Long) : PairResult()

    /** No PIN is offered: Remote control was just turned on elsewhere, or too many wrong PINs. */
    object Closed : PairResult()
  }

  data class PinState(val pin: String?, val lockedUntil: Long?, val closedByFailures: Boolean)

  private var clients: MutableList<PairedClient> = storage.load().toMutableList()
  private var pin: String? = null
  private var failuresSinceLock = 0
  private var failuresForPin = 0
  private var locks = 0
  private var lockedUntil = 0L
  private var closedByFailures = false
  private val lastSaved = HashMap<String, Long>()

  init {
    synchronized(this) { dropExpired(clock()) }
  }

  /** A fresh PIN; clears the lock and the wrong-PIN count. */
  @Synchronized
  fun newPin(): String {
    val next = String.format(java.util.Locale.ROOT, "%06d", random.nextInt(1_000_000))
    pin = next
    failuresSinceLock = 0
    failuresForPin = 0
    locks = 0
    lockedUntil = 0L
    closedByFailures = false
    onChange()
    return next
  }

  /** Pairing ends with the server; tokens already issued stay valid. */
  @Synchronized
  fun closePairing() {
    pin = null
    lockedUntil = 0L
  }

  @Synchronized
  fun pinState(): PinState {
    val now = clock()
    return PinState(pin, lockedUntil.takeIf { it > now }, closedByFailures)
  }

  fun pair(candidate: String, name: String): PairResult = synchronized(this) { pairLocked(candidate, name) }
    .also { onChange() }

  private fun pairLocked(candidate: String, name: String): PairResult {
    val current = pin ?: return PairResult.Closed
    val now = clock()
    if (lockedUntil > now) return PairResult.Locked(lockedUntil - now)
    val digits = candidate.trim()
    if (!MessageDigest.isEqual(digits.toByteArray(Charsets.UTF_8), current.toByteArray(Charsets.UTF_8))) {
      failuresSinceLock += 1
      failuresForPin += 1
      if (failuresForPin >= MAX_FAILURES_PER_PIN) {
        pin = null
        closedByFailures = true
        return PairResult.Closed
      }
      if (failuresSinceLock >= ATTEMPTS_PER_LOCK) {
        failuresSinceLock = 0
        locks += 1
        val lockMs = (BASE_LOCK_MS shl (locks - 1).coerceAtMost(10)).coerceAtMost(MAX_LOCK_MS)
        lockedUntil = now + lockMs
        return PairResult.Locked(lockMs)
      }
      return PairResult.WrongPin(ATTEMPTS_PER_LOCK - failuresSinceLock)
    }
    failuresSinceLock = 0
    val token = newToken()
    val client = PairedClient(
      id = newId(),
      name = cleanName(name),
      tokenHash = hash(token),
      createdAt = now,
      lastSeenAt = now,
    )
    dropExpired(now)
    while (clients.size >= MAX_CLIENTS) {
      clients.minByOrNull { it.lastSeenAt }?.let { clients.remove(it) }
    }
    clients.add(client)
    lastSaved[client.id] = now
    storage.save(clients.toList())
    return PairResult.Paired(token, client)
  }

  /** The paired client [token] belongs to, or null. Seen-times are saved at most once a minute per client. */
  @Synchronized
  fun authenticate(token: String?): PairedClient? {
    if (token == null || !TOKEN_PATTERN.matches(token)) return null
    val tokenHash = hash(token)
    val index = clients.indexOfFirst { MessageDigest.isEqual(it.tokenHash.toByteArray(), tokenHash.toByteArray()) }
    if (index < 0) return null
    val now = clock()
    if (now - clients[index].lastSeenAt > CLIENT_EXPIRY_MS) {
      clients.removeAt(index)
      storage.save(clients.toList())
      return null
    }
    val seen = clients[index].copy(lastSeenAt = now)
    clients[index] = seen
    if (now - (lastSaved[seen.id] ?: 0L) >= SEEN_SAVE_INTERVAL_MS) {
      lastSaved[seen.id] = now
      storage.save(clients.toList())
    }
    return seen
  }

  @Synchronized
  fun clients(): List<PairedClient> = clients.sortedByDescending { it.lastSeenAt }

  @Synchronized
  fun forget(id: String): Boolean {
    val removed = clients.removeAll { it.id == id }
    if (removed) {
      storage.save(clients.toList())
      onChange()
    }
    return removed
  }

  @Synchronized
  fun forgetAll() {
    clients.clear()
    storage.save(emptyList())
    onChange()
  }

  private fun dropExpired(now: Long) {
    if (clients.removeAll { now - it.lastSeenAt > CLIENT_EXPIRY_MS }) storage.save(clients.toList())
  }

  private fun newToken(): String {
    val bytes = ByteArray(32)
    random.nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
  }

  private fun newId(): String {
    val bytes = ByteArray(8)
    random.nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  companion object {
    const val ATTEMPTS_PER_LOCK = 5
    const val MAX_FAILURES_PER_PIN = 15
    const val BASE_LOCK_MS = 30_000L
    const val MAX_LOCK_MS = 15L * 60 * 1000
    const val MAX_CLIENTS = 10
    const val CLIENT_EXPIRY_MS = 90L * 24 * 60 * 60 * 1000
    const val SEEN_SAVE_INTERVAL_MS = 60_000L
    const val MAX_NAME_LENGTH = 60

    private val TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")

    fun hash(token: String): String =
      MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** What the phone lists the client as: printable, at most [MAX_NAME_LENGTH] characters. */
    fun cleanName(name: String): String {
      val printable = name.filter { !it.isISOControl() }.trim().take(MAX_NAME_LENGTH)
      return printable.ifEmpty { "Browser" }
    }
  }
}

/** The SharedPreferences file every P6 piece keeps its state in. */
object RemotePrefs {
  const val FILE = "vidorax_remote"
}
