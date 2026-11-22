package com.vidorax.media.archive

/** P8 #407: what `inspectIncomingArchive` / `extractIncomingArchive` answer (src/VidoraMedia.types.ts `ArchiveInspection`). */
internal fun ZipListing.toArchiveJs(): Map<String, Any?> = when (this) {
  is ZipListing.Refused -> mapOf("status" to "refused", "reason" to refusal.wire)
  is ZipListing.Ok -> mapOf(
    "status" to "ok",
    "totalBytes" to totalUncompressed.toDouble(),
    "entries" to entries.take(MAX_LISTED).map {
      mapOf(
        "name" to it.name,
        "sizeBytes" to it.uncompressedSize.toDouble(),
        "kind" to it.kind.wire,
        "readable" to it.readable,
      )
    },
    "entryCount" to entries.size,
    "videoCount" to entries.count { it.kind == ArchiveEntryKind.VIDEO && it.readable },
    "subtitleCount" to entries.count { it.kind == ArchiveEntryKind.SUBTITLE && it.readable },
    "programs" to entries.filter { it.kind == ArchiveEntryKind.PROGRAM }.map { it.baseName }.take(MAX_LISTED),
  )
}

internal fun ArchiveImport.Summary.toArchiveJs(): Map<String, Any?> = mapOf(
  "status" to "extracted",
  "imported" to imported,
  "duplicates" to duplicates,
  "subtitles" to subtitles,
  "disguised" to disguised,
  "failed" to failed,
)

/** The listing JavaScript shows; the counts above always cover every entry. */
private const val MAX_LISTED = 200
