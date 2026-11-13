/**
 * B14 — builds the ad and tracker lists the app ships (modules/vidorax-web/android/src/main/assets/vidorax-blocklists/)
 * from local copies of EasyList and EasyPrivacy. It reads files only; it never downloads anything, and neither does
 * the app. Get the two files yourself (https://easylist.to/easylist/easylist.txt and easyprivacy.txt), read them as text,
 * then run:
 *
 *   node scripts/dev/generate-blocklists.mjs <easylist.txt> <easyprivacy.txt>
 *
 * Kept from each list (everything else — cosmetic rules, wildcards, rules limited to some sites — is dropped):
 * - `||host^`, optionally with `$third-party` and resource-type options only (script, image, xmlhttprequest, …): the
 *   whole host. The app ignores the type (it never blocks a page itself, nor video / audio / manifests, anyway).
 * - `||host/path…` with no options and no wildcard: that host (and its subdomains) when the path starts with it.
 * - A host a generic exception allows (`@@||host^`) is removed; a host already covered by a listed parent is dropped.
 * - Never: rules on the hosts video players load as code (PLAYER_CODE_HOSTS — Google's IMA ad SDK, JW Player and
 *   Flowplayer plugins). An empty answer there can stall a player before it requests its video, and the app's video
 *   detection must keep working with blocking on (media requests themselves are never blocked by the app anyway).
 *
 * Output lines: `host` or `host/path-prefix`, sorted. The lists are EasyList / EasyPrivacy material, used under
 * CC BY-SA 3.0 with attribution to "The EasyList authors (https://easylist.to/)" (LICENSE-blocklists.txt).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)';
const TYPES = '(?:third-party|3p|script|image|xmlhttprequest|subdocument|media|object|ping|other|stylesheet|font|websocket)';
const BLOCK_HOST = new RegExp(`^\\|\\|${HOST}\\^(?:\\$${TYPES}(?:,${TYPES})*)?$`);
const BLOCK_PATH = new RegExp(`^\\|\\|${HOST}(/[A-Za-z0-9/_.=?&%-]*)$`);
/** Hosts (and their subdomains) whose rules are never kept: code video players wait for. Exported for the test. */
export const PLAYER_CODE_HOSTS = ['imasdk.googleapis.com', 'jwpcdn.com', 'jwplatform.com', 'jwplayer.com', 'flowplayer.com'];

const isPlayerCode = (host) => PLAYER_CODE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

const ALLOW_HOST = new RegExp(`^@@\\|\\|${HOST}\\^(?:\\$(?:third-party|3p|document|all))?$`);

/** The rules of one list: { version, lines } with `lines` sorted. Exported for the test. */
export function extractRules(text) {
  let version = '';
  const hosts = new Set();
  const paths = new Map();
  const allowed = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.toLowerCase().startsWith('! version:')) {
      version = line.slice(line.indexOf(':') + 1).trim();
      continue;
    }
    let m = BLOCK_HOST.exec(line.toLowerCase());
    if (m) {
      hosts.add(m[1]);
      continue;
    }
    m = BLOCK_PATH.exec(line);
    if (m && m[2].length > 1 && m[1] === m[1].toLowerCase()) {
      const list = paths.get(m[1]) ?? new Set();
      list.add(m[2]);
      paths.set(m[1], list);
      continue;
    }
    m = ALLOW_HOST.exec(line.toLowerCase());
    if (m) allowed.add(m[1]);
  }
  const kept = new Set([...hosts].filter((h) => !allowed.has(h) && !isPlayerCode(h) && !/^[\d.]+$/.test(h)));
  const coveredByParent = (host) => {
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i += 1) {
      if (kept.has(parts.slice(i).join('.'))) return true;
    }
    return false;
  };
  const lines = [...kept].filter((h) => !coveredByParent(h));
  for (const [host, prefixes] of paths) {
    if (allowed.has(host) || isPlayerCode(host) || kept.has(host) || coveredByParent(host)) continue;
    for (const prefix of prefixes) lines.push(host + prefix);
  }
  lines.sort();
  return { version, lines };
}

function writeList(file, title, source, { version, lines }) {
  const header = [
    `# ${title} — from ${source} version ${version}, ${lines.length} rules.`,
    '# The EasyList authors (https://easylist.to/), CC BY-SA 3.0 — see LICENSE-blocklists.txt. Adapted: whole-host and',
    '# plain path-prefix rules only (scripts/dev/generate-blocklists.mjs). One rule per line: host or host/path-prefix.',
  ];
  fs.writeFileSync(file, `${header.join('\n')}\n${lines.join('\n')}\n`);
  return { file: path.basename(file), rules: lines.length, bytes: fs.statSync(file).size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [easylist, easyprivacy] = process.argv.slice(2);
  if (!easylist || !easyprivacy) {
    console.error('Usage: node scripts/dev/generate-blocklists.mjs <easylist.txt> <easyprivacy.txt>');
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out = path.join(root, 'modules', 'vidorax-web', 'android', 'src', 'main', 'assets', 'vidorax-blocklists');
  fs.mkdirSync(out, { recursive: true });
  const ads = extractRules(fs.readFileSync(easylist, 'utf8'));
  const trackers = extractRules(fs.readFileSync(easyprivacy, 'utf8'));
  // A tracker host that is also on the ad list stays on both (each switch works alone).
  console.log(writeList(path.join(out, 'ads.txt'), 'VidoraX ad list', 'EasyList', ads));
  console.log(writeList(path.join(out, 'trackers.txt'), 'VidoraX tracker list', 'EasyPrivacy', trackers));
}
