/**
 * Phase 1A — centralized DEV-only download runtime audit diagnostics.
 * Structured, sanitized events for forensic tracing. Never logs secrets.
 */

import { safeDownloadHostname } from './download-runtime-diagnostics.service';

export type AuditTag =
  | 'DownloadState'
  | 'Scheduler'
  | 'NetworkPolicy'
  | 'Worker'
  | 'Request'
  | 'FirstByte'
  | 'Transfer'
  | 'PauseResume'
  | 'Retry'
  | 'Watchdog'
  | 'Finalize'
  | 'Library'
  | 'Traffic';

export type TrafficClass =
  | 'browser_observation'
  | 'metadata_probe'
  | 'candidate_verification'
  | 'redirect_probe'
  | 'hls_manifest'
  | 'hls_segment'
  | 'download_transfer'
  | 'resume_transfer'
  | 'retry_transfer'
  | 'source_identity_probe'
  | 'media_refresh';

type AuditValue = string | number | boolean | null | undefined;

export type AuditFields = Record<string, AuditValue>;

const BLOCKED_KEYS = new Set([
  'cookie',
  'cookies',
  'authorization',
  'sourceurl',
  'source_url',
  'localuri',
  'local_uri',
  'path',
  'absolutepath',
  'token',
  'accesstoken',
  'refreshtoken',
  'query',
  'signedurl',
]);

const progressThrottle = new Map<string, number>();
const PROGRESS_THROTTLE_MS = 4000;

function sanitizeKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (BLOCKED_KEYS.has(lower)) {
    return false;
  }
  if (
    (lower.includes('cookie') ||
      lower.includes('token') ||
      lower.includes('authorization') ||
      lower.includes('sig') ||
      lower.includes('password')) &&
    !lower.includes('hassignature')
  ) {
    return false;
  }
  return true;
}

function sanitizeFields(fields: AuditFields): AuditFields {
  const out: AuditFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!sanitizeKey(key)) {
      continue;
    }
    if (typeof value === 'string' && value.startsWith('http')) {
      out[key] = safeDownloadHostname(value) ?? '[invalid-url]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function sanitizeAuditUrl(url: string | null | undefined): {
  host: string | null;
  pathPattern: string | null;
} {
  if (!url) {
    return { host: null, pathPattern: null };
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const pattern =
      segments.length === 0
        ? '/'
        : `/${segments[0]}${segments.length > 1 ? '/…' : ''}`;
    return { host: parsed.hostname, pathPattern: pattern };
  } catch {
    return { host: null, pathPattern: null };
  }
}

export function logDownloadAudit(
  tag: AuditTag,
  fields: AuditFields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const payload = sanitizeFields(fields);
  console.log(`[${tag}]`, payload);
}

export function logDownloadStateTransition(input: {
  downloadId: string;
  previousState: string | null;
  nextState: string;
  reason: string;
  extra?: AuditFields;
}): void {
  logDownloadAudit('DownloadState', {
    downloadId: input.downloadId,
    previousState: input.previousState,
    nextState: input.nextState,
    reason: input.reason,
    platform: 'android',
    ...input.extra,
  });
}

export function logSchedulerDrain(input: {
  reason:
    | 'create'
    | 'completion'
    | 'network_change'
    | 'resume'
    | 'retry'
    | 'settings_change'
    | 'cancel'
    | 'release'
    | 'reevaluate'
    | 'recovery';
  queued: number;
  active: number;
  limit: number;
}): void {
  logDownloadAudit('Scheduler', input);
}

export function logSchedulerDecision(input: {
  downloadId: string;
  decision: 'ADMIT' | 'BLOCK' | 'REQUEUE' | 'REMOVE';
  reason: string;
  schedulerActiveCount?: number;
  schedulerLimit?: number;
  pendingCount?: number;
  startingCount?: number;
  activeCount?: number;
}): void {
  logDownloadAudit('Scheduler', input);
}

export function logWorkerLifecycle(input: {
  downloadId: string;
  event: 'admitted' | 'released';
  releaseReason?: string;
  transferType?: string;
  admittedAt?: number;
  releasedAt?: number;
}): void {
  logDownloadAudit('Worker', input);
}

export function logNetworkPolicy(input: {
  network: string;
  isConnected: boolean;
  wifiOnly: boolean;
  decision?: 'ALLOW' | 'WAIT';
  reason?: string;
  downloadId?: string;
  invariantViolation?: boolean;
}): void {
  logDownloadAudit('NetworkPolicy', input);
}

export function logTrafficRequest(input: {
  trafficClass: TrafficClass;
  downloadId?: string | null;
  method: string;
  host: string | null;
  pathPattern?: string | null;
  requestedRange?: string | null;
  responseStatus?: number | null;
  contentType?: string | null;
  contentLength?: number | null;
  bytesActuallyConsumed?: number | null;
}): void {
  logDownloadAudit('Traffic', input);
}

export function logFirstByte(input: {
  downloadId: string;
  latencyMs: number;
  bytesWritten?: number;
  totalBytes?: number | null;
  transferType?: string;
}): void {
  logDownloadAudit('FirstByte', input);
}

