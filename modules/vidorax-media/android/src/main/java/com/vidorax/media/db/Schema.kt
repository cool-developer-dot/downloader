package com.vidorax.media.db

/** Schema of vidorax-media.db (docs/ARCHITECTURE.md section 3.4). */
internal object Schema {
  const val VERSION = 1

  val CREATE: List<String> = listOf(
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
      updated_at INTEGER NOT NULL
    )
    """,
    "CREATE INDEX downloads_state ON downloads(state)",
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
  )

  /**
   * Statements that upgrade the previous version to the version they are keyed by. Every [VERSION] bump adds an
   * entry here; fresh installs still run [CREATE], which must always describe the latest schema.
   */
  val MIGRATIONS: Map<Int, List<String>> = emptyMap()
}
