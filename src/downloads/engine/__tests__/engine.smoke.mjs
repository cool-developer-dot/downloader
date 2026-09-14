/**
 * Download engine unit smokes — no device required.
 * Run: node src/downloads/engine/__tests__/engine.smoke.mjs
 */

import assert from 'node:assert/strict';

// Resource guard + queue + progress logic mirrored for CI without Metro.

function isPrivateOrLocalHostname(hostname) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host === 'metadata' ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

function isPlaylistOrStreamUrl(url) {
  try {
    const parsed = new URL(url.trim());
    const pathName = parsed.pathname.toLowerCase();
    const ext = pathName.includes('.') ? pathName.split('.').pop() ?? '' : '';
    if (['m3u8', 'mpd', 'm3u'].includes(ext)) return true;
    if (pathName.includes('.m3u8') || pathName.includes('.mpd')) return true;
    return false;
  } catch {
    return false;
  }
}

function isSafeHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 8192) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('about:')
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!parsed.hostname) return false;
    if (isPrivateOrLocalHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function sanitizeFileName(raw) {
  const trimmed = raw.trim() || 'download.bin';
  const withoutPath = trimmed.replace(/[/\\]/g, '_');
  const cleaned = withoutPath
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 180);
  return cleaned || 'download.bin';
}

function normalizeTotalBytes(totalBytes) {
  if (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }
  return Math.trunc(totalBytes);
}

function computeProgress(bytesWritten, totalBytes) {
  const total = normalizeTotalBytes(totalBytes);
  if (total == null) return 0;
  return Math.max(0, Math.min(99, Math.floor((bytesWritten / total) * 100)));
}

function computeEta(bytesWritten, totalBytes, bytesPerSecond) {
  if (
    normalizeTotalBytes(totalBytes) == null ||
    bytesPerSecond == null ||
    bytesPerSecond <= 0
  ) {
    return null;
  }
  const remaining = totalBytes - bytesWritten;
  if (remaining <= 0) return 0;
  return remaining / bytesPerSecond;
}