export function logTransferProgressThrottled(input: {
  downloadId: string;
  bytesWritten: number;
  totalBytes?: number | null;
  lastProgressAgeMs?: number;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const now = Date.now();
  const last = progressThrottle.get(input.downloadId) ?? 0;
  if (now - last < PROGRESS_THROTTLE_MS) {
    return;
  }
  progressThrottle.set(input.downloadId, now);
  logDownloadAudit('Transfer', input);
}

export function logWatchdog(input: {
  downloadId?: string;
  generation?: number | null;
  watchdogPhase:
    | 'connect'
    | 'first_byte'
    | 'transfer'
    | 'finalizing'
    | 'hls_manifest'
    | 'hls_segment';
  startedAt?: number;
  timeoutMs?: number;
  lastProgressAt?: number;
  triggered?: boolean;
  bytesWritten?: number;
  errorProduced?: string | null;
  result?: 'retry' | 'fail' | 'network_wait';
}): void {
  logDownloadAudit('Watchdog', input);
}

export function logFinalize(input: {
  downloadId: string;
  tempPathCategory?: string;
  finalBytes?: number;
  signatureValidation?: boolean;
  containerValidation?: boolean;
  commitSuccess?: boolean;
  libraryEligible?: boolean;
}): void {
  logDownloadAudit('Finalize', input);
}

export function logPauseResume(input: {
  downloadId: string;
  action: 'pause' | 'resume' | 'retry' | 'cancel';
  outcome: 'ok' | 'blocked' | 'failed';
  reason?: string;
  resumeOffset?: number | null;
  transferType?: string;
  generation?: number | null;
  operation?: string;
  resumeDecision?: string | null;
  sourceFreshness?: string | null;
  bytesWritten?: number;
}): void {
  logDownloadAudit('PauseResume', input);
}

export type DownloadRuntimeTraceEvent =
  | 'PAUSE_REQUESTED'
  | 'PAUSE_SIGNAL_SENT'
  | 'TRANSPORT_ABORTED_FOR_PAUSE'
  | 'PAUSE_ABORT_SKIPPED_NATIVE_TASK'
  | 'PAUSE_SETTLE_TIMEOUT'
  | 'PAUSE_ACKNOWLEDGED'
  | 'PARTIAL_PRESERVED'
  | 'WORKER_RELEASED'
  | 'PAUSE_COMMITTED'
  | 'PAUSE_SETTLED'
  | 'PAUSE_DURABILITY'
  | 'LATE_PROGRESS_REJECTED'
  | 'STALE_EVENT_IGNORED'
  | 'RESUME_REQUESTED'
  | 'RESUME_CLAIMED'
  | 'RESUME_STATE_READ'
  | 'RESUME_STRATEGY_SELECTED'
  | 'RANGE_RESUME_SELECTED'
  | 'RESTART_FROM_ZERO_SELECTED'
  | 'SESSION_REFRESH_SELECTED'
  | 'RESUME_QUEUED'
  | 'RESUME_STARTED'
  | 'RESUME_FAILED'
  | 'RANGE_REQUEST_STARTED'
  | 'RANGE_VALIDATED'
  | 'FULL_RESTART_REQUIRED'
  | 'HLS_RESUME_STARTED'
  | 'TRANSFER_RESTARTED'
  | 'FINALIZING_ENTERED';

export function logDownloadRuntimeTrace(input: {
  downloadId: string;
  event: DownloadRuntimeTraceEvent;
  canonicalStatus?: string | null;
  executionState?: string | null;
  workerGeneration?: number | null;
  transferKind?: string | null;
  operation?: string | null;
  strategy?: string | null;
  actualPartialSize?: number | null;
  hasResumeData?: boolean | null;
  sourceRefreshRequired?: boolean | null;
  partialPathClass?: string | null;
  logicalBytes?: number | null;
  filesystemBytes?: number | null;
}): void {
  logDownloadAudit('PauseResume', {
    channel: 'DOWNLOAD_RUNTIME_TRACE',
    downloadId: input.downloadId,
    event: input.event,
    canonicalStatus: input.canonicalStatus ?? null,
    executionState: input.executionState ?? null,
    workerGeneration: input.workerGeneration ?? null,
    transferKind: input.transferKind ?? null,
    operation: input.operation ?? null,
    strategy: input.strategy ?? null,
    actualPartialSize: input.actualPartialSize ?? null,
    hasResumeData: input.hasResumeData ?? null,
    sourceRefreshRequired: input.sourceRefreshRequired ?? null,
    partialPathClass: input.partialPathClass ?? null,
    logicalBytes: input.logicalBytes ?? null,
    filesystemBytes: input.filesystemBytes ?? null,
  });
}

export function logRetryAudit(input: {
  downloadId: string;
  retryAttempt?: number;
  retryReason?: string;
  scheduled?: boolean;
}): void {
  logDownloadAudit('Retry', input);
}

export function resetAuditDiagnosticsForTests(): void {
  progressThrottle.clear();
}
