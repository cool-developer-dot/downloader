/**
 * Node/tsx cannot parse Metro image assets. Stub binary image requires for
 * static verifiers that transitively import RN UI modules.
 */
import Module from 'node:module';

const g = globalThis as { __DEV__?: boolean };
if (typeof g.__DEV__ === 'undefined') {
  g.__DEV__ = false;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'] as const;

for (const ext of IMAGE_EXTS) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Module as any)._extensions[ext] = (module: NodeModule) => {
    // Numeric asset id stand-in (Metro style).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (module as any).exports = 1;
  };
}
