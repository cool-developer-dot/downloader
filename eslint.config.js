// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Not JavaScript source: build output, the native trees (Kotlin — their `.ts` files are MPEG-TS video
    // fixtures) and other git worktrees of this repo that tools create under .claude/.
    ignores: ["dist/*", "**/build/**", "android/**", "ios/**", "modules/*/android/**", "modules/*/ios/**", ".claude/**"],
  },
  {
    // Node scripts run by npm (CommonJS already provides require/module/exports).
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: { __dirname: "readonly", __filename: "readonly" },
    },
  },
]);
