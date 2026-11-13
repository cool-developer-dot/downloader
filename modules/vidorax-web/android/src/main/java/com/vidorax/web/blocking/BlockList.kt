package com.vidorax.web.blocking

import java.util.Locale

/**
 * B14 — one bundled block list (assets/vidorax-blocklists, built by scripts/dev/generate-blocklists.mjs from
 * EasyList / EasyPrivacy). Each rule is a host (that host and every subdomain) or a host with a path prefix. Lookups
 * walk the request host's parents (`a.b.example.com` → `b.example.com` → `example.com`), so a request costs a handful
 * of hash lookups. Immutable once built; read from WebView network threads.
 */
internal class BlockList private constructor(
  private val hosts: Set<String>,
  private val pathPrefixes: Map<String, Array<String>>,
) {
  val size: Int = hosts.size + pathPrefixes.values.sumOf { it.size }

  /** Whether [host] (lowercase) with [pathAndQuery] (starting with `/`) matches a rule. */
  fun matches(host: String, pathAndQuery: String): Boolean {
    var suffix = host
    while (true) {
      if (suffix in hosts) return true
      val prefixes = pathPrefixes[suffix]
      if (prefixes != null && prefixes.any { pathAndQuery.startsWith(it) }) return true
      val dot = suffix.indexOf('.')
      // Stop before the last label (a bare TLD is never a rule).
      if (dot < 0 || suffix.indexOf('.', dot + 1) < 0) return false
      suffix = suffix.substring(dot + 1)
    }
  }

  companion object {
    val EMPTY = BlockList(emptySet(), emptyMap())

    /** Parses list lines: `#` comments and blank lines skipped; `host` or `host/path-prefix`. */
    fun parse(lines: Sequence<String>): BlockList {
      val hosts = HashSet<String>()
      val paths = HashMap<String, MutableList<String>>()
      for (raw in lines) {
        val line = raw.trim()
        if (line.isEmpty() || line.startsWith('#')) continue
        val slash = line.indexOf('/')
        if (slash < 0) {
          hosts += line.lowercase(Locale.ROOT)
        } else if (slash > 0 && slash < line.length - 1) {
          paths.getOrPut(line.substring(0, slash).lowercase(Locale.ROOT)) { ArrayList(1) } += line.substring(slash)
        }
      }
      return BlockList(hosts, paths.mapValues { it.value.toTypedArray() })
    }
  }
}
