import {
  PLAYBACK_BACKEND_SYNC_INTERVAL_MS,
  PLAYBACK_LOCAL_PERSIST_INTERVAL_MS,
  PLAYBACK_RECONNECT_SYNC_BATCH_LIMIT,
} from './constants';
import { resolveCompletedState } from './domain/completion';
import { shouldResetCompletedOnReplay } from './domain/replay-reset';
import { computeProgressPercent, isValidProgressNumbers } from './domain/progress';
import { clampClientTimestampIso, reconcilePlaybackState } from './domain/reconcile';
import { playbackLog } from './diagnostics';
import {
  deletePlaybackState,
  listPlaybackStatesForUser,
  loadPlaybackState,
  savePlaybackState,
} from './persistence';
import type { PlaybackState } from './types';
import type { PlaybackContractEvent } from '../player/playback-events';

export type PlaybackSyncTransport = {
  updateProgress: (
    mediaId: string,
    body: {
      positionSeconds: number;
      durationSeconds: number;
      updatedAt: string;
      lastPlayedAt?: string | null;
      markCompleted?: boolean;
      replayReset?: boolean;
      clientRevision?: number;
    },
  ) => Promise<{
    mediaId: string;
    positionSeconds: number;
    durationSeconds: number;
    progressPercent: number;
    lastPlayedAt: string | null;
    completed: boolean;
    updatedAt: string;
    clientRevision?: number;
  } | unknown>;
};

export type PlaybackCoordinatorClock = {
  now: () => number;
};

export type PlaybackBoundaryReason =
  | 'pause'
  | 'exit'
  | 'background'
  | 'complete'
  | 'media_change'
  | 'manual'
  | 'replay_reset';

export type PlaybackCoordinatorDeps = {
  getUserId: () => string | null;
  sync?: PlaybackSyncTransport | null;
  clock?: PlaybackCoordinatorClock;
  localPersistIntervalMs?: number;
  backendSyncIntervalMs?: number;
  /** Optional AppState-like subscription for background flush. */
  subscribeAppState?: (
    listener: (status: string) => void,
  ) => () => void;
  /**
   * Optional network reconnect subscription.
   * Listener receives true when connectivity is restored.
   */
  subscribeNetworkReconnect?: (
    listener: () => void,
  ) => () => void;
  /** Meaningful UI query invalidation boundaries — never per tick. */
  onBoundaryFlush?: (reason: PlaybackBoundaryReason, mediaId: string) => void;
};

type ActiveSession = {
  mediaId: string;
  state: PlaybackState;
  /** Monotonic revision — clears pendingSync only when still current after sync. */
  revision: number;
  /** lastPlayedAt already established for this play session. */
  started: boolean;
  /** Force markCompleted on next sync. */
  markCompleted: boolean;
  lastLocalPersistAt: number;
  lastBackendSyncAt: number;
  dirtyLocal: boolean;
  dirtyRemote: boolean;
  /** Include lastPlayedAt on next remote sync. */
  syncLastPlayedAt: boolean;
};

function readErrorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number | null }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
}

/**
 * Single owner of playback persistence.
 * Player emits events; coordinator persists — never the reverse.
 */
export class PlaybackPersistenceCoordinator {
  private readonly getUserId: () => string | null;
  private sync: PlaybackSyncTransport | null;
  private readonly clock: PlaybackCoordinatorClock;
  private readonly localPersistIntervalMs: number;
  private readonly backendSyncIntervalMs: number;
  private readonly onBoundaryFlush:
    | ((reason: PlaybackBoundaryReason, mediaId: string) => void)
    | null;

  private session: ActiveSession | null = null;
  private localTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private syncInFlight = false;
  private pendingAfterFlight = false;
  private unsubAppState: (() => void) | null = null;
  private unsubNetwork: (() => void) | null = null;
  private disposed = false;
  private generation = 0;
  /** Pending intentional replay reset to sync to backend. */
  private pendingReplayReset = false;
  private reconnectInFlight = false;

  constructor(deps: PlaybackCoordinatorDeps) {
    this.getUserId = deps.getUserId;
    this.sync = deps.sync ?? null;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.localPersistIntervalMs =
      deps.localPersistIntervalMs ?? PLAYBACK_LOCAL_PERSIST_INTERVAL_MS;
    this.backendSyncIntervalMs =
      deps.backendSyncIntervalMs ?? PLAYBACK_BACKEND_SYNC_INTERVAL_MS;
    this.onBoundaryFlush = deps.onBoundaryFlush ?? null;

    if (deps.subscribeAppState) {
      this.unsubAppState = deps.subscribeAppState((status) => {
        if (status === 'background' || status === 'inactive') {
          void this.background();
        }
      });
    }

    if (deps.subscribeNetworkReconnect) {
      this.unsubNetwork = deps.subscribeNetworkReconnect(() => {
        void this.reconcilePendingOnReconnect();
      });
    }
  }