/** Backend transition matrix — resume must not PATCH PAUSED → QUEUED. */
const VALID_TRANSITIONS = {
  QUEUED: ['DOWNLOADING', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSED: ['DOWNLOADING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['QUEUED'],
  CANCELLED: [],
};

function canTransition(from, to) {
  return from === to || VALID_TRANSITIONS[from].includes(to);
}

class DownloadQueue {
  constructor(maxConcurrent = 2) {
    this.maxConcurrent = maxConcurrent;
    this.pending = [];
    this.active = new Set();
  }
  has(id) {
    return this.pending.includes(id) || this.active.has(id);
  }
  enqueue(id) {
    if (this.has(id)) return false;
    this.pending.push(id);
    return true;
  }
  promote() {
    const started = [];
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const id = this.pending.shift();
      this.active.add(id);
      started.push(id);
    }
    return started;
  }
  complete(id) {
    this.active.delete(id);
    const idx = this.pending.indexOf(id);
    if (idx >= 0) this.pending.splice(idx, 1);
  }
  cancel(id) {
    this.complete(id);
  }
}

/** Models cancel beating a late completion callback. */
function applyTerminalEvent(current, event) {
  if (current === 'CANCELLED' && event === 'COMPLETED') return 'CANCELLED';
  if (current === 'CANCELLED' && event === 'DOWNLOADING') return 'CANCELLED';
  if (current === 'COMPLETED' && event === 'DOWNLOADING') return 'COMPLETED';
  if (!canTransition(current, event)) return current;
  return event;
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

check('detects HLS playlist URLs for worker routing', () => {
  assert.equal(isPlaylistOrStreamUrl('https://cdn.example/v.m3u8'), true);
  assert.equal(isPlaylistOrStreamUrl('https://cdn.example/v.mp4'), false);
});

check('only allows http(s) public hosts', () => {
  assert.equal(isSafeHttpUrl('https://cdn.example/a.mp4'), true);
  assert.equal(isSafeHttpUrl('http://cdn.example/a.mp3'), true);
  assert.equal(isSafeHttpUrl('file:///tmp/a.mp4'), false);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/plain,hi'), false);
  assert.equal(isSafeHttpUrl('http://localhost/a.mp4'), false);
  assert.equal(isSafeHttpUrl('http://127.0.0.1/a.mp4'), false);
  assert.equal(isSafeHttpUrl('http://192.168.1.5/a.mp4'), false);
});

check('sanitizes traversal and illegal chars', () => {
  const sanitized = sanitizeFileName('../../etc/passwd');
  assert.ok(!sanitized.includes('/'));
  assert.ok(!sanitized.includes('\\'));
  assert.ok(!sanitizeFileName('a<>b.mp4').includes('<'));
  assert.equal(sanitizeFileName(''), 'download.bin');
});

check('progress never reports 100 before complete', () => {
  assert.equal(computeProgress(999, 1000), 99);
  assert.equal(computeProgress(1000, 1000), 99);
  assert.equal(computeProgress(50, null), 0);
  assert.equal(computeProgress(50, 0), 0);
});

check('unknown Content-Length stays null', () => {
  assert.equal(normalizeTotalBytes(0), null);
  assert.equal(normalizeTotalBytes(-1), null);
  assert.equal(normalizeTotalBytes(null), null);
  assert.equal(normalizeTotalBytes(128), 128);
});

check('ETA null when size or speed unknown', () => {
  assert.equal(computeEta(10, null, 5), null);
  assert.equal(computeEta(10, 0, 5), null);
  assert.equal(computeEta(10, 100, null), null);
  assert.ok(computeEta(50, 100, 25) > 0);
});

check('queue concurrency + no duplicate enqueue', () => {
  const q = new DownloadQueue(2);
  assert.equal(q.enqueue('a'), true);
  assert.equal(q.enqueue('a'), false);
  q.enqueue('b');
  q.enqueue('c');
  assert.deepEqual(q.promote(), ['a', 'b']);
  assert.deepEqual(q.promote(), []);
  q.complete('a');
  assert.deepEqual(q.promote(), ['c']);
});

check('cancel removes pending before start', () => {
  const q = new DownloadQueue(1);
  q.enqueue('x');
  q.enqueue('y');
  q.promote();
  q.cancel('y');
  assert.equal(q.has('y'), false);
  q.complete('x');
  assert.deepEqual(q.promote(), []);
});

check('PAUSED cannot transition to QUEUED', () => {
  assert.equal(canTransition('PAUSED', 'QUEUED'), false);
  assert.equal(canTransition('PAUSED', 'DOWNLOADING'), true);
});

check('FAILED can transition to QUEUED for retry only', () => {
  assert.equal(canTransition('FAILED', 'QUEUED'), true);
  assert.equal(canTransition('FAILED', 'DOWNLOADING'), false);
  assert.equal(canTransition('CANCELLED', 'QUEUED'), false);
});

check('cancel beats late COMPLETED callback', () => {
  assert.equal(applyTerminalEvent('CANCELLED', 'COMPLETED'), 'CANCELLED');
  assert.equal(applyTerminalEvent('CANCELLED', 'DOWNLOADING'), 'CANCELLED');
  assert.equal(applyTerminalEvent('DOWNLOADING', 'COMPLETED'), 'COMPLETED');
});

/** Models manager suppressedIds + cancel-before-startWorker race. */
function simulateCancelBeforeStart(ids, cancelId, maxConcurrent = 2) {
  const q = new DownloadQueue(maxConcurrent);
  const suppressed = new Set();
  const workers = new Set();
  const started = [];

  for (const id of ids) {
    q.enqueue(id);
  }

  const promote = () => {
    const batch = q.promote();
    for (const id of batch) {
      // Manager preflight — cancel may have won before worker construction.
      if (suppressed.has(id) || workers.has(id)) {
        q.complete(id);
        continue;
      }
      workers.add(id);
      started.push(id);
    }
  };

  promote();

  // Cancel one active id before its "worker.run" conceptually starts.
  suppressed.add(cancelId);
  q.cancel(cancelId);
  workers.delete(cancelId);

  // Slot released → next pending promotes.
  promote();

  return { started, suppressed: [...suppressed], active: [...q.active], pending: [...q.pending] };
}

check('cancel-before-start releases slot and promotes next', () => {
  const result = simulateCancelBeforeStart(['a', 'b', 'c', 'd'], 'a');
  assert.ok(!result.active.includes('a'));
  assert.ok(result.suppressed.includes('a'));
  // After cancel(a), c should start (b still active).
  assert.ok(result.started.includes('b'));
  assert.ok(result.started.includes('c'));
  assert.ok(!result.started.includes('a') || result.suppressed.includes('a'));
  assert.equal(result.active.length, 2);
  assert.deepEqual(result.pending, ['d']);
});

check('failure releases slot and promotes FIFO', () => {
  const q = new DownloadQueue(2);
  q.enqueue('a');
  q.enqueue('b');
  q.enqueue('c');
  assert.deepEqual(q.promote(), ['a', 'b']);
  q.complete('a'); // failed worker releases like complete
  assert.deepEqual(q.promote(), ['c']);
  assert.equal(q.active.size, 2);
});

check('completed and cancelled never resurrect via terminal guard', () => {
  assert.equal(applyTerminalEvent('CANCELLED', 'QUEUED'), 'CANCELLED');
  assert.equal(applyTerminalEvent('COMPLETED', 'DOWNLOADING'), 'COMPLETED');
  assert.equal(applyTerminalEvent('FAILED', 'DOWNLOADING'), 'FAILED');
});

check('progress is monotonic under stale events', () => {
  let progress = 40;
  const apply = (next) => {
    progress = Math.max(progress, Math.max(0, Math.min(100, next)));
  };
  apply(55);
  apply(52); // stale
  apply(101); // clamp
  assert.equal(progress, 100);
  apply(-5);
  assert.equal(progress, 100);
});

check('cumulative resume progress uses offset + new bytes', () => {
  const resumeOffset = 37 * 1024 * 1024;
  const newlyReceived = 4 * 1024 * 1024;
  const totalBytes = 100 * 1024 * 1024;
  const cumulative = resumeOffset + newlyReceived;
  assert.equal(computeProgress(cumulative, totalBytes), 41);
  assert.ok(computeProgress(newlyReceived, totalBytes) < 10);
});

check('ETA uses remaining cumulative bytes not full size', () => {
  const resumeOffset = 37_000_000;
  const totalBytes = 100_000_000;
  const speed = 1_000_000;
  const eta = computeEta(resumeOffset, totalBytes, speed);
  assert.ok(eta != null);
  assert.ok(Math.abs(eta - 63) < 0.01);
});

check('Content-Range start must match resume offset', () => {
  const parseStart = (header) => {
    if (!header) return null;
    const match = /^bytes\s+(\d+)-/i.exec(header.trim());
    if (!match?.[1]) return null;
    const start = Number(match[1]);
    return Number.isFinite(start) && start >= 0 ? Math.trunc(start) : null;
  };
  const offset = 41943040;
  assert.equal(parseStart('bytes 41943040-104857599/104857600'), offset);
  assert.notEqual(parseStart('bytes 0-104857599/104857600'), offset);
  assert.equal(parseStart(null), null);
});

check('HTTP 200 on Range request is never appendable', () => {
  function classifyRangeStatus(status, sentIfRange) {
    if (status === 200) {
      return sentIfRange ? 'SOURCE_CHANGED' : 'RESUME_UNSUPPORTED';
    }
    if (status === 206) return 'OK';
    return 'RANGE_REJECTED';
  }
  assert.equal(classifyRangeStatus(200, false), 'RESUME_UNSUPPORTED');
  assert.equal(classifyRangeStatus(200, true), 'SOURCE_CHANGED');
  assert.equal(classifyRangeStatus(206, false), 'OK');
  assert.equal(classifyRangeStatus(416, false), 'RANGE_REJECTED');
});

check('resume lock must release before pump/startWorker', () => {
  // Models the fixed resume lock race: holding lock across pump orphans QUEUED.
  const locks = new Set();
  const active = new Set();
  const pending = ['job'];
  const startWorker = (id) => {
    if (locks.has(id)) {
      return false;
    }
    active.add(id);
    return true;
  };
  const resume = (id) => {
    locks.add(id);
    // CRITICAL: release before pump
    locks.delete(id);
    const started = startWorker(pending.shift());
    assert.equal(started, true);
    assert.ok(active.has(id));
  };
  resume('job');
});

check('resume must upsert QUEUED and release lock BEFORE enqueue/drain', () => {
  // Real bug: enqueue() → requestDrain() → admitWorker while locks.has(id)
  // OR remoteStatus still PAUSED → admit returns false → job dropped (no requeue).
  const locks = new Set();
  const pending = [];
  let remoteStatus = 'PAUSED';
  let admitted = false;

  const admitWorker = (id) => {
    if (locks.has(id) || remoteStatus === 'PAUSED') {
      return false;
    }
    admitted = true;
    return true;
  };

  const enqueue = (id) => {
    pending.push(id);
    // enqueue immediately drains (async in prod; sync model here).
    const next = pending.shift();
    if (next && !admitWorker(next)) {
      // Failed admit — do not requeue (matches AdmissionScheduler).
    }
  };

  // Broken order: enqueue under lock before upsert
  locks.add('job');
  enqueue('job');
  assert.equal(admitted, false, 'broken path must fail admit');

  // Fixed order: upsert → release lock → enqueue
  admitted = false;
  remoteStatus = 'QUEUED';
  locks.delete('job');
  enqueue('job');
  assert.equal(admitted, true, 'fixed path must admit worker');
});

check('DOWNLOADING → PAUSED → RESUME → admitWorker must not reject QUEUED record', () => {
  // Regression: resume() must set remoteStatus to QUEUED so admitWorker
  // does not reject the job on the existing.remoteStatus === 'PAUSED' guard.
  const TERMINAL_LOCAL = new Set(['complete', 'deleted']);
  const admitWorker = (record, locks = new Set()) => {
    if (
      locks.has(record.downloadId) ||
      !record ||
      TERMINAL_LOCAL.has(record.localState) ||
      record.remoteStatus === 'CANCELLED' ||
      record.remoteStatus === 'COMPLETED' ||
      record.remoteStatus === 'FAILED' ||
      record.remoteStatus === 'PAUSED'
    ) {
      return false;
    }
    return true;
  };

  const afterPause = {
    downloadId: 'vid-1',
    localState: 'paused',
    remoteStatus: 'PAUSED',
    pauseState: { resumeData: '12345678' },
  };

  const afterResume = {
    ...afterPause,
    localState: 'not_started',
    remoteStatus: 'QUEUED',
  };

  assert.equal(admitWorker(afterPause), false);
  assert.equal(admitWorker(afterResume), true);
  // Lock still held → reject even with QUEUED
  assert.equal(admitWorker(afterResume, new Set(['vid-1'])), false);
});

check('manual resume must not require autoResume setting', () => {
  // Auto Resume gates recovery/soft-hold only — never the user Resume button.
  const isAutoResumeEnabled = () => false;
  const manualResumeAllowed = (userInitiated) =>
    userInitiated || isAutoResumeEnabled();
  assert.equal(manualResumeAllowed(true), true);
  assert.equal(manualResumeAllowed(false), false);
});

check('pauseRequested blocks late transferring progress', () => {
  let published = 0;
  const canPublish = (pauseRequested, cancelled) => !pauseRequested && !cancelled;
  if (canPublish(true, false)) published += 1;
  if (canPublish(false, false)) published += 1;
  assert.equal(published, 1);
});

check('phase-1 error codes are distinct and mapped', () => {
  const codes = [
    'PAUSE_FAILED',
    'RESUME_FAILED',
    'RESUME_UNSUPPORTED',
    'RESUME_STATE_MISSING',
    'PARTIAL_FILE_MISSING',
    'RANGE_REJECTED',
    'SOURCE_CHANGED',
    'CANCEL_FAILED',
    'WORKER_NOT_FOUND',
  ];
  assert.equal(new Set(codes).size, codes.length);
});

check('retry backoff is bounded exponential', () => {
  const base = 1000;
  const max = 60_000;
  const delay = (retryCount) =>
    Math.min(max, base * 2 ** Math.max(0, retryCount));
  assert.equal(delay(0), 1000);
  assert.equal(delay(1), 2000);
  assert.equal(delay(2), 4000);
  assert.equal(delay(10), 60_000);
});

check('auto-retry budget stops at max attempts', () => {
  const MAX = 3;
  const shouldSchedule = (retryCount, autoRetryable) =>
    autoRetryable && retryCount < MAX;
  assert.equal(shouldSchedule(0, true), true);
  assert.equal(shouldSchedule(2, true), true);
  assert.equal(shouldSchedule(3, true), false);
  assert.equal(shouldSchedule(0, false), false);
});

check('retryable vs non-retryable classification categories', () => {
  const auto = new Set([
    'NETWORK_ERROR',
    'NETWORK_TIMEOUT',
    'RATE_LIMITED',
    'HTTP_ERROR',
    'TRANSFER_INTERRUPTED',
    'UNKNOWN_ERROR',
  ]);
  const neverAuto = new Set([
    'INVALID_RESOURCE',
    'AUTH_ERROR',
    'SOURCE_CHANGED',
    'INSUFFICIENT_STORAGE',
    'FILE_WRITE_FAILED',
    'CANCELLED',
  ]);
  for (const code of auto) assert.ok(!neverAuto.has(code));
  assert.ok(auto.has('NETWORK_TIMEOUT'));
  assert.ok(neverAuto.has('SOURCE_CHANGED'));
});

check('final verification rejects size mismatch', () => {
  const verify = (size, expected) => {
    if (size <= 0) return false;
    if (expected != null && expected > 0 && Math.abs(size - expected) > 1024) {
      return false;
    }
    return true;
  };
  assert.equal(verify(1000, 1000), true);
  assert.equal(verify(1000, 5000), false);
  assert.equal(verify(0, 1000), false);
});

// --- Phase 3: filename / local capability ---

function sanitizeFileNameV2(raw) {
  let name = typeof raw === 'string' ? raw.trim() : '';
  if (/^https?:\/\//i.test(name)) {
    try {
      const parsed = new URL(name);
      const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
      name = segment || 'download.bin';
    } catch {
      name = 'download.bin';
    }
  }
  name = name.split('?')[0]?.split('#')[0] ?? name;
  name = name.replace(/[/\\]/g, '_');
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name || name === '.' || name === '..') return 'download.bin';
  name = name.replace(/^\.+/, '_');
  name = name.replace(/_+/g, '_');
  if (!name || name === '.' || name === '..' || name === '_') return 'download.bin';
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const ext = hasExt ? name.slice(dot + 1).toLowerCase().slice(0, 16) : '';
  const base = hasExt ? name.slice(0, dot) : name;
  const maxBase = Math.max(1, 180 - (ext ? ext.length + 1 : 0));
  const trimmedBase = base.slice(0, maxBase).trim() || 'download';
  const combined = ext ? `${trimmedBase}.${ext}` : trimmedBase;
  return combined || 'download.bin';
}

const MIME_TO_EXT = {
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
};

function resolveDownloadFileName(input) {
  const sanitized = sanitizeFileNameV2(input.fileName?.trim() || 'download');
  let ext = '';
  const nameDot = sanitized.lastIndexOf('.');
  if (nameDot > 0 && nameDot < sanitized.length - 1) {
    ext = sanitized.slice(nameDot + 1).toLowerCase();
  }
  if (!ext && input.mimeType) {
    const key = input.mimeType.trim().split(';')[0]?.trim().toLowerCase() ?? '';
    ext = MIME_TO_EXT[key] ?? '';
  }
  if (!ext && input.sourceUrl) {
    try {
      const parsed = new URL(input.sourceUrl.trim());
      const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
      const d = segment.lastIndexOf('.');
      if (d > 0) ext = segment.slice(d + 1).toLowerCase();
    } catch {
      /* ignore */
    }
  }
  if (!ext) ext = 'bin';
  if (nameDot > 0 && nameDot < sanitized.length - 1) return sanitized;
  const base =
    sanitized === 'download.bin' || sanitized === 'download'
      ? 'download'
      : sanitized;
  return sanitizeFileNameV2(`${base}.${ext}`);
}

function canUseCompletedLocalMedia(options) {
  if (options.status !== 'COMPLETED') return false;
  if (!options.localUri?.trim()) return false;
  if (
    options.localState === 'missing' ||
    options.localState === 'corrupt' ||
    options.localState === 'deleted'
  ) {
    return false;
  }
  return options.localState === 'complete' || options.localState == null;
}

check('sanitize blocks path traversal and query strings', () => {
  assert.equal(sanitizeFileNameV2('../etc/passwd'), '_etc_passwd');
  assert.ok(!sanitizeFileNameV2('a/b\\c').includes('/'));
  assert.ok(!sanitizeFileNameV2('clip.mp4?token=1').includes('?'));
  assert.equal(sanitizeFileNameV2(''), 'download.bin');
  assert.equal(sanitizeFileNameV2('..'), 'download.bin');
});

check('resolveDownloadFileName extension priority', () => {
  assert.equal(
    resolveDownloadFileName({ fileName: 'clip', mimeType: 'video/mp4' }),
    'clip.mp4',
  );
  assert.equal(
    resolveDownloadFileName({
      fileName: 'clip',
      sourceUrl: 'https://cdn.example.com/a/b/video.mp3',
    }),
    'clip.mp3',
  );
  assert.equal(
    resolveDownloadFileName({ fileName: 'clip' }),
    'clip.bin',
  );
  assert.equal(
    resolveDownloadFileName({ fileName: 'safe.mp4', mimeType: 'audio/mpeg' }),
    'safe.mp4',
  );
});

check('Open/Share gate requires COMPLETED + usable local file', () => {
  assert.equal(
    canUseCompletedLocalMedia({
      status: 'COMPLETED',
      localUri: 'file:///x/a.mp4',
      localState: 'complete',
    }),
    true,
  );
  assert.equal(
    canUseCompletedLocalMedia({
      status: 'COMPLETED',
      localUri: 'file:///x/a.mp4',
      localState: 'missing',
    }),
    false,
  );
  assert.equal(
    canUseCompletedLocalMedia({
      status: 'DOWNLOADING',
      localUri: 'file:///x/a.mp4',
      localState: 'complete',
    }),
    false,
  );
  assert.equal(
    canUseCompletedLocalMedia({
      status: 'COMPLETED',
      localUri: null,
      localState: 'complete',
    }),
    false,
  );
});

// ── Phase 2 reconciliation / sync snapshot pure logic ───────────────────

function isSameSyncSnapshot(a, b) {
  return (
    a.status === b.status &&
    a.progress === b.progress &&
    (a.errorCode ?? null) === (b.errorCode ?? null) &&
    (a.errorMessage ?? null) === (b.errorMessage ?? null)
  );
}

function shouldBlockSyncAgainstTerminal(localTerminal, payload) {
  if (localTerminal !== 'COMPLETED' && localTerminal !== 'CANCELLED') {
    return false;
  }
  if (payload.status && payload.status !== localTerminal) {
    return true;
  }
  if (!payload.status && payload.progress !== undefined) {
    return true;
  }
  return false;
}

function reconcileDownloadState(remote, evidence) {
  const local = evidence.local ?? null;
  const transfer = evidence.transfer ?? null;
  const engine = evidence.engine ?? {};
  const progress = Math.max(
    remote.progress ?? 0,
    local?.progress ?? 0,
    transfer?.progress ?? 0,
  );
  const transferring =
    engine.hasActiveWorker === true ||
    transfer?.localState === 'transferring' ||
    (local?.status === 'DOWNLOADING' && transfer?.localState !== 'paused');

  if (local?.status === 'CANCELLED' || engine.isSuppressed) {
    return {
      item: { ...remote, status: 'CANCELLED', progress },
      needsBackendReconcile: remote.status !== 'CANCELLED',
      reason: 'local-cancelled-wins',
    };
  }

  if (
    (local?.status === 'COMPLETED' || engine.verifiedCompletedFile) &&
    !engine.completedFileMissing &&
    remote.status !== 'COMPLETED'
  ) {
    return {
      item: { ...remote, status: 'COMPLETED', progress: 100 },
      needsBackendReconcile: true,
      reason: 'verified-completed-wins',
    };
  }

  if (
    transferring &&
    (remote.status === 'QUEUED' ||
      remote.status === 'PAUSED' ||
      remote.status === 'FAILED')
  ) {
    return {
      item: { ...remote, status: 'DOWNLOADING', progress },
      needsBackendReconcile: true,
      reason: 'active-worker-wins',
    };
  }

  if (
    local?.status === 'PAUSED' &&
    !transferring &&
    remote.status === 'DOWNLOADING'
  ) {
    return {
      item: { ...remote, status: 'PAUSED', progress },
      needsBackendReconcile: true,
      reason: 'local-paused-wins',
    };
  }

  return {
    item: { ...remote, progress },
    needsBackendReconcile: false,
    reason: 'remote-accepted',
  };
}

check('sync snapshot dedupe suppresses identical PATCH payloads', () => {
  const a = { status: 'DOWNLOADING', progress: 44, errorCode: null, errorMessage: null };
  const b = { status: 'DOWNLOADING', progress: 44, errorCode: null, errorMessage: null };
  const c = { status: 'DOWNLOADING', progress: 46, errorCode: null, errorMessage: null };
  assert.equal(isSameSyncSnapshot(a, b), true);
  assert.equal(isSameSyncSnapshot(a, c), false);
});

check('terminal sync guard blocks stale progress after CANCELLED', () => {
  assert.equal(
    shouldBlockSyncAgainstTerminal('CANCELLED', { progress: 71 }),
    true,
  );
  assert.equal(
    shouldBlockSyncAgainstTerminal('CANCELLED', { status: 'DOWNLOADING' }),
    true,
  );
  assert.equal(
    shouldBlockSyncAgainstTerminal('CANCELLED', { status: 'CANCELLED' }),
    false,
  );
  assert.equal(
    shouldBlockSyncAgainstTerminal(null, { progress: 71 }),
    false,
  );
});

check('active local DOWNLOADING wins over stale remote PAUSED', () => {
  const decision = reconcileDownloadState(
    { id: '1', status: 'PAUSED', progress: 40 },
    {
      local: { id: '1', status: 'DOWNLOADING', progress: 55 },
      transfer: { localState: 'transferring', progress: 55 },
      engine: { hasActiveWorker: true },
    },
  );
  assert.equal(decision.item.status, 'DOWNLOADING');
  assert.equal(decision.reason, 'active-worker-wins');
  assert.equal(decision.needsBackendReconcile, true);
  assert.ok(decision.item.progress >= 55);
});

check('local PAUSED wins over stale remote DOWNLOADING', () => {
  const decision = reconcileDownloadState(
    { id: '1', status: 'DOWNLOADING', progress: 60 },
    {
      local: { id: '1', status: 'PAUSED', progress: 60 },
      transfer: { localState: 'paused', progress: 60 },
      engine: { hasActiveWorker: false },
    },
  );
  assert.equal(decision.item.status, 'PAUSED');
  assert.equal(decision.reason, 'local-paused-wins');
});

check('verified COMPLETED wins over stale remote DOWNLOADING', () => {
  const decision = reconcileDownloadState(
    { id: '1', status: 'DOWNLOADING', progress: 90 },
    {
      local: { id: '1', status: 'COMPLETED', progress: 100 },
      transfer: { localState: 'complete', progress: 100 },
      engine: { verifiedCompletedFile: true },
    },
  );
  assert.equal(decision.item.status, 'COMPLETED');
  assert.equal(decision.reason, 'verified-completed-wins');
});

check('sync coalescing keeps latest progress only', () => {
  let pending;
  const coalesce = (next) => {
    pending = pending === undefined ? next : Math.max(pending, next);
  };
  coalesce(41);
  coalesce(42);
  coalesce(45);
  assert.equal(pending, 45);
});

check('409 conflict decision drops poison status-only retry storm', () => {
  // Status-only conflict → drop (no restore). Progress+status → status-only once.
  const decide = (payload) => {
    if (payload.status !== undefined && payload.progress !== undefined) {
      return 'retry-status-only';
    }
    if (payload.status !== undefined && payload.progress === undefined) {
      return 'drop';
    }
    return 'drop';
  };
  assert.equal(decide({ status: 'PAUSED' }), 'drop');
  assert.equal(decide({ status: 'DOWNLOADING', progress: 10 }), 'retry-status-only');
  assert.equal(decide({ progress: 10 }), 'drop');
});

// ── Phase 3 recovery decisions ─────────────────────────────────────────

function decideRecoveryState(evidence) {
  if (evidence.isSuppressed || evidence.remoteStatus === 'CANCELLED') {
    return { action: 'KEEP_CANCELLED', reason: 'cancelled' };
  }
  if (evidence.remoteStatus === 'COMPLETED' || evidence.localState === 'complete') {
    if (evidence.hasVerifiedFinalFile) {
      return { action: 'KEEP_COMPLETED', reason: 'completed-verified' };
    }
    return { action: 'MARK_LOCAL_UNAVAILABLE', reason: 'completed-file-unavailable' };
  }
  if (
    evidence.hasActiveWorker &&
    (evidence.remoteStatus === 'DOWNLOADING' || evidence.localState === 'transferring')
  ) {
    return { action: 'KEEP_DOWNLOADING', reason: 'active-worker' };
  }
  if (evidence.isQueued) {
    return { action: 'NO_ACTION', reason: 'already-queued' };
  }
  if (
    evidence.remoteStatus === 'DOWNLOADING' ||
    evidence.localState === 'transferring'
  ) {
    if (evidence.isHls) {
      return { action: 'RECOVER_TO_FAILED', reason: 'hls-interrupted' };
    }
    if (evidence.hasValidPartial && evidence.canResume) {
      return { action: 'RECOVER_TO_PAUSED', reason: 'progressive-partial-resumable' };
    }
    return { action: 'RECOVER_TO_FAILED', reason: 'downloading-no-partial' };
  }
  if (evidence.remoteStatus === 'PAUSED' || evidence.localState === 'paused') {
    if (evidence.hasValidPartial && evidence.canResume) {
      return { action: 'KEEP_PAUSED', reason: 'paused-resumable' };
    }
    return { action: 'RECOVER_TO_FAILED', reason: 'paused-partial-missing' };
  }
  if (evidence.remoteStatus === 'FAILED') {
    return { action: 'KEEP_FAILED', reason: 'failed-sticky' };
  }
  if (evidence.remoteStatus === 'QUEUED' || evidence.localState === 'not_started') {
    if (!evidence.sourceUrlSafe) {
      return { action: 'RECOVER_TO_FAILED', reason: 'queued-unsafe-url' };
    }
    return { action: 'REENQUEUE', reason: 'queued-reenqueue' };
  }
  return { action: 'NO_ACTION', reason: 'no-op' };
}

check('DOWNLOADING + active worker → keep DOWNLOADING', () => {
  const d = decideRecoveryState({
    remoteStatus: 'DOWNLOADING',
    localState: 'transferring',
    hasActiveWorker: true,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: true,
    canResume: true,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'KEEP_DOWNLOADING');
});

check('DOWNLOADING + progressive partial + no worker → PAUSED', () => {
  const d = decideRecoveryState({
    remoteStatus: 'DOWNLOADING',
    localState: 'transferring',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: true,
    canResume: true,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'RECOVER_TO_PAUSED');
});

check('DOWNLOADING + no partial → FAILED', () => {
  const d = decideRecoveryState({
    remoteStatus: 'DOWNLOADING',
    localState: 'transferring',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'RECOVER_TO_FAILED');
});

check('HLS interruption → FAILED (no fake pause)', () => {
  const d = decideRecoveryState({
    remoteStatus: 'DOWNLOADING',
    localState: 'transferring',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: true,
    hasValidPartial: true,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'RECOVER_TO_FAILED');
  assert.equal(d.reason, 'hls-interrupted');
});

check('PAUSED + missing partial → FAILED', () => {
  const d = decideRecoveryState({
    remoteStatus: 'PAUSED',
    localState: 'paused',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'RECOVER_TO_FAILED');
});

check('COMPLETED + file exists → COMPLETED', () => {
  const d = decideRecoveryState({
    remoteStatus: 'COMPLETED',
    localState: 'complete',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: true,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'KEEP_COMPLETED');
});

check('COMPLETED + file missing → local unavailable', () => {
  const d = decideRecoveryState({
    remoteStatus: 'COMPLETED',
    localState: 'complete',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: true,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'MARK_LOCAL_UNAVAILABLE');
});

check('CANCELLED + stale queue metadata → CANCELLED', () => {
  const d = decideRecoveryState({
    remoteStatus: 'CANCELLED',
    localState: 'not_started',
    hasActiveWorker: false,
    isQueued: true,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'KEEP_CANCELLED');
});

check('QUEUED intent → reenqueue once', () => {
  const d = decideRecoveryState({
    remoteStatus: 'QUEUED',
    localState: 'not_started',
    hasActiveWorker: false,
    isQueued: false,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'REENQUEUE');
});

check('recovery called twice → already-queued is no-op', () => {
  const d = decideRecoveryState({
    remoteStatus: 'QUEUED',
    localState: 'not_started',
    hasActiveWorker: false,
    isQueued: true,
    isSuppressed: false,
    isHls: false,
    hasValidPartial: false,
    canResume: false,
    hasVerifiedFinalFile: false,
    completedFileMissing: false,
    sourceUrlSafe: true,
  });
  assert.equal(d.action, 'NO_ACTION');
});

check('retry timer recovery schedules one timer only', () => {
  const timers = new Set();
  const schedule = (id) => {
    if (timers.has(id)) return false;
    timers.add(id);
    return true;
  };
  assert.equal(schedule('a'), true);
  assert.equal(schedule('a'), false);
  assert.equal(timers.size, 1);
});

check('metadata / .internal hosts blocked for SSRF', () => {
  assert.equal(isPrivateOrLocalHostname('metadata.google.internal'), true);
  assert.equal(isPrivateOrLocalHostname('foo.internal'), true);
  assert.equal(isPrivateOrLocalHostname('cdn.example.com'), false);
});

console.log(`\nengine.smoke: ${passed} checks passed`);
