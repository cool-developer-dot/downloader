/**
 * Week 8 Day 1 Phase 3 — Production file actions (mobile).
 *
 * This verifier is intentionally "static":
 * - It runs in Node (no Metro / no device / no native runtime).
 * - It asserts that code + Expo config contain the required building blocks.
 */
// Mobile project doesn't necessarily ship Node typings; keep this verifier
// type-safe enough for runtime by using `require()` and `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const workspaceRoot = path.join(__dirname, '..');

function read(relativePath: string): string {
  const full = path.join(workspaceRoot, relativePath);
  return fs.readFileSync(full, 'utf8');
}

function readJson(relativePath: string): unknown {
  const content = read(relativePath);
  return JSON.parse(content) as unknown;
}

// 1) Expo config should enable FileProvider-backed sharing for content:// URIs.
const appJson = readJson('app.json') as {
  expo?: { plugins?: unknown };
};
const plugins: unknown = appJson.expo?.plugins;
assert(Array.isArray(plugins), 'mobile/app.json must define expo.plugins');
const hasExpoFileSystemPlugin = (plugins as unknown[]).some((p: unknown) => {
  if (typeof p === 'string') return p === 'expo-file-system';
  if (Array.isArray(p) && typeof p[0] === 'string') return p[0] === 'expo-file-system';
  return false;
});
assert(
  hasExpoFileSystemPlugin,
  'Missing expo-file-system config plugin in mobile/app.json (needed for content:// FileProvider).',
);

// 2) Sharing/opening must use Android content URI (File.contentUri).
const fileActions = read('src/downloads/engine/file-actions.ts');
assert(
  fileActions.includes('contentUri') &&
    /Platform\.OS === 'android'[\s\S]*contentUri/.test(fileActions),
  'Expected file-actions.ts to convert Android URIs using File.contentUri.',
);
assert(
  !/from ['"]expo-file-system['"][\s\S]*getContentUriAsync|getContentUriAsync[\s\S]*from ['"]expo-file-system['"]/.test(
    fileActions,
  ) && !fileActions.includes('FileSystem.getContentUriAsync'),
  'file-actions.ts must not call deprecated FileSystem.getContentUriAsync.',
);

// 3) Central media-file-actions must enforce managed path safety and support rename/delete.
const mediaFileActions = read('src/downloads/engine/media-file-actions.ts');
assert(
  mediaFileActions.includes('assertManagedDownloadPath'),
  'Expected media-file-actions.ts to call assertManagedDownloadPath().',
);
assert(
  mediaFileActions.includes('.move(') || mediaFileActions.includes('moveAsync'),
  'Expected media-file-actions.ts to perform physical rename via File.move() (or legacy moveAsync).',
);

// 4) Local-only rename/delete live on media-file-actions (no cloud media.api).
assert(
  mediaFileActions.includes('renameMediaFileOnDevice') &&
    mediaFileActions.includes('deleteMediaFileOnDevice'),
  'Expected media-file-actions.ts to expose renameMediaFileOnDevice and deleteMediaFileOnDevice.',
);

console.log('PASS  week8-day1 phase3 static verifier');

