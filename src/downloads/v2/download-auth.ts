/**
 * Authentication Support (#299): a server that answers a download with `401` and `WWW-Authenticate: Basic` gets the
 * user name and password the user types — for that one download only.
 *
 * - The probe reports the challenge (`ProbeResult.authChallenge`); only an `https://` origin may be sent anything.
 * - The credentials live in the sign-in dialog's own state and in the call that starts the download (enqueue, or
 *   `setDownloadCredentials` before Resume/Retry), never in a store, a log or storage. Native code keeps them in
 *   memory only, pinned to the download's origin, and never sends them back.
 * - After a process death (or a failure) a download started with sign-in asks again before Resume/Retry
 *   (`downloadNeedsCredentials`).
 *
 * The rules here are pure; the prompt itself is registered by the app (`DownloadSignInHost`).
 */

import type {
  AuthChallenge,
  DownloadCredentials,
  ProbeResult,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';

export const MAX_CREDENTIAL_LENGTH = 256;

/** Where the user signs in, as the dialog shows it. */
export type SignInRequest = { origin: string; realm: string | null };

/** Shows the sign-in dialog; resolves with what the user typed, or null for Cancel. */
export type SignInPrompt = (request: SignInRequest) => Promise<DownloadCredentials | null>;

let prompt: SignInPrompt | null = null;

/** The app's dialog registers itself here (and unregisters on unmount). */
export function setDownloadSignInPrompt(next: SignInPrompt | null): void {
  prompt = next;
}

/** A probe's Basic challenge, or null (a success, another refusal, an older native build). */
export function basicChallengeOf(result: ProbeResult | null | undefined): AuthChallenge | null {
  if (!result || result.ok) {
    return null;
  }
  const challenge = result.authChallenge;
  return challenge && challenge.scheme === 'basic' && typeof challenge.origin === 'string' ? challenge : null;
}

/** Credentials are only ever sent to an https origin. */
export function isSecureOrigin(originOrUrl: string | null | undefined): boolean {
  if (!originOrUrl) {
    return false;
  }
  try {
    return new URL(originOrUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/** `https://media.example.com:443` → `media.example.com` (what the dialog names). */
export function signInHost(origin: string): string {
  try {
    return new URL(origin).hostname || origin;
  } catch {
    return origin;
  }
}

export type CredentialsProblem = 'USERNAME_REQUIRED' | 'USERNAME_COLON' | 'TOO_LONG' | 'CONTROL_CHARACTERS';

/**
 * Pure: why these cannot be sent, or null. RFC 7617: a user-id has no colon; neither value may hold control characters
 * (native code checks the same and refuses with ERR_INVALID_REQUEST).
 */
export function credentialsProblem(username: string, password: string): CredentialsProblem | null {
  if (username.length === 0) {
    return 'USERNAME_REQUIRED';
  }
  if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) {
    return 'TOO_LONG';
  }
  if (username.includes(':')) {
    return 'USERNAME_COLON';
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(username) || /[\u0000-\u001f\u007f-\u009f]/.test(password)) {
    return 'CONTROL_CHARACTERS';
  }
  return null;
}

/** Shows the dialog for [request]; null when no dialog is registered or the user cancelled. */
export async function askForSignIn(request: SignInRequest): Promise<DownloadCredentials | null> {
  if (!prompt || !isSecureOrigin(request.origin)) {
    return null;
  }
  try {
    const answer = await prompt(request);
    if (!answer || credentialsProblem(answer.username, answer.password) != null) {
      return null;
    }
    return answer;
  } catch {
    return null;
  }
}

/**
 * Before Resume or Retry: a download started with sign-in whose credentials are gone (a process death, a failure)
 * asks for them again and hands them to native code. 'ready' when the action may go ahead (nothing needed, an older
 * native build, or the credentials were set); 'cancelled' when the user said no.
 */
export async function ensureDownloadSignIn(engine: V2EnginePort | null, id: string): Promise<'ready' | 'cancelled'> {
  if (!engine?.downloadNeedsCredentials || !engine.setDownloadCredentials) {
    return 'ready';
  }
  let needed: SignInRequest | null = null;
  try {
    needed = engine.downloadNeedsCredentials(id);
  } catch {
    needed = null;
  }
  if (!needed) {
    return 'ready';
  }
  const credentials = await askForSignIn(needed);
  if (!credentials) {
    return 'cancelled';
  }
  try {
    await engine.setDownloadCredentials(id, credentials);
  } catch {
    // Refused (invalid values): the action runs and fails with AUTH_REQUIRED, so Retry asks again.
  }
  return 'ready';
}
