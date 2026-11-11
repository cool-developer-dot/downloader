package com.vidorax.media.engine

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * A user-named download queue (H4, Multiple Queues #343). [QueueOrder.MAIN_ID] ("Main") always exists, is where every
 * download starts, and is never held: with only Main, downloads start exactly as they always did.
 */
data class DownloadQueue(val id: String, val name: String, val held: Boolean = false)

/**
 * The user's start order (H4, Priority #305 / Move Priority #334) and queues (#343), keyed by download id. Immutable:
 * every change makes a new snapshot, so the scheduler reads one consistent view under its own lock.
 *
 * A download that is not in [assignments] is in Main; one that is not in [order] comes after the ordered downloads of
 * its queue, in the existing order (when it began waiting). [DEFAULT] — nothing set — is exactly today's start order.
 */
data class QueueOrderSnapshot(
  /** In the order the engine runs them; always holds Main. */
  val queues: List<DownloadQueue>,
  /** Download id → queue id; only downloads outside Main. */
  val assignments: Map<String, String>,
  /** Download ids in the user's order, all queues together (each queue's order is this list filtered to it). */
  val order: List<String>,
) {
  private val queueRank: Map<String, Int> = queues.withIndex().associate { it.value.id to it.index }
  private val position: Map<String, Int> = order.withIndex().associate { it.value to it.index }
  private val heldQueues: Set<String> = queues.filter { it.held }.map { it.id }.toSet()

  /** Nothing set: the scheduler keeps today's first-come order. */
  val isDefault: Boolean
    get() = queues.size == 1 && heldQueues.isEmpty() && assignments.isEmpty() && order.isEmpty()

  fun queueOf(downloadId: String): String =
    assignments[downloadId]?.takeIf { it in queueRank } ?: QueueOrder.MAIN_ID

  /** True while [downloadId]'s queue is held: it does not start until the queue is resumed. */
  fun isHeld(downloadId: String): Boolean = queueOf(downloadId) in heldQueues

  fun queueRankOf(downloadId: String): Int = queueRank[queueOf(downloadId)] ?: 0

  /** The user's position of [downloadId]; [Int.MAX_VALUE] when it has none (it keeps the existing order). */
  fun positionOf(downloadId: String): Int = position[downloadId] ?: Int.MAX_VALUE

  companion object {
    val DEFAULT = QueueOrderSnapshot(
      queues = listOf(DownloadQueue(QueueOrder.MAIN_ID, QueueOrder.MAIN_NAME)),
      assignments = emptyMap(),
      order = emptyList(),
    )
  }
}

/**
 * The start-order rules (pure) and their persisted form.
 *
 * **Next candidate** ([nextCandidateComparator]): queues in their listed order, then the user's order inside each queue,
 * then the existing order ([Candidate.arrival]: when the download began waiting for a slot). Downloads of a held queue
 * are not candidates ([pickNext] leaves them out). With [QueueOrderSnapshot.DEFAULT] only the arrival counts, which is
 * the engine's first-come order. Reusable as is by other schedulers (F2): build a [Candidate] per waiting download.
 */
object QueueOrder {
  const val MAIN_ID = "main"
  const val MAIN_NAME = "Main"
  const val MAX_QUEUES = 10
  const val MAX_NAME_LENGTH = 40
  /** Bound on stored ids (download ids are UUIDs; anything longer is not one). */
  const val MAX_ID_LENGTH = 64
  /** Bound on ordered downloads, far above any real queue. */
  const val MAX_ORDERED = 2_000

  private val QUEUE_ID = Regex("^[A-Za-z0-9_-]{1,40}$")

  /** A download waiting to start, as a scheduler sees it. Lower [arrival] waited longer. */
  data class Candidate(val downloadId: String, val arrival: Long)

  fun nextCandidateComparator(snapshot: QueueOrderSnapshot): Comparator<Candidate> =
    compareBy<Candidate>({ snapshot.queueRankOf(it.downloadId) }, { snapshot.positionOf(it.downloadId) }, { it.arrival })

  /** The candidate that starts next, or null when none may start now (every one is in a held queue). */
  fun pickNext(candidates: Collection<Candidate>, snapshot: QueueOrderSnapshot): Candidate? =
    candidates.filterNot { snapshot.isHeld(it.downloadId) }.minWithOrNull(nextCandidateComparator(snapshot))

  /**
   * [items] in the order their workers should be started (restore after a restart, Resume all), so the first free
   * slots go to the user's first downloads. Stable; with the default snapshot the list is returned as it is.
   */
  fun <T> inStartOrder(items: List<T>, snapshot: QueueOrderSnapshot, idOf: (T) -> String): List<T> {
    if (snapshot.isDefault) return items
    return items.withIndex()
      .sortedWith(compareBy({ snapshot.queueRankOf(idOf(it.value)) }, { snapshot.positionOf(idOf(it.value)) }, { it.index }))
      .map { it.value }
  }

  fun isQueueId(id: String): Boolean = QUEUE_ID.matches(id)

  private fun isDownloadId(id: String): Boolean = id.isNotBlank() && id.length <= MAX_ID_LENGTH

  /** [ids] first, in that order; downloads ordered before and not in [ids] keep their order after them. */
  fun withOrder(snapshot: QueueOrderSnapshot, ids: List<String>): QueueOrderSnapshot {
    val first = ids.filter(::isDownloadId).distinct()
    val chosen = first.toSet()
    val order = (first + snapshot.order.filterNot { it in chosen }).take(MAX_ORDERED)
    return snapshot.copy(order = order)
  }

  /**
   * Moves [ids] to [queueId], each to the end of that queue's ordered downloads. Throws [IllegalArgumentException] for
   * a queue that does not exist.
   */
  fun withMoved(snapshot: QueueOrderSnapshot, ids: List<String>, queueId: String): QueueOrderSnapshot {
    require(snapshot.queues.any { it.id == queueId }) { "Unknown queue $queueId" }
    val moving = ids.filter(::isDownloadId).distinct()
    val assignments = snapshot.assignments.toMutableMap()
    for (id in moving) {
      if (queueId == MAIN_ID) assignments.remove(id) else assignments[id] = queueId
    }
    val movingSet = moving.toSet()
    val order = (snapshot.order.filterNot { it in movingSet } + moving).take(MAX_ORDERED)
    return snapshot.copy(assignments = assignments, order = order)
  }

  /**
   * The user's queues, in their new order: renamed, held or resumed, added or removed. Main is always kept (at the
   * front when the list leaves it out), keeps its name and is never held. A removed queue's downloads go back to Main.
   * Throws [IllegalArgumentException] for an invalid id or name, a repeated id, or more than [MAX_QUEUES] queues.
   */
  fun withQueues(snapshot: QueueOrderSnapshot, queues: List<DownloadQueue>): QueueOrderSnapshot {
    val cleaned = queues.map { queue ->
      require(isQueueId(queue.id)) { "Invalid queue id" }
      if (queue.id == MAIN_ID) {
        DownloadQueue(MAIN_ID, MAIN_NAME, held = false)
      } else {
        val name = queue.name.trim()
        require(name.isNotEmpty() && name.length <= MAX_NAME_LENGTH) { "A queue name is 1-$MAX_NAME_LENGTH characters" }
        DownloadQueue(queue.id, name, queue.held)
      }
    }
    require(cleaned.map { it.id }.distinct().size == cleaned.size) { "Repeated queue id" }
    val withMain = if (cleaned.any { it.id == MAIN_ID }) cleaned else listOf(DownloadQueue(MAIN_ID, MAIN_NAME)) + cleaned
    require(withMain.size <= MAX_QUEUES) { "At most $MAX_QUEUES queues" }
    val kept = withMain.map { it.id }.toSet()
    return snapshot.copy(queues = withMain, assignments = snapshot.assignments.filterValues { it in kept })
  }

  /** Without [ids]: downloads that finished or were removed leave no trace. */
  fun without(snapshot: QueueOrderSnapshot, ids: Collection<String>): QueueOrderSnapshot {
    if (ids.isEmpty()) return snapshot
    val gone = ids.toSet()
    if (snapshot.order.none { it in gone } && snapshot.assignments.keys.none { it in gone }) return snapshot
    return snapshot.copy(
      assignments = snapshot.assignments.filterKeys { it !in gone },
      order = snapshot.order.filterNot { it in gone },
    )
  }

  /** Only the downloads in [live] keep their queue and position. */
  fun prunedTo(snapshot: QueueOrderSnapshot, live: Collection<String>): QueueOrderSnapshot {
    val keep = live.toSet()
    return without(snapshot, (snapshot.order + snapshot.assignments.keys).filterNot { it in keep })
  }

  fun encode(snapshot: QueueOrderSnapshot): String = JSONObject()
    .put("v", 1)
    .put(
      "queues",
      JSONArray(snapshot.queues.map { JSONObject().put("id", it.id).put("name", it.name).put("held", it.held) }),
    )
    .put("assignments", JSONObject(snapshot.assignments))
    .put("order", JSONArray(snapshot.order))
    .toString()

  /** What was stored, validated again; anything unreadable is [QueueOrderSnapshot.DEFAULT] (today's order). */
  fun decode(json: String?): QueueOrderSnapshot {
    if (json.isNullOrBlank()) return QueueOrderSnapshot.DEFAULT
    return runCatching {
      val root = JSONObject(json)
      val queuesJson = root.optJSONArray("queues") ?: JSONArray()
      val queues = (0 until queuesJson.length()).map { index ->
        val queue = queuesJson.getJSONObject(index)
        DownloadQueue(queue.getString("id"), queue.optString("name"), queue.optBoolean("held", false))
      }
      var snapshot = withQueues(QueueOrderSnapshot.DEFAULT, queues)
      val assignmentsJson = root.optJSONObject("assignments") ?: JSONObject()
      val known = snapshot.queues.map { it.id }.toSet()
      val assignments = assignmentsJson.keys().asSequence()
        .filter(::isDownloadId)
        .mapNotNull { id -> assignmentsJson.optString(id).takeIf { it in known && it != MAIN_ID }?.let { id to it } }
        .toMap()
      val orderJson = root.optJSONArray("order") ?: JSONArray()
      val order = (0 until orderJson.length()).map { orderJson.optString(it) }
      snapshot = snapshot.copy(assignments = assignments)
      withOrder(snapshot, order)
    }.getOrDefault(QueueOrderSnapshot.DEFAULT)
  }
}

/**
 * The live [QueueOrderSnapshot], shared by the engine's API and its slot scheduler. Reads are lock-free (an immutable
 * snapshot); changes are serialized and saved only when they change something — never per progress tick. Today's
 * order (the default) is stored as nothing at all.
 */
internal class QueueOrderBook(private val storage: Storage = Storage.NONE) {
  /** Where the order lives between processes (SharedPreferences in the app, memory in tests). */
  interface Storage {
    fun read(): String?

    /** Null removes what was stored. */
    fun write(json: String?)

    companion object {
      val NONE = object : Storage {
        override fun read(): String? = null

        override fun write(json: String?) = Unit
      }
    }
  }

  @Volatile
  var snapshot: QueueOrderSnapshot = QueueOrder.decode(runCatching { storage.read() }.getOrNull())
    private set

  /** Applies [change]; saves the result when it differs. Exceptions from [change] leave everything as it was. */
  @Synchronized
  fun update(change: (QueueOrderSnapshot) -> QueueOrderSnapshot): QueueOrderSnapshot {
    val before = snapshot
    val after = change(before)
    if (after != before) {
      snapshot = after
      runCatching { storage.write(if (after.isDefault) null else QueueOrder.encode(after)) }
    }
    return after
  }

  fun forget(ids: Collection<String>): QueueOrderSnapshot = update { QueueOrder.without(it, ids) }

  fun pruneTo(live: Collection<String>): QueueOrderSnapshot = update { QueueOrder.prunedTo(it, live) }
}

/** SharedPreferences `vidorax_queue_order`, key `state` (JSON); no key = today's order. */
internal class SharedPreferencesQueueOrderStorage(context: Context) : QueueOrderBook.Storage {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun read(): String? = prefs.getString(KEY, null)

  override fun write(json: String?) {
    val editor = prefs.edit()
    if (json == null) editor.remove(KEY) else editor.putString(KEY, json)
    editor.apply()
  }

  private companion object {
    const val PREFS = "vidorax_queue_order"
    const val KEY = "state"
  }
}