  setSyncTransport(sync: PlaybackSyncTransport | null): void {
    this.sync = sync;
  }

  /** Local-only production binds `sync: null` — never schedule cloud work. */
  private hasRemoteTransport(): boolean {
    return this.sync != null;
  }

  /**
   * Cancel timers and drop in-memory session (tests / dispose).
   * Not an account logout path — VidoraX is auth-free.
   */
  resetForLogout(): void {
    this.generation += 1;
    this.clearTimers();
    this.session = null;
    this.syncInFlight = false;
    this.pendingAfterFlight = false;
    this.pendingReplayReset = false;
    this.reconnectInFlight = false;
    playbackLog('playback.account_generation_changed', {
      generation: this.generation,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.resetForLogout();
    this.unsubAppState?.();
    this.unsubAppState = null;
    this.unsubNetwork?.();
    this.unsubNetwork = null;
  }

  handleEvent(event: PlaybackContractEvent): void {
    if (this.disposed) {
      return;
    }
    switch (event.type) {
      case 'playbackStarted':
        this.startPlayback(event.mediaId, event.at);
        break;
      case 'positionChanged':
        this.updatePosition(
          event.mediaId,
          event.positionSeconds,
          event.durationSeconds ?? 0,
          event.at,
        );
        break;
      case 'paused':
        this.pause(event.mediaId, event.positionSeconds, event.at);
        break;
      case 'completed':
        this.complete(event.mediaId, event.at);
        break;
      case 'playerExited':
        this.exit(event.mediaId, event.positionSeconds, event.at);
        break;
      default:
        break;
    }
  }

  startPlayback(mediaId: string, at = this.clock.now()): void {
    const userId = this.requireUserId();
    if (!userId || !mediaId) {
      return;
    }

    if (this.session && this.session.mediaId !== mediaId) {
      this.flushSync('media_change');
    }

    const existing = loadPlaybackState(userId, mediaId);
    const iso = clampClientTimestampIso(
      new Date(at).toISOString(),
      this.clock.now(),
    );
    const nextRevision = (existing?.clientRevision ?? 0) + 1;
    const wantRemote = this.hasRemoteTransport();
    const state: PlaybackState = existing
      ? {
          ...existing,
          lastPlayedAt: iso,
          updatedAt: iso,
          pendingSync: wantRemote,
          clientRevision: nextRevision,
        }
      : {
          mediaId,
          positionSeconds: 0,
          durationSeconds: 0,
          progressPercent: 0,
          lastPlayedAt: iso,
          completed: false,
          updatedAt: iso,
          pendingSync: wantRemote,
          clientRevision: nextRevision,
        };

    // Replaying after completion: sticky completed stays until position proves
    // intentional near-start playback (see updatePosition + shouldResetCompletedOnReplay).

    this.session = {
      mediaId,
      state,
      revision: nextRevision,
      started: true,
      markCompleted: false,
      lastLocalPersistAt: 0,
      lastBackendSyncAt: 0,
      dirtyLocal: true,
      dirtyRemote: wantRemote,
      syncLastPlayedAt: wantRemote,
    };
    this.pendingReplayReset = false;

    this.persistLocalMandatory();
    this.scheduleRemoteSync();
  }

  updatePosition(
    mediaId: string,
    positionSeconds: number,
    durationSeconds: number,
    at = this.clock.now(),
  ): void {
    if (!this.ensureSession(mediaId)) {
      return;
    }
    if (!isValidProgressNumbers(positionSeconds, durationSeconds)) {
      return;
    }

    const session = this.session!;
    let replayReset = false;
    if (
      shouldResetCompletedOnReplay({
        completed: session.state.completed,
        playbackStarted: session.started,
        positionSeconds,
      })
    ) {
      replayReset = true;
      this.pendingReplayReset = true;
      playbackLog('playback.replay_reset', { mediaId });
      this.notifyBoundary('replay_reset', mediaId);
    }

    const completed = resolveCompletedState({
      positionSeconds,
      durationSeconds,
      existingCompleted: session.state.completed,
      replayReset,
    });

    const wantRemote = this.hasRemoteTransport();
    session.revision += 1;
    session.state = {
      ...session.state,
      positionSeconds,
      durationSeconds,
      progressPercent: computeProgressPercent(positionSeconds, durationSeconds),
      completed,
      updatedAt: clampClientTimestampIso(
        new Date(at).toISOString(),
        this.clock.now(),
      ),
      pendingSync: wantRemote,
      clientRevision: session.revision,
    };
    session.dirtyLocal = true;
    session.dirtyRemote = wantRemote;

    const now = this.clock.now();
    if (now - session.lastLocalPersistAt >= this.localPersistIntervalMs) {
      this.persistLocalMandatory();
    } else {
      this.scheduleLocalPersist();
    }
    this.scheduleRemoteSync();
  }

  pause(
    mediaId: string,
    positionSeconds: number,
    at = this.clock.now(),
  ): void {
    if (!this.ensureSession(mediaId)) {
      return;
    }
    const session = this.session!;
    const wantRemote = this.hasRemoteTransport();
    if (isValidProgressNumbers(positionSeconds, session.state.durationSeconds)) {
      session.revision += 1;
      session.state = {
        ...session.state,
        positionSeconds,
        progressPercent: computeProgressPercent(
          positionSeconds,
          session.state.durationSeconds,
        ),
        updatedAt: clampClientTimestampIso(
          new Date(at).toISOString(),
          this.clock.now(),
        ),
        pendingSync: wantRemote,
        clientRevision: session.revision,
      };
    }
    session.dirtyLocal = true;
    session.dirtyRemote = wantRemote;
    this.flushSync('pause');
  }

  complete(mediaId: string, at = this.clock.now()): void {
    if (!this.ensureSession(mediaId)) {
      return;
    }
    const session = this.session!;
    const wantRemote = this.hasRemoteTransport();
    const duration = session.state.durationSeconds;
    const position =
      duration > 0 ? duration : session.state.positionSeconds;

    session.revision += 1;
    session.state = {
      ...session.state,
      positionSeconds: position,
      progressPercent: computeProgressPercent(position, duration || position),
      completed: true,
      updatedAt: clampClientTimestampIso(
        new Date(at).toISOString(),
        this.clock.now(),
      ),
      pendingSync: wantRemote,
      clientRevision: session.revision,
    };
    session.markCompleted = true;
    session.dirtyLocal = true;
    session.dirtyRemote = wantRemote;
    playbackLog('playback.completed', { mediaId });
    this.flushSync('complete');
  }

  exit(
    mediaId: string,
    positionSeconds: number,
    at = this.clock.now(),
  ): void {
    if (!this.ensureSession(mediaId)) {
      return;
    }
    const session = this.session!;
    const wantRemote = this.hasRemoteTransport();
    if (isValidProgressNumbers(positionSeconds, session.state.durationSeconds)) {
      session.revision += 1;
      session.state = {
        ...session.state,
        positionSeconds,
        progressPercent: computeProgressPercent(
          positionSeconds,
          session.state.durationSeconds,
        ),
        updatedAt: clampClientTimestampIso(
          new Date(at).toISOString(),
          this.clock.now(),
        ),
        pendingSync: wantRemote,
        clientRevision: session.revision,
      };
    }
    session.dirtyLocal = true;
    session.dirtyRemote = wantRemote;
    this.flushSync('exit');
  }

  background(): void {
    if (!this.session) {
      return;
    }
    this.session.dirtyLocal = true;
    this.session.dirtyRemote = this.hasRemoteTransport();
    this.flushSync('background');
  }

  /** Public flush for tests / media change. */
  flush(): void {
    this.flushSync('manual');
  }

  getActiveState(): PlaybackState | null {
    return this.session?.state ?? null;
  }

  /**
   * Background reconnect: coalesce pending local states and push latest per mediaId.
   * Never blocks UI / player.
   */
  async reconcilePendingOnReconnect(): Promise<void> {
    if (this.disposed || this.reconnectInFlight) {
      return;
    }
    const userId = this.requireUserId();
    const transport = this.sync;
    if (!userId || !transport) {
      return;
    }

    this.reconnectInFlight = true;
    const gen = this.generation;
    try {
      if (this.session?.dirtyRemote) {
        void this.runRemoteSync({ force: true });
      }

      const pending = listPlaybackStatesForUser(userId).filter(
        (row) => row.pendingSync,
      );
      // One latest row per mediaId already (storage key). Cap wave size.
      const wave = pending
        .sort((a, b) => b.clientRevision - a.clientRevision)
        .slice(0, PLAYBACK_RECONNECT_SYNC_BATCH_LIMIT);

      playbackLog('playback.pending_restored', {
        count: wave.length,
        mediaId: wave[0]?.mediaId,
      });

      for (const snapshot of wave) {
        if (this.generation !== gen || this.requireUserId() !== userId) {
          return;
        }
        // Active session owns its own sync path.
        if (this.session?.mediaId === snapshot.mediaId) {
          continue;
        }

        try {
          await transport.updateProgress(snapshot.mediaId, {
            positionSeconds: snapshot.positionSeconds,
            durationSeconds: snapshot.durationSeconds,
            updatedAt: snapshot.updatedAt,
            ...(snapshot.lastPlayedAt
              ? { lastPlayedAt: snapshot.lastPlayedAt }
              : {}),
            ...(snapshot.completed ? { markCompleted: true } : {}),
            clientRevision: snapshot.clientRevision,
          });

          if (this.generation !== gen || this.requireUserId() !== userId) {
            return;
          }

          const current = loadPlaybackState(userId, snapshot.mediaId);
          if (
            current &&
            current.clientRevision === snapshot.clientRevision &&
            current.pendingSync
          ) {
            savePlaybackState(userId, {
              ...current,
              pendingSync: false,
            });
            playbackLog('playback.sync_local_pushed', {
              mediaId: snapshot.mediaId,
              revision: snapshot.clientRevision,
            });
          }
        } catch (error) {
          const status = readErrorStatus(error);
          if (status === 404) {
            deletePlaybackState(userId, snapshot.mediaId);
            playbackLog('playback.sync_stale_ignored', {
              mediaId: snapshot.mediaId,
              result: 'media_missing',
            });
            continue;
          }
          if (status === 409) {
            playbackLog('playback.sync_conflict', {
              mediaId: snapshot.mediaId,
              revision: snapshot.clientRevision,
            });
            continue;
          }
          if (status === 401 || status === 403) {
            return;
          }
          playbackLog(
            'playback.sync_retry_scheduled',
            { mediaId: snapshot.mediaId, status: status ?? undefined },
            'warn',
          );
        }
      }
    } finally {
      this.reconnectInFlight = false;
    }
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private requireUserId(): string | null {
    try {
      return this.getUserId();
    } catch {
      return null;
    }
  }

  private ensureSession(mediaId: string): boolean {
    const userId = this.requireUserId();
    if (!userId || !mediaId) {
      return false;
    }

    if (this.session?.mediaId === mediaId) {
      return true;
    }

    // Position/pause before start — hydrate local without lastPlayedAt.
    if (this.session && this.session.mediaId !== mediaId) {
      this.flushSync('media_change');
    }

    const existing = loadPlaybackState(userId, mediaId);
    const nowIso = clampClientTimestampIso(
      new Date(this.clock.now()).toISOString(),
      this.clock.now(),
    );
    this.session = {
      mediaId,
      state: existing ?? {
        mediaId,
        positionSeconds: 0,
        durationSeconds: 0,
        progressPercent: 0,
        lastPlayedAt: null,
        completed: false,
        updatedAt: nowIso,
        pendingSync: false,
        clientRevision: 0,
      },
      revision: existing?.clientRevision ?? 0,
      started: false,
      markCompleted: false,
      lastLocalPersistAt: 0,
      lastBackendSyncAt: 0,
      dirtyLocal: false,
      dirtyRemote: false,
      syncLastPlayedAt: false,
    };
    if (existing) {
      playbackLog('playback.resume_loaded', {
        mediaId,
        revision: existing.clientRevision,
        pending: existing.pendingSync,
      });
    }
    return true;
  }

  private persistLocalMandatory(): void {
    const userId = this.requireUserId();
    const session = this.session;
    if (!userId || !session) {
      return;
    }
    // Clear legacy cloud dirty flags when running without a transport.
    if (!this.hasRemoteTransport() && session.state.pendingSync) {
      session.state = { ...session.state, pendingSync: false };
      session.dirtyRemote = false;
    }
    const saved = savePlaybackState(userId, {
      ...session.state,
      clientRevision: session.revision || session.state.clientRevision,
    });
    session.state = saved;
    session.dirtyLocal = false;
    session.lastLocalPersistAt = this.clock.now();
    playbackLog('playback.persistence_local', {
      mediaId: session.mediaId,
      pending: saved.pendingSync,
      revision: saved.clientRevision,
      completed: saved.completed,
    });
  }

  private scheduleLocalPersist(): void {
    if (this.localTimer) {
      return;
    }
    const session = this.session;
    if (!session) {
      return;
    }
    const elapsed =
      session.lastLocalPersistAt === 0
        ? 0
        : this.clock.now() - session.lastLocalPersistAt;
    const delay = Math.max(0, this.localPersistIntervalMs - elapsed);
    const gen = this.generation;
    this.localTimer = setTimeout(() => {
      this.localTimer = null;
      if (this.generation !== gen || !this.session?.dirtyLocal) {
        return;
      }
      this.persistLocalMandatory();
    }, delay);
  }

  private scheduleRemoteSync(): void {
    if (!this.hasRemoteTransport()) {
      return;
    }
    if (this.remoteTimer) {
      return;
    }
    const session = this.session;
    if (!session?.dirtyRemote) {
      return;
    }
    const elapsed =
      session.lastBackendSyncAt === 0
        ? 0
        : this.clock.now() - session.lastBackendSyncAt;
    const delay = Math.max(0, this.backendSyncIntervalMs - elapsed);
    playbackLog('playback.sync_deferred', {
      mediaId: session.mediaId,
      revision: session.revision,
      result: 'scheduled',
    });
    const gen = this.generation;
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null;
      if (this.generation !== gen) {
        return;
      }
      void this.runRemoteSync();
    }, delay);
  }

  private flushSync(reason: PlaybackBoundaryReason): void {
    this.clearTimers();
    this.persistLocalMandatory();
    if (this.session) {
      this.notifyBoundary(reason, this.session.mediaId);
    }
    void this.runRemoteSync({ force: true });
  }

  private notifyBoundary(reason: PlaybackBoundaryReason, mediaId: string): void {
    try {
      this.onBoundaryFlush?.(reason, mediaId);
    } catch {
      // UI invalidation must never break playback.
    }
  }

  private clearTimers(): void {
    if (this.localTimer) {
      clearTimeout(this.localTimer);
      this.localTimer = null;
    }
    if (this.remoteTimer) {
      clearTimeout(this.remoteTimer);
      this.remoteTimer = null;
    }
  }

  private async runRemoteSync(options?: { force?: boolean }): Promise<void> {
    const session = this.session;
    const userId = this.requireUserId();
    if (!session || !userId || !session.dirtyRemote) {
      return;
    }

    if (!options?.force) {
      const elapsed =
        session.lastBackendSyncAt === 0
          ? 0
          : this.clock.now() - session.lastBackendSyncAt;
      if (elapsed < this.backendSyncIntervalMs) {
        this.scheduleRemoteSync();
        return;
      }
    }

    if (this.syncInFlight) {
      this.pendingAfterFlight = true;
      playbackLog('playback.sync_deferred', {
        mediaId: session.mediaId,
        revision: session.revision,
        result: 'in_flight',
      });
      return;
    }

    const transport = this.sync;
    if (!transport) {
      // Local-only bind: never leave forever-dirty remote flags.
      session.dirtyRemote = false;
      if (session.state.pendingSync) {
        session.state = { ...session.state, pendingSync: false };
        this.persistLocalMandatory();
      }
      return;
    }

    const gen = this.generation;
    const syncUserId = userId;
    const snapshot = { ...session.state };
    const snapshotRevision = session.revision;
    const includeLastPlayed = session.syncLastPlayedAt;
    const markCompleted = session.markCompleted;
    const replayReset = this.pendingReplayReset && !snapshot.completed;

    this.syncInFlight = true;
    playbackLog('playback.sync_started', {
      mediaId: session.mediaId,
      revision: snapshotRevision,
    });

    try {
      const remote = await transport.updateProgress(session.mediaId, {
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        updatedAt: snapshot.updatedAt,
        ...(includeLastPlayed && snapshot.lastPlayedAt
          ? { lastPlayedAt: snapshot.lastPlayedAt }
          : {}),
        ...(markCompleted ? { markCompleted: true } : {}),
        ...(replayReset ? { replayReset: true } : {}),
        clientRevision: snapshotRevision,
      });

      // Account / generation guard — never apply to a different session.
      if (
        this.generation !== gen ||
        !this.session ||
        this.requireUserId() !== syncUserId
      ) {
        playbackLog('playback.sync_stale_ignored', {
          mediaId: snapshot.mediaId,
          result: 'generation_or_user',
        });
        return;
      }

      // Only clear pending if no newer local revision landed during the request.
      if (
        this.session.mediaId === snapshot.mediaId &&
        this.session.revision === snapshotRevision
      ) {
        this.session.state = {
          ...this.session.state,
          pendingSync: false,
        };
        this.session.dirtyRemote = false;
        this.session.syncLastPlayedAt = false;
        this.session.markCompleted = false;
        if (replayReset) {
          this.pendingReplayReset = false;
        }
        savePlaybackState(syncUserId, this.session.state);
        playbackLog('playback.sync_success', {
          mediaId: session.mediaId,
          revision: snapshotRevision,
        });
        playbackLog('playback.sync_local_pushed', {
          mediaId: session.mediaId,
          revision: snapshotRevision,
        });
      } else {
        this.session.dirtyRemote = true;
        playbackLog('playback.sync_stale_ignored', {
          mediaId: snapshot.mediaId,
          revision: snapshotRevision,
          result: 'newer_local_revision',
        });
      }

      // Optional remote acceptance when server returns a newer durable state.
      if (
        remote &&
        typeof remote === 'object' &&
        'updatedAt' in remote &&
        this.session.mediaId === snapshot.mediaId
      ) {
        const decision = reconcilePlaybackState({
          local: this.session.state,
          remote: remote as {
            mediaId: string;
            positionSeconds: number;
            durationSeconds: number;
            progressPercent: number;
            lastPlayedAt: string | null;
            completed: boolean;
            updatedAt: string;
            clientRevision?: number;
          },
          allowReplayDowngrade: replayReset,
          nowMs: this.clock.now(),
        });
        if (
          decision.decision === 'USE_REMOTE' &&
          decision.state &&
          this.session.revision === snapshotRevision
        ) {
          this.session.state = {
            ...this.session.state,
            positionSeconds: decision.state.positionSeconds,
            durationSeconds: decision.state.durationSeconds,
            progressPercent: decision.state.progressPercent,
            lastPlayedAt: decision.state.lastPlayedAt,
            completed: decision.state.completed,
            updatedAt: decision.state.updatedAt,
            pendingSync: false,
            clientRevision: Math.max(
              this.session.revision,
              decision.state.clientRevision ?? 0,
            ),
          };
          savePlaybackState(syncUserId, this.session.state);
          playbackLog('playback.sync_remote_accepted', {
            mediaId: session.mediaId,
            revision: this.session.state.clientRevision,
          });
        }
      }

      this.session.lastBackendSyncAt = this.clock.now();
    } catch (error) {
      const status = readErrorStatus(error);
      playbackLog(
        'playback.sync_failed',
        {
          mediaId: session.mediaId,
          status: status ?? undefined,
          revision: snapshotRevision,
        },
        'warn',
      );

      if (
        this.generation !== gen ||
        this.requireUserId() !== syncUserId ||
        !this.session
      ) {
        return;
      }

      if (status === 404) {
        // Media deleted remotely — discard pending for this media; do not recreate.
        deletePlaybackState(syncUserId, snapshot.mediaId);
        if (this.session.mediaId === snapshot.mediaId) {
          this.session.state = {
            ...this.session.state,
            pendingSync: false,
          };
          this.session.dirtyRemote = false;
        }
        playbackLog('playback.sync_stale_ignored', {
          mediaId: snapshot.mediaId,
          result: 'media_missing',
        });
        return;
      }

      if (status === 409) {
        playbackLog('playback.sync_conflict', {
          mediaId: snapshot.mediaId,
          revision: snapshotRevision,
        });
        // Keep local pending; next reconnect/reconcile will resolve.
        this.session.state = {
          ...this.session.state,
          pendingSync: true,
        };
        savePlaybackState(syncUserId, this.session.state);
        return;
      }

      this.session.state = {
        ...this.session.state,
        pendingSync: true,
      };
      savePlaybackState(syncUserId, this.session.state);

      // Do not hot-loop on auth failures.
      if (status === 401 || status === 403) {
        return;
      }

      playbackLog('playback.sync_retry_scheduled', {
        mediaId: snapshot.mediaId,
        status: status ?? undefined,
      });
    } finally {
      this.syncInFlight = false;
      if (this.pendingAfterFlight && this.generation === gen) {
        this.pendingAfterFlight = false;
        if (
          this.session?.dirtyRemote &&
          this.requireUserId() === syncUserId
        ) {
          void this.runRemoteSync({ force: true });
        }
      }
    }
  }
}
