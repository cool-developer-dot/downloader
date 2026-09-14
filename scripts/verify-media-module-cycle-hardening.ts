/**
 * Media module require-cycle hardening verifier.
 * Usage: npm run verify:media-module-cycle-hardening
 *
 * Builds a limited static import graph for the request-context / session-media /
 * browser-store / social-source subsystem and asserts it is acyclic.
 * No LogBox suppression, no dynamic require workarounds.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function resolveImport(fromRel: string, spec: string): string | null {
  if (spec.startsWith('.')) {
    const base = normalize(join(dirname(join(ROOT, fromRel)), spec));
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
      const candidate = base + ext;
      if (existsSync(candidate)) {
        return candidate.slice(ROOT.length + 1).replace(/\\/g, '/');
      }
    }
    return null;
  }
  if (spec.startsWith('@/')) {
    const base = join(ROOT, 'src', spec.slice(2));
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
      const candidate = base + ext;
      if (existsSync(candidate)) {
        return candidate.slice(ROOT.length + 1).replace(/\\/g, '/');
      }
    }
  }
  return null;
}

/** Collect runtime (non type-only) local imports. */
function runtimeImports(rel: string): string[] {
  const src = readSrc(rel);
  const edges: string[] = [];
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import ')) {
      continue;
    }
    if (/^import\s+type\b/.test(trimmed)) {
      continue;
    }
    // `import { type X, y }` — still runtime if any value import present.
    const match = trimmed.match(/from\s+['"]([^'"]+)['"]/);
    if (!match) {
      continue;
    }
    const resolved = resolveImport(rel, match[1]);
    if (
      resolved &&
      (resolved.includes('media-detection/') ||
        resolved.includes('browser/stores') ||
        resolved.includes('browser/session/desktop-mode-snapshot'))
    ) {
      edges.push(resolved);
    }
  }
  return [...new Set(edges)];
}

