package com.vidorax.media.bridge

import com.vidorax.media.InvalidRequestException
import com.vidorax.media.engine.DownloadQueue
import com.vidorax.media.engine.QueueOrder
import com.vidorax.media.engine.QueueOrderSnapshot
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// H4: `DownloadQueue` / `DownloadQueueState` of src/VidoraMedia.types.ts.

data class DownloadQueueRecord(
  @Field val id: String = "",
  @Field val name: String = "",
  @Field val held: Boolean = false,
) : Record {
  /** Shape only; the engine checks the whole list (names, repeats, the limit) and keeps Main. */
  fun toModel(): DownloadQueue {
    if (!QueueOrder.isQueueId(id)) throw InvalidRequestException("Invalid queue id")
    return DownloadQueue(id, name, held)
  }
}

internal fun QueueOrderSnapshot.toJs(): Map<String, Any?> = mapOf(
  "queues" to queues.map { mapOf("id" to it.id, "name" to it.name, "held" to it.held) },
  "assignments" to assignments,
  "order" to order,
)
