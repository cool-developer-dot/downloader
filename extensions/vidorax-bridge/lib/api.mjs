// VidoraX Bridge — talking to the paired phone. The pairing (address + token) lives in extension storage only.

import { browserName } from './core.mjs';

const STORAGE_KEY = 'pairing';

export class PhoneError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}

export async function loadPairing(storage) {
  const data = await storage.get(STORAGE_KEY);
  const pairing = data?.[STORAGE_KEY];
  return pairing && typeof pairing.origin === 'string' && typeof pairing.token === 'string' ? pairing : null;
}

export async function savePairing(storage, pairing) {
  await storage.set({ [STORAGE_KEY]: pairing });
}

export async function clearPairing(storage) {
  await storage.remove(STORAGE_KEY);
}

async function call(fetchImpl, origin, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetchImpl(`${origin}/api/v1/${path}`, init);
  } catch {
    throw new PhoneError(0, { error: 'unreachable' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PhoneError(response.status, data);
  return data;
}

/** Pairs with the PIN; returns the pairing to save. */
export async function pair(fetchImpl, origin, pin, userAgent) {
  const result = await call(fetchImpl, origin, 'POST', 'pair', { body: { pin, name: browserName(userAgent) } });
  return { origin, token: result.token, clientId: result.clientId };
}

export function addLink(fetchImpl, pairing, url) {
  return call(fetchImpl, pairing.origin, 'POST', 'downloads', { token: pairing.token, body: { url, source: 'extension' } });
}

export function linkStatus(fetchImpl, pairing, requestId) {
  return call(fetchImpl, pairing.origin, 'GET', `links/${encodeURIComponent(requestId)}`, { token: pairing.token });
}

export function unpair(fetchImpl, pairing) {
  return call(fetchImpl, pairing.origin, 'POST', 'unpair', { token: pairing.token, body: {} });
}

/** Sends [url] and waits (a little) for the phone's verdict. */
export async function sendAndWait(fetchImpl, pairing, url, { tries = 20, delayMs = 1500, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let request = await addLink(fetchImpl, pairing, url);
  for (let i = 0; i < tries && (request.status === 'checking' || request.status === 'waiting_for_app'); i += 1) {
    if (request.status === 'waiting_for_app') break;
    await wait(delayMs);
    request = await linkStatus(fetchImpl, pairing, request.requestId);
  }
  return request;
}