function findCycle(graph: Record<string, string[]>): string[] | null {
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  function dfs(u: string): string[] | null {
    color.set(u, 1);
    stack.push(u);
    for (const v of graph[u] ?? []) {
      if (!graph[v]) {
        continue;
      }
      const c = color.get(v) ?? 0;
      if (c === 1) {
        const idx = stack.indexOf(v);
        return stack.slice(idx).concat(v);
      }
      if (c === 0) {
        const found = dfs(v);
        if (found) {
          return found;
        }
      }
    }
    stack.pop();
    color.set(u, 2);
    return null;
  }

  for (const node of Object.keys(graph)) {
    if ((color.get(node) ?? 0) === 0) {
      const found = dfs(node);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

const FOCUS = [
  'src/media-detection/services/request-context.service.ts',
  'src/media-detection/session-media/session-request-context.ts',
  'src/media-detection/session-media/session-bound-evidence.ts',
  'src/media-detection/session-media/index.ts',
  'src/browser/stores/index.ts',
  'src/browser/stores/browserStore/index.ts',
  'src/browser/stores/browserStore/actions.ts',
  'src/media-detection/social-source/index.ts',
  'src/media-detection/social-source/social-source-reliability.service.ts',
  'src/media-detection/social-source/social-source-provider.ts',
  'src/media-detection/social-source/register-phase1-source-refresh.ts',
  'src/media-detection/social-source/verification-session.ts',
  'src/browser/session/desktop-mode-snapshot.ts',
];

async function main(): Promise<void> {
  const graph: Record<string, string[]> = {};
  for (const file of FOCUS) {
    graph[file] = runtimeImports(file).filter((e) =>
      FOCUS.some((f) => e === f || e.startsWith(dirname(f) + '/') || FOCUS.includes(e)),
    );
    // Keep edges that resolve to focus files only.
    graph[file] = runtimeImports(file).filter((e) => FOCUS.includes(e));
  }

  await test('1. request-context.service does not import browser store barrel', () => {
    const src = readSrc('src/media-detection/services/request-context.service.ts');
    assert(!src.includes("from '@/browser/stores'"), 'no browser/stores');
    assert(!src.includes('selectDesktopMode'), 'no selectDesktopMode re-export');
  });

  await test('2. request-context.service uses session-media leaves, not barrel', () => {
    const src = readSrc('src/media-detection/services/request-context.service.ts');
    assert(
      src.includes("from '../session-media/session-request-context'"),
      'leaf session-request-context',
    );
    assert(
      src.includes("from '../session-media/session-bound-evidence'"),
      'leaf session-bound-evidence',
    );
    assert(!/from ['"]\.\.\/session-media['"]/.test(src), 'no session-media barrel');
  });

  await test('3. session-request-context does not import browser store', () => {
    const src = readSrc(
      'src/media-detection/session-media/session-request-context.ts',
    );
    assert(!src.includes('@/browser/stores'), 'no browser stores');
    assert(
      src.includes('readDesktopModeForRequestContext'),
      'uses desktop snapshot accessor',
    );
  });

  await test('4. browserStore/actions imports social-source leaves, not barrel', () => {
    const src = readSrc('src/browser/stores/browserStore/actions.ts');
    assert(
      !/from ['"]@\/media-detection\/social-source['"]/.test(src),
      'no social-source barrel',
    );
    assert(
      src.includes('social-source/social-source-provider'),
      'provider leaf',
    );
    assert(
      src.includes('social-source/verification-session'),
      'verification leaf',
    );
  });

  await test('5. social-source reliability still imports request-context leaf', () => {
    const src = readSrc(
      'src/media-detection/social-source/social-source-reliability.service.ts',
    );
    assert(
      src.includes("from '../services/request-context.service'"),
      'request-context callable path',
    );
    assert(src.includes('buildRequestContextFromDetectedMedia'), 'API present');
  });

  await test('6. social-source provider still imports request-context leaf', () => {
    const src = readSrc(
      'src/media-detection/social-source/social-source-provider.ts',
    );
    assert(
      src.includes("from '../services/request-context.service'"),
      'request-context',
    );
    assert(src.includes('getFreshExecutableSocialSource'), 'provider export');
  });

  await test('7. Phase 1 source-refresh registration remains available', () => {
    const reg = readSrc(
      'src/media-detection/social-source/register-phase1-source-refresh.ts',
    );
    assert(reg.includes('ensurePhase1SocialSourceRefreshRegistered'), 'ensure fn');
    assert(reg.includes('buildMediaRequestContext'), 'uses request context');
    const host = readSrc('src/media-detection/components/MediaDetectionHost.tsx');
    assert(
      host.includes('ensurePhase1SocialSourceRefreshRegistered'),
      'host still registers',
    );
  });

  await test('8. request-context public APIs unchanged', () => {
    const src = readSrc('src/media-detection/services/request-context.service.ts');
    assert(src.includes('export async function buildMediaRequestContext'), 'async');
    assert(src.includes('export function buildMediaRequestContextSync'), 'sync');
    assert(
      src.includes('export async function buildRequestContextFromDetectedMedia'),
      'from detected',
    );
  });

  await test('9. desktop-mode-snapshot is dependency-neutral', () => {
    const src = readSrc('src/browser/session/desktop-mode-snapshot.ts');
    assert(
      !/from\s+['"][^'"]*browserStore/.test(src),
      'no browserStore import',
    );
    assert(
      !/from\s+['"][^'"]*social-source/.test(src),
      'no social-source import',
    );
    assert(
      !/from\s+['"][^'"]*request-context/.test(src),
      'no request-context import',
    );
    assert(src.includes('bindDesktopModeSnapshotReader'), 'bind');
    assert(src.includes('readDesktopModeForRequestContext'), 'read');
  });

  await test('10. browserStore binds desktop snapshot after create', () => {
    const src = readSrc('src/browser/stores/browserStore/index.ts');
    assert(src.includes('bindDesktopModeSnapshotReader'), 'binds reader');
    assert(src.includes('useBrowserStore.getState'), 'reads store');
  });

  await test('11. no LogBox suppression / lazy require cycle hacks in focus files', () => {
    const critical = [
      'src/media-detection/services/request-context.service.ts',
      'src/media-detection/session-media/session-request-context.ts',
      'src/browser/stores/browserStore/actions.ts',
      'src/browser/stores/browserStore/index.ts',
      'src/browser/session/desktop-mode-snapshot.ts',
    ];
    for (const file of critical) {
      const src = readSrc(file);
      assert(!src.includes('LogBox.ignoreLogs'), `${file} LogBox`);
      assert(!src.includes('YellowBox'), `${file} YellowBox`);
      assert(!/\brequire\s*\(\s*['"]/.test(src), `${file} require(`);
    }
  });

  await test('12. focused import graph is acyclic', () => {
    const cycle = findCycle(graph);
    assert(
      cycle == null,
      cycle ? `cycle: ${cycle.join(' → ')}` : 'acyclic',
    );
  });

  await test('13. request-context does not reach browserStore/actions in graph', () => {
    const seen = new Set<string>();
    const queue = [...(graph['src/media-detection/services/request-context.service.ts'] ?? [])];
    while (queue.length) {
      const n = queue.shift()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const e of graph[n] ?? []) queue.push(e);
    }
    assert(
      !seen.has('src/browser/stores/browserStore/actions.ts'),
      'no path to actions',
    );
    assert(
      !seen.has('src/browser/stores/browserStore/index.ts'),
      'no path to browserStore',
    );
    assert(
      !seen.has('src/media-detection/social-source/social-source-provider.ts'),
      'no path to social provider',
    );
  });

  await test('14. no duplicate request-context service module', () => {
    assert(
      existsSync(join(ROOT, 'src/media-detection/services/request-context.service.ts')),
      'single service',
    );
    assert(
      !existsSync(
        join(ROOT, 'src/media-detection/services/request-context.service.2.ts'),
      ),
      'no duplicate',
    );
  });

  await test('15. session-media barrel still exports builders (compat)', () => {
    const barrel = readSrc('src/media-detection/session-media/index.ts');
    assert(barrel.includes('buildPublicMediaRequestContext'), 'public');
    assert(barrel.includes('buildSessionCookieMediaRequestContext'), 'session');
  });

  await test('16. social-source barrel still exports Phase 4 APIs', () => {
    const barrel = readSrc('src/media-detection/social-source/index.ts');
    assert(barrel.includes('verifySocialSourceCandidate'), 'verify');
    assert(barrel.includes('getFreshExecutableSocialSource'), 'fresh');
    assert(barrel.includes('ensurePhase1SocialSourceRefreshRegistered'), 'register');
  });

  console.log(
    `\nMedia module cycle hardening: ${passed} passed, ${failed} failed`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

void main();
