export type {
  MediaAuthMode,
  SessionMediaAccessClass,
  AuthLikeFailureKind,
  SessionMediaScope,
} from './types';

export {
  classifyAuthLikeFailure,
  classifyPostSessionFailure,
  isAuthLikeFailure,
  resolveAccessClassAfterFailure,
} from './auth-failure.classifier';
export type { AuthFailureInput } from './auth-failure.classifier';

export {
  SESSION_MEDIA_ALLOWED_HEADERS,
  SESSION_MEDIA_CONDITIONAL_HEADERS,
  SESSION_MEDIA_DENIED_HEADERS,
  isAllowedSessionMediaHeader,
  filterSessionMediaHeaders,
  stripSecretRequestHeaders,
} from './request-header-policy';

export {
  stripRequestContextSecrets,
  requestContextHasSecretHeaders,
} from './strip-secrets';

export {
  buildPublicMediaRequestContext,
  buildSessionCookieMediaRequestContext,
  buildSessionAwareMediaRequestContext,
} from './session-request-context';
export type { BuildSessionAwareContextInput } from './session-request-context';

export {
  evidenceImpliesSessionBound,
  shouldAttemptPublicFirst,
} from './session-bound-evidence';

export {
  planPublicFirstVerification,
  maybeBuildSessionRetryContext,
} from './public-first-verify';
export type { PublicFirstVerifyPlan } from './public-first-verify';

export { logSessionMedia } from './session-media-diagnostics';
export type { SessionMediaDiagEvent } from './session-media-diagnostics';
