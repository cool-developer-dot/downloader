package com.vidorax.media.db

/** Schema of vidorax-media.db (docs/ARCHITECTURE.md section 3.4). */
internal object Schema {
  const val VERSION = 3

  val CREATE: List<String> = listOf(
    // downloads: the v2 engine reads/writes the columns marked ACTIVE below.
    //   ACTIVE:        id, state, kind, url, request_json, title, site, page_url, thumbnail_url, quality_label,
    //                  bytes_done, total_bytes, error_code, error_message, attempts, save_to_gallery,
    //                  created_at, updated_at, file_path,
    //                  variant_json (HLS only: {"videoId": scheme://host/path, "maxHeight": n} — its original
    //                  purpose, the variant choice; never a signed query)
    //   LEGACY/UNUSED: audio_url, manifest_text, next_retry_at — kept for backwards compatibility with
    //                  pre-contract-lock installs; the v2 engine never writes them (they stay NULL). Do not drop
    //                  them (no destructive migration); a future need would add a new column instead.
    """
    CREATE TABLE downloads (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      audio_url TEXT,
      manifest_text TEXT,
      variant_json TEXT,
      request_json TEXT NOT NULL,
      title TEXT NOT NULL,
      site TEXT NOT NULL,
      page_url TEXT,
      thumbnail_url TEXT,
      quality_label TEXT,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER,
      error_code TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      save_to_gallery INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      file_path TEXT
    )
    """,
    "CREATE INDEX downloads_state ON downloads(state)",
    // parts: LEGACY/UNUSED, intentionally dormant (never read or written by v2). HLS needs no segment table:
    // segments are appended to the download's single `.part` in playlist order, and the resume point is a
    // checkpoint file beside that `.part` (work/<id>/hls.checkpoint: segments done, bytes, playlist fingerprint).
    // Segment URLs are never persisted — they carry tokens and are re-read from a fresh playlist on every run.
    """
    CREATE TABLE parts (
      download_id TEXT NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
      track TEXT NOT NULL,
      idx INTEGER NOT NULL,
      url TEXT NOT NULL,
      byte_offset INTEGER,
      byte_length INTEGER,
      key_uri TEXT,
      iv TEXT,
      disc_group INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (download_id, track, idx)
    )
    """,
    """
    CREATE TABLE library (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      site TEXT NOT NULL,
      page_url TEXT,
      source_url TEXT,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      container TEXT NOT NULL,
      video_codec TEXT,
      audio_codec TEXT,
      has_audio INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      size_bytes INTEGER NOT NULL,
      thumb_path TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      gallery_uri TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL
    )
    """,
    "CREATE INDEX library_completed_at ON library(completed_at)",
    "CREATE INDEX library_site ON library(site)",
    COMPLETIONS_TABLE,
  )

  /**
   * Statements that upgrade the previous version to the version they are keyed by. Every [VERSION] bump adds an
   * entry here; fresh installs still run [CREATE], which must always describe the latest schema.
   *
   * v2: adds `downloads.file_path` (nullable) so a download interrupted between finalize and the COMPLETED commit
   * can be recovered at startup by its real final file. Backwards-safe: an ADD COLUMN keeps every existing row and
   * file; no user data is touched.
   */
  val MIGRATIONS: Map<Int, List<String>> = mapOf(
    2 to listOf("ALTER TABLE downloads ADD COLUMN file_path TEXT"),
    // v3: adds the `completions` outbox (a new table; no existing row or file is touched).
    3 to listOf(COMPLETIONS_TABLE),
  )

  /**
   * Genuine completions — a download committed COMPLETED with its verified library item — not yet acknowledged by
   * JavaScript. Written in the same transaction as the COMPLETED state, so a completion that happens while no
   * JavaScript runs (the app closed, a boot job) is still seen once when the app next starts; JavaScript deletes a
   * row once it has counted it (the in-app review policy).
   */
  private const val COMPLETIONS_TABLE =
    "CREATE TABLE completions (download_id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)"
}
