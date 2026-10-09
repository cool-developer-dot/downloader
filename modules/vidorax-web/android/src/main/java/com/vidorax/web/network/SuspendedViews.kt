package com.vidorax.web.network

/**
 * View tags of parked tabs, whose requests are not reported. Not thread-safe (main thread only). Bounded: parked tabs
 * are few (the mount pool keeps two WebViews), and the oldest tags belong to WebViews that are already gone.
 */
internal class SuspendedViews(private val capacity: Int) {
  private val tags = LinkedHashSet<Int>()

  fun set(viewTag: Int, suspended: Boolean) {
    tags.remove(viewTag)
    if (!suspended) return
    tags.add(viewTag)
    while (tags.size > capacity) tags.remove(tags.first())
  }

  operator fun contains(viewTag: Int): Boolean = viewTag in tags
}
