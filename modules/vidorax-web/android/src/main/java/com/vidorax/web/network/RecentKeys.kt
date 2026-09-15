package com.vidorax.web.network

/** Keys added within the last [windowMs]. Not thread-safe; times passed to [add] must never decrease. */
internal class RecentKeys(private val windowMs: Long) {
  // Insertion order is time order because times never decrease, so expired keys are always at the front.
  private val addedAt = LinkedHashMap<String, Long>()

  /** Adds [key] and returns true, or returns false when it was already added less than [windowMs] before [now]. */
  fun add(key: String, now: Long): Boolean {
    val iterator = addedAt.values.iterator()
    while (iterator.hasNext()) {
      if (now - iterator.next() < windowMs) break
      iterator.remove()
    }
    if (key in addedAt) return false
    addedAt[key] = now
    return true
  }
}
