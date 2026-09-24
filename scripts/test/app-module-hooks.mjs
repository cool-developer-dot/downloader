/**
 * Node module hooks that let `node --test` import app source the way Metro does: `@/` → src/, `@modules/` →
 * modules/, extensionless relative imports → `.ts` / `index.ts`. `react-native` and `expo` resolve to tiny stubs so
 * pure logic that only reads `Platform` or looks up an optional native module can run under Node. Registered by scripts/test/register-app-modules.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STUB_PREFIX = 'app-test-stub:';

const STUBS = new Map([
  [
    'react-native',
    // No native modules exist under Node: adapters that look them up see "not linked".
    `export const Platform = { OS: 'android', Version: 35, select: (spec) => ('android' in spec ? spec.android : spec.default) };
export const NativeModules = {};
let activeBackSubscriptions = 0;
export const BackHandler = {
  addEventListener: () => {
    activeBackSubscriptions += 1;
    let removed = false;
    return { remove: () => { if (!removed) { removed = true; activeBackSubscriptions -= 1; } } };
  },
  exitApp: () => {},
};
export const __activeBackSubscriptions = () => activeBackSubscriptions;`,
  ],
  [
    'expo',
    // Native Expo modules are never linked under Node: optional lookups resolve to null.
    `export const requireOptionalNativeModule = () => null;
export const requireNativeModule = (name) => { throw new Error(\`\${name} is not available under Node\`); };
export class NativeModule {}`,
  ],
]);

function existingFileUrl(base) {
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return pathToFileURL(candidate).href;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (STUBS.has(specifier)) {
    return { url: `${STUB_PREFIX}${specifier}`, shortCircuit: true };
  }
  let base = null;
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, 'src', specifier.slice(2));
  } else if (specifier.startsWith('@modules/')) {
    base = path.join(ROOT, 'modules', specifier.slice('@modules/'.length));
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const url = existingFileUrl(base);
    if (url) {
      return { url, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(STUB_PREFIX)) {
    return { format: 'module', source: STUBS.get(url.slice(STUB_PREFIX.length)), shortCircuit: true };
  }
  return nextLoad(url, context);
}
