// `node --import ./scripts/test/register-app-modules.mjs --test ...` — see app-module-hooks.mjs.
import { register } from 'node:module';

// Metro defines __DEV__; diagnostics stay silent in tests unless VIDORAX_TEST_DIAG=1.
globalThis.__DEV__ = process.env.VIDORAX_TEST_DIAG === '1';

register('./app-module-hooks.mjs', import.meta.url);
