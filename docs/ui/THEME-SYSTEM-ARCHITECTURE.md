# VidoraX Theme System Architecture

## 1. Requirements

VidoraX supports three user-selectable themes:

| Mode | Role |
|------|------|
| **LIGHT** | Default — **neutral white / near-white** application |
| **LOGO** | Brand-red chrome (header + bottom nav) on **neutral white/light** content |
| **DARK** | Private-app **BLACK + CHARCOAL + WHITE + GRAY** (no olive/sage brand; no Logo-red chrome) |

Theme is presentation-only. It must not mutate downloads, WebView page content, or App Lock security state.

## 2. Reference-image interpretation

Client MPlayer screenshots are **color-scheme references only**.

Do **not** copy MPlayer text, logo, layouts, typography, icons, or navigation.

Interpret as:

- strong clean red brand treatment for Logo theme chrome
- light/white main content with red accents
- VidoraX keeps its own UI structure

## 3. Canonical brand red

| Field | Value |
|-------|--------|
| HEX | `#DC3C2C` |
| RGB | `220, 60, 44` |
| Source asset | `mobile/assets/logos/vidorax-logo.png` |
| Module | `src/theme/colors.ts` → `brandPalette` |

Variants (derived, not competing brand reds):

| Token | HEX | Role |
|-------|-----|------|
| pressed | `#C43426` | `headerBorder`, `bottomNavBorder`, pressed chrome |
| muted | `#F2A39C` | `primaryLight`, soft accents |
| soft | `#FCE8E6` | `brandRedSoft` — subtle brand-tinted surfaces |
| onBrand | `#FFFFFF` | `headerText`, `headerIcon`, `bottomNavActive`, `textOnPrimary` on brand fills |

Error red `#EF4444` remains a **semantic error** token, not Logo brand red.

## 4. ThemeMode model

```ts
ThemePreference = 'light' | 'logo' | 'dark'
ThemeMode = ThemePreference // 1:1 — no OS takeover
```

Legacy stored `system` → `light`.

## 5. Semantic token contract

Authoritative tokens live on `colors.light | colors.logo | colors.dark` in `src/theme/colors.ts`.

Includes: background/backgroundSecondary/surface/surfaceElevated/card, sheet/dialog/menu/input backgrounds, text*, primary*, header*, bottomNav*, border/divider/overlay, status colors, statusBarStyle.

Screens consume `useTheme().colors.*` — not raw palette literals.

## 6. Raw palette vs semantic mapping

Internal `palette` → semantic themes:

- Light/Logo content: `neutralWhite` / `neutralBg` / `neutralBorder`
- Logo chrome: `headerBackground` / `bottomNavBackground` = `brandRed`
- Dark private app: neutral black/charcoal surfaces; off-white primary — see **§ DARK THEME FINAL NEUTRAL CONTRACT**
- Olive/sage raw literals: palette reservoir / native static splash only — **not** mapped into React intro/onboarding
- Light: **no sage/green brand identity** — see **§ LIGHT THEME FINAL NEUTRAL CONTRACT**

## 7. LIGHT definition

**Neutral white / black / gray application** (client: “white screen theme”).

- background `#FFFFFF`; `backgroundSecondary` `#FAFAFA`
- surface/card/header/bottomNav/sheet/dialog/menu/input → `#FFFFFF`
- text primary `#171717`, secondary `#6B7280`
- borders `#E5E5E5` / `#EEEEEE`
- generic primary / accent / link / nav active → dark ink `#171717` (not sage/green)
- success green `#16A34A` — **semantic only** (completed/positive status)

Full token contract: **§ LIGHT THEME FINAL NEUTRAL CONTRACT**

## 8. LOGO definition

- chrome (header + bottom nav) → `#DC3C2C`
- main content / cards → same neutral white/light as Light
- actions/accents → brand red
- body text → dark readable (not global red)

## 9. DARK definition

Private-app **BLACK + CHARCOAL + WHITE + GRAY**. Generic primary is off-white `#F5F5F5`. Olive/sage appear **only** in documented Dark intro/onboarding allowlists — not in private-app chrome. **No** Logo-red navigation.

Full token contract: **§ DARK THEME FINAL NEUTRAL CONTRACT**

## LIGHT THEME FINAL NEUTRAL CONTRACT

**Rationale.** Light mode must read as a clean, premium **WHITE + BLACK + GRAY** application. Sage/olive/green are **not** Light brand identity. Green appears in Light **only** through semantic `success` (completed/positive status). Generic interaction styling uses dark neutral ink — never success green.

Authoritative implementation: `src/theme/colors.ts` → `colors.light`.

### Identity

| Axis | Light contract |
|------|----------------|
| Surfaces | White / very light neutral gray |
| Text & controls | Black / very dark neutral ink |
| Secondary | Neutral gray |
| Semantic only | `success` green, `error` red, `warning` amber, `info` blue |

**NOT Light:** sage `#ACC8A2`, olive tints, green branding, cream-green surfaces (`#F4F7F2`, `#EEF2EA`).

### Final Light tokens

| Token | HEX | Role |
|-------|-----|------|
| `background` | `#FFFFFF` | Root / screen background |
| `backgroundSecondary` | `#FAFAFA` | Secondary sections |
| `surface` / `card` / `sheetBackground` / `dialogBackground` / `menuBackground` / `inputBackground` | `#FFFFFF` | Elevated surfaces |
| `surfacePressed` | `#F5F5F5` | Pressed neutral surface |
| `surfaceSelected` | `#F3F4F6` | Selected row/chip background |
| `textPrimary` | `#171717` | Titles, body |
| `textSecondary` | `#6B7280` | Metadata, subtitles |
| `textMuted` | `#737373` | Muted / placeholder-adjacent |
| `textDisabled` | `#A3A3A3` | Disabled copy |
| `border` | `#E5E5E5` | Card/row borders |
| `divider` | `#EEEEEE` | Section dividers |
| `primary` | `#171717` | Generic action — **NOT** success green |
| `primaryLight` | `#F3F4F6` | Muted primary surface |
| `primaryDark` | `#111111` | Pressed/emphasis primary |
| `textOnPrimary` | `#FFFFFF` | Label on dark primary fills |
| `accent` / `link` / `headerIcon` / `bottomNavActive` | `#171717` (ink) | Active controls, links, nav |
| `headerBackground` / `bottomNavBackground` | `#FFFFFF` | Navigation chrome |
| `success` | `#16A34A` | Semantic only — completed/positive |
| `error` | `#EF4444` | Semantic destructive |
| `warning` | `#D97706` | Semantic caution |

### Generic primary vs semantic success

| Role | Light token | Must not conflate with |
|------|-------------|------------------------|
| Generic button / tab / checkbox / switch ON / progress active | `primary` (ink) | `success` |
| Completed download / verified / saved | `success` | `primary` |
| Delete / destructive | `error` | `primary`, brand red |

### Selected-state policy

- Selected background → `surfaceSelected` (`#F3F4F6`)
- Selected icon / text / tab / radio / checkbox fill → ink (`primary` / `#171717`)
- **No** green selected-state identity in Light

### Navigation policy

| Element | Light |
|---------|-------|
| Header background | `#FFFFFF` |
| Header title / icons | `#171717` |
| Header border | `#EEEEEE` (`divider`) |
| Bottom nav background | `#FFFFFF` |
| Active tab icon + label | `#171717` |
| Inactive tab icon + label | `#6B7280` |
| Tab indicator / segmented selected | Dark neutral ink |

### Button policy

| Variant | Light |
|---------|-------|
| Primary (Download, Continue, Save, …) | `primary` fill + `textOnPrimary` |
| Secondary | White surface + neutral border + dark text |
| Destructive | `error` semantic — not brand red |
| Success-only actions | `success` only when action genuinely means success |

### Input policy

- Background `#FFFFFF`; text `#171717`; placeholder `#737373`
- Border `#E5E5E5`; focused border ink `#171717`
- Cursor / selection → dark neutral; **no** green focus ring

### Settings policy

- Screen / row / card backgrounds → white
- Section titles / row titles → `textPrimary`
- Descriptions / chevrons → gray
- Appearance selector: selected Light segment → dark neutral fill + white label; unselected → white + dark text
- Icons → dark neutral unless semantic status

### Browser policy

VidoraX-owned chrome only (header, address bar, toolbar, tab switcher, overflow, CTA shell):

- White backgrounds; black/gray icons and URL text
- Selected browser tab → neutral dark emphasis
- **No** CSS injection, WebView reload, or page DOM changes on theme switch

### Downloads policy

- Cards / screen → white; filename → black; metadata → gray
- Active progress fill → ink (`primary`) — **not** green
- `COMPLETED` → `success` green; `FAILED` → `error` red; `WAITING_FOR_WIFI` → `warning`/`info` as appropriate
- Paused / queued / downloading → neutral dark or gray

### App Lock policy

- All flows (lock, setup, forgot, change PIN, rotate recovery, disable) → white/black/gray
- PIN dots, keypad, normal buttons → ink
- Errors → semantic `error`; throttle messaging → neutral or error as appropriate
- **No** sage PIN dots, green links, or green focus on lock surfaces
- Security logic (PIN, recovery, throttle, SecureStore) unchanged — visual only

### System UI policy (Light)

| Surface | Contract |
|---------|----------|
| StatusBar background | `colors.light.background` (`#FFFFFF`) |
| StatusBar icons | `statusBarStyle: 'dark'` |
| Android navigation bar | Light background; dark system icons (`NavigationBar.setStyle('light')`) |
| `Appearance.setColorScheme` | `'light'` (shared with Logo) |

### Green / sage allowlist

Green/sage may appear in Light **only** in these documented exceptions:

| Class | Allowed in Light? | Examples |
|-------|-------------------|----------|
| Semantic `success` | Yes | Completed download, success snackbar, verified badge |
| Dark private-app accents | No | Private Dark uses off-white primary — not sage |
| Dark intro allowlist | No (intro-only) | `DARK_INTRO`, `DARK_ONBOARDING_ALLOWLIST` |
| External brand artwork | Yes (fixed artwork) | YouTube `#FF0000`, platform orbit icons |
| Video scrims | Yes (fixed black) | `rgba(0,0,0,…)` over video — media contrast |

### Logo regression protection

Logo theme is **unchanged** by Light neutralization:

- Canonical brand red `#DC3C2C` — **unchanged**
- Header + bottom nav → brand red; content → shared light neutrals
- Logo `primary` / `link` / active nav → brand red (independent of Light ink mapping)

### Dark regression protection

Dark theme is **unchanged** by Light neutralization work that preceded this contract; Dark private-app tokens were later neutralized separately (see **§ DARK THEME FINAL NEUTRAL CONTRACT**). Light must not pick up olive/sage from Dark intro allowlists.

### Contrast (re-measured after neutralization)

Measured via `src/theme/contrast.ts` on white background + ink primary. **NOT WCAG certified** — design-time audit only. Ratios updated after Light neutralization (`background` `#FFFFFF`, `primary` `#171717`).

| Pair | Ratio | Assessment |
|------|-------|------------|
| `textPrimary` / `background` | **17.93** | Strong body contrast |
| `textSecondary` / `background` | **4.83** | Meets normal-text floor |
| `textMuted` / `background` | **4.74** | Meets normal-text floor |
| `textOnPrimary` / `primary` | **17.93** | Strong CTA contrast |
| `bottomNavActive` / `bottomNavBackground` | **17.93** | Active nav readable |
| `bottomNavInactive` / `bottomNavBackground` | **4.83** | Inactive nav readable |
| `link` / `background` | **17.93** | Link readable |
| `error` / `background` | **3.76** | Large/UI semantic error |
| `success` / `background` | **3.30** | Status text floor (large/UI); prefer icons+label pairing for body |
| `warning` / `background` | **3.19** | Status text floor (large/UI); prefer icons+label pairing for body |
| `textPrimary` / `surfaceSelected` | **16.29** | Selected row text |
| `textMuted` / `inputBackground` (placeholder) | **4.74** | Placeholder readable |

## DARK THEME FINAL NEUTRAL CONTRACT

**Rationale.** Private-app Dark mode must read as a clean, modern **BLACK + CHARCOAL + WHITE + GRAY** Android application. Olive/sage/dark-green are **not** Dark brand identity for the private app. Green appears in Dark **only** through semantic `success`. Generic interaction styling uses off-white primary — never success green, never sage, never Logo red.

**Intro continuity.** Splash, onboarding, and auth-stack surfaces follow the **selected** theme for LIGHT / LOGO / DARK. Dark intro uses the same neutral private-app Dark tokens (`colors.dark`) — **not** olive/sage. `DARK_ONBOARDING_ALLOWLIST` is now a sync alias of those Dark tokens for docs/verifiers.

Authoritative implementation: `src/theme/colors.ts` → `colors.dark`.

### Identity

| Axis | Dark private-app contract |
|------|---------------------------|
| Surfaces | Near-black / charcoal neutrals |
| Text & controls | White / off-white |
| Secondary | Neutral gray |
| Semantic only | `success` green, `error` red, `warning` amber, `info` |

**NOT private Dark:** olive `#1A2517`, sage `#ACC8A2`, green branding, Logo-red chrome.

### Final Dark tokens

| Token | HEX | Role |
|-------|-----|------|
| `background` | `#0D0D0D` | Root / screen background |
| `backgroundSecondary` | `#141414` | Secondary sections |
| `surface` / `card` / `sheetBackground` / `dialogBackground` / `inputBackground` | `#181818` | Cards / fields / sheets |
| `surfaceElevated` / `menuBackground` | `#1F1F1F` | Elevated / menus |
| `surfacePressed` | `#262626` | Pressed |
| `surfaceSelected` | `#242424` | Selected row/chip |
| `textPrimary` | `#F5F5F5` | Titles, body |
| `textSecondary` | `#B3B3B3` | Metadata |
| `textMuted` | `#8A8A8A` | Muted / placeholder-adjacent |
| `textDisabled` | `#666666` | Disabled |
| `border` | `#2A2A2A` | Borders |
| `divider` | `#242424` | Dividers |
| `primary` | `#F5F5F5` | Generic action — **NOT** sage/success |
| `primaryLight` | `#262626` | Muted primary surface |
| `primaryDark` | `#FFFFFF` | Stronger light primary |
| `textOnPrimary` | `#171717` | Label on light primary fills |
| `accent` / `link` / `headerIcon` | `#F5F5F5` | Active controls, links |
| `headerBackground` / `bottomNavBackground` | `#0F0F0F` | Navigation chrome |
| `bottomNavActive` | `#FFFFFF` | Active tab |
| `bottomNavInactive` | `#8A8A8A` | Inactive tab |
| `bottomNavBorder` | `#262626` | Nav top border |
| `success` / `error` / `warning` | `#16A34A` / `#EF4444` / `#D97706` | Semantic only |

### Generic primary vs semantic success

| Role | Dark token | Must not conflate with |
|------|------------|------------------------|
| Generic button / tab / checkbox / switch ON / progress active | `primary` (off-white) | `success` |
| Completed download / verified / saved | `success` | `primary` |
| Delete / destructive | `error` | `primary`, brand red |

### Selected-state / navigation / controls

- Selected background → `surfaceSelected` (`#242424`); selected icon/text/tab/radio/checkbox → white/off-white
- Header/bottom nav → `#0F0F0F`; active white; inactive gray; **no** sage/green/Logo-red
- Switch ON / checkbox / radio / focus → neutral light/dark contrast via Paper `primary` (off-white)
- Inputs: charcoal `#181818`, light text, gray placeholder, light-neutral focus

### Browser / Downloads / App Lock / Player

- Browser chrome only (no webpage CSS / WebView remount)
- Download active progress → `primary` (light); COMPLETED → `success`; FAILED → `error`
- App Lock → neutral dark + semantic error; security logic unchanged
- Player app-owned panels charcoal; video scrims may remain black

### System UI (Dark)

| Surface | Contract |
|---------|----------|
| StatusBar | `colors.dark.background` / chrome; `statusBarStyle: 'light'` |
| Android navigation bar | Dark background; light system icons |
| `Appearance.setColorScheme` | `'dark'` |

### Olive / sage allowlist (Dark)

| Class | Allowed in private Dark app? | Notes |
|-------|------------------------------|-------|
| Semantic `success` | Yes | Completed / success status |
| Dark intro allowlist | Intro only | `DARK_INTRO`, `DARK_ONBOARDING_ALLOWLIST` |
| External brand artwork | Yes (fixed) | Platform icons |
| Video scrims | Yes | Black overlays over video |
| Sage as `colors.dark.primary` | **No** | Removed from private app |

### Contrast (Dark private app — re-measured)

**NOT WCAG certified.** Measured via `src/theme/contrast.ts`.

| Pair | Ratio |
|------|-------|
| `textPrimary` / `background` | **17.83** |
| `textSecondary` / `background` | **9.27** |
| `textMuted` / `background` | **5.63** |
| `textOnPrimary` / `primary` | **16.44** |
| `bottomNavActive` / `bottomNavBackground` | **19.17** |
| `bottomNavInactive` / `bottomNavBackground` | **5.55** |
| placeholder / input | **5.14** |
| input text / input | **16.29** |
| selected text / `surfaceSelected` | **14.24** |
| `link` / `background` | **17.83** |
| `error` / `surface` | **4.72** |
| `success` / `surface` | **5.39** |
| `warning` / `surface` | **5.57** |

### Light / Logo regression protection

- Light remains white/black/gray; `primary` `#171717`
- Logo remains `#DC3C2C` chrome; light content; dark body text
- Dark primary becoming off-white must **not** turn Logo primary white

## 10. Startup / hydration

1. Zustand theme store rehydrates from persist storage  
2. `merge` normalizes preference (`system`/invalid → `light`)  
3. Bootstrap syncs MMKV + `Appearance.setColorScheme`  
4. Native/app splash stays until fonts + bootstrap ready  
5. First themed React surface uses hydrated preference  

Storage read failure → LIGHT; app continues.

## 11. First-time default

`initialThemeState.themeMode = 'light'`. Never OS dark as first-install authority.

## 12. Persistence

Persist mode only (Zustand + MMKV). Optimistic UI; write failure non-blocking. Invalid/missing → LIGHT.

## 13. Root provider integration

`AppProvider` mounts Paper + Navigation theme + StatusBar. Root background defaults to `colors.light.background` (`#FFFFFF`).

## 14. React Native Paper

`createPaperTheme(mode)` from the same semantic tokens.

## 15. Navigation theme

Stack headers use `header*`; tabs use `bottomNav*`. Full per-mode mapping: **§24**.

## 16. Settings integration

Existing Settings → Appearance → **Light | Logo | Dark**.

## 17. Intro policy

| Preference | Intro |
|------------|-------|
| LIGHT | Neutral white/light via `resolveIntroColors` / `resolveOnboardingSurfaces` |
| LOGO | White/light + brand-red accents |
| DARK | Neutral private-app Dark tokens (`colors.dark`) — no olive/sage, no forced red |

Onboarding UI uses `useOnboardingSurfaces()` (provider on `OnboardingScreen`). Deprecated `*_COLORS` constants are dark-allowlist fallbacks only.

## 18. Browser policy

Theme VidoraX chrome only. Do not inject CSS into websites.

## 19. Download isolation

Theme modules do not import download worker/scheduler/engine.

## 20. App Lock isolation

Visual theme only; SecureStore / PIN / recovery / throttle untouched.

## 21. Phase 1 migrated surfaces

Core foundation (Phase 1):

- Semantic tokens in `src/theme/colors.ts` (`light` / `logo` / `dark`)
- Theme store + MMKV persistence + `Appearance.setColorScheme` bootstrap
- Root providers (`AppProvider`, Paper, Navigation, StatusBar)
- Settings → Appearance (`Light | Logo | Dark`)
- Tab bar + stack header token wiring
- Splash / onboarding surface resolution (`resolveIntroColors`, `useOnboardingSurfaces`)
- Home, Settings shell, core navigation chrome

## 22. Phase 2 completion scope

Phase 2 completes long-tail migration and hardening without changing theme semantics:

| Area | Phase 2 work |
|------|----------------|
| **Brand / chrome** | Canonical `#DC3C2C` + variants; `headerBorder` / `headerSubtitle` tokens; remove scattered `theme.mode === 'logo'` ternaries from shared headers |
| **Navigation** | Full `header*` / `bottomNav*` / `link` mapping across App + Browser chrome |
| **Long-tail screens** | Downloads detail, quality rows, Library/Favorites/History/Bookmarks, legal/support, Storage, Download settings |
| **Browser** | Tab switcher, overflow menu, toolbar — theme chrome only; WebView not keyed on theme |
| **Player** | App-owned chrome + resume sheet; video scrims remain fixed black |
| **App Lock** | All Phase 1 + Phase 2 flows (`lock`, `setup`, `forgot`, `change-pin`, `rotate-recovery`, `disable`) use `theme.colors.*` |
| **Primitives** | Dialogs (`AppModal`, `ConfirmModal`), sheets (`BottomSheet`, `ActionSheetModal`), empty/loading/error, `Badge`, `SegmentedControl` |
| **Hardcoded cleanup** | Quality badge amber → `withAlpha(theme.colors.warning, …)`; dead `APP_LOCK_BOOTSTRAP_BG` removed |
| **Contrast audit** | `src/theme/contrast.ts` + measured ratios in verifier (`P2-251`–`P2-263`) |
| **Verifier** | `scripts/verify-theme-system.ts` — **282** static assertions (≥260 Phase 2 target) |

Static verifier: `npm run verify:theme-system` → **PASS**. Runtime Android acceptance: **NOT_TESTED** (see acceptance doc).

## 23. Logo text hierarchy

Logo mode applies brand red to **chrome and actions**, not global body copy.

| Element | Token / rule | Logo behavior |
|---------|--------------|---------------|
| Screen / header titles | `headerText` | White on brand-red chrome (`onBrandRed`) |
| Body / metadata | `textPrimary`, `textSecondary` | Dark neutral (`#171717` / `#6B7280`) — same as Light content |
| Selected tabs / primary buttons | `primary`, `textOnPrimary` | Brand red fill + white label |
| Links | `link` | Brand red (`#DC3C2C`) |
| Errors / destructive | `error` | Semantic `#EF4444` — **not** brand red |
| Success / warning / info | `success`, `warning`, `info` | Semantic status colors unchanged |

Rule: titles on red chrome are white; titles in content areas use `textPrimary`; never make all body text brand red.

## 24. Navigation token mapping

Authoritative navigation tokens on `colors[mode]`:

| Token | Light | Logo | Dark |
|-------|-------|------|------|
| `headerBackground` | `#FFFFFF` | `#DC3C2C` | `#0F0F0F` |
| `headerText` | `#171717` | `#FFFFFF` | `#F5F5F5` |
| `headerIcon` | ink `#171717` | `#FFFFFF` | `#F5F5F5` |
| `headerBorder` | `#EEEEEE` | `#C43426` (pressed) | `#242424` |
| `headerSubtitle` | `textSecondary` | `rgba(255,255,255,0.72)` | `#B3B3B3` |
| `bottomNavBackground` | `#FFFFFF` | `#DC3C2C` | `#0F0F0F` |
| `bottomNavActive` | ink `#171717` | `#FFFFFF` | `#FFFFFF` |
| `bottomNavInactive` | `#6B7280` | `rgba(255,255,255,0.72)` | `#8A8A8A` |
| `bottomNavBorder` | `#EEEEEE` | `#C43426` | `#262626` |
| `link` | ink `#171717` | brand red | `#F5F5F5` |

Consumers: `screen-options.ts`, `tab-bar-options.ts`, `AppHeader`, `BrowserHeader`, `BrowserToolbar`, `ToolbarButton`, `ReloadStopButton`.

Components must read tokens directly — **no** `theme.mode === 'logo'` branches when tokens already encode per-mode values.

## 25. Dark isolation policy

Dark private app is a **neutral black/charcoal** application (see **§ DARK THEME FINAL NEUTRAL CONTRACT**). Logo brand red must **never** leak into Dark chrome. Olive/sage must **not** define private-app Dark chrome (intro allowlist only).

| Check | Dark value | Must not be |
|-------|------------|-------------|
| `headerBackground` | `#0F0F0F` | `#DC3C2C`, `#1A2517` |
| `bottomNavBackground` | `#0F0F0F` | brand red, olive card |
| `headerBorder` | `#242424` | `brandRedPressed`, olive |
| `link` / `primary` | `#F5F5F5` | brand red, sage `#ACC8A2` |
| Onboarding | `DARK_ONBOARDING_ALLOWLIST` cinematic olive | forced Logo red **or** private-app Dark tokens |

Verifier groups **G** + **AC** + **DN** + **P2-225** enforce isolation.

## 26. Light consistency policy

Light mode is a **neutral white / black / gray** application — not sage-washed.

| Surface | Token | Value |
|---------|-------|-------|
| `background` | white | `#FFFFFF` |
| `backgroundSecondary` | near-white | `#FAFAFA` |
| `surface` / `card` / headers / nav / sheets / dialogs / menus / inputs | white | `#FFFFFF` |
| `textPrimary` | ink | `#171717` |
| `border` / `divider` | neutral gray | `#E5E5E5` / `#EEEEEE` |
| `primary` / nav active / links / header icons | ink | `#171717` |
| `success` | semantic only | `#16A34A` |

Legacy sage-tinted surfaces (`#F4F7F2`, `#EEF2EA`) and sage primary (`#ACC8A2`) are **not** Light mode tokens. Full contract: **§ LIGHT THEME FINAL NEUTRAL CONTRACT**. Verifier groups **AA** + **H** + **LN** enforce consistency.

## 27. Hardcoded-color classification (A–G)

Static audit taxonomy used by `verify-theme-system.ts` and Phase 2 cleanup:

| Class | Meaning | Enforcement |
|-------|---------|-------------|
| **A** | Three canonical modes exist (`light`, `logo`, `dark`) in `colors` + `themes` | Groups A, A13–A15 |
| **B** | Preference normalization (`system`/invalid → `light`; no OS takeover) | Groups B, P2-266–267 |
| **C** | Brand palette centralized (`#DC3C2C` + variants in `brandPalette`) | Groups C, P2-213–216 |
| **D** | Logo **chrome** is brand red (header + bottom nav) | Groups D, AB199 |
| **E** | Logo **content** surfaces stay light (shared with Light) | Groups E, AB197–198 |
| **F** | Logo **body text** stays dark readable (not brand red) | Groups F, AB200 |
| **G** | Dark chrome is **not** brand red | Groups G, AC201–202 |

Additional policy (post-migration):

- `#DC3C2C` only in `src/theme`, graphics, HeroEcosystem allowlist (**P2-245**)
- `#FF0000` only in external platform brand graphics (**P2-246**)
- No `theme` / `colorScheme` key on `BrowserWebView` (**P2-235**)

## 28. Screen inventory matrix

Static column = `verify-theme-system` + token migration audit. Manual = real Android device (not run for this workstream).

| Screen | LIGHT | LOGO | DARK | Hardcoded audit | Manual test | Notes |
|--------|-------|------|------|-----------------|-------------|-------|
| Splash | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `resolveIntroColors`; Dark uses cinematic allowlist |
| Onboarding | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `OnboardingSurfacesProvider`; Dark olive allowlist |
| Home | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `home-layout` tokens |
| Browser | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Chrome only; WebView content untouched |
| Browser tab switcher | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `BrowserTabSwitcher` + overlay token |
| Browser menus | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `BrowserOverflowMenu` |
| Downloads list | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `downloads-tokens` |
| Download detail | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `DownloadDetailsScreen` |
| Library | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `library-tokens` |
| Favorites | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `favorites-tokens` |
| History | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `history-tokens` |
| Bookmarks | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `bookmarks-tokens` |
| Settings | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `settings-tokens` |
| Appearance | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `AppearanceSection` 3-way segmented control |
| Download settings | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Shares settings token pattern |
| Storage | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Settings-adjacent screen |
| About | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Legal stack |
| Privacy | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Legal stack |
| Terms | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Legal stack |
| Support | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Legal / support stack |
| Report problem | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Diagnostics allowlist unchanged |
| Player | PASS (static) | PASS (static) | PASS (static) | allowlist scrims | NOT_TESTED | Video scrims fixed `rgba(0,0,0,…)` |
| Playlist / resume sheet | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `ResumePlaybackSheet` uses `overlay` token |
| App Lock — lock | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `AppLockScreen` / `AppLockGate` |
| App Lock — forgot | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `AppLockForgotFlow` |
| App Lock — setup | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `AppLockSetupScreen` |
| App Lock — change PIN | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Phase 2 route |
| App Lock — rotate recovery | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Phase 2 route |
| App Lock — disable | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Phase 2 route |
| Dialogs | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `AppModal`, `ConfirmModal` |
| Sheets | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `BottomSheet`, `ActionSheetModal` |
| Snackbars / toasts | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | Toast surfaces use semantic tokens |
| Empty / loading / error | PASS (static) | PASS (static) | PASS (static) | A–G | NOT_TESTED | `EmptyState`, `Badge`, shared feedback |

## 29. Browser / WebView isolation

- Theme applies to **VidoraX-owned chrome** (header, toolbar, tab switcher, overflow menu, download bar shell).
- **No CSS injection** into loaded pages.
- **No WebView remount** on theme change: `BrowserWebView` has no `key={theme…}` (**P2-235**).
- Tab URL, history, and page DOM survive live theme switches (runtime acceptance **TEST G**, **TEST H**).

## 30. Download runtime isolation

- Theme modules do not import download worker / scheduler / engine (**P2-236**).
- Theme preference changes do not pause, cancel, retry, or restart downloads.
- Download UI (list, detail, quality picker) uses semantic tokens; engine state is independent.

## 31. Player isolation

- Video pixels and playback session are not restarted by theme changes.
- App-owned chrome (controls, top bar, sheets) follows active theme.
- **Intentional fixed scrims** over video (`PlayerScreen`, `PlayerTopBar`, `SeekFeedback`) stay `rgba(0,0,0,…)` for media contrast regardless of theme.

## 32. App Lock isolation

- Theme is **visual only** — PIN, recovery, throttle, SecureStore payloads unchanged (**P2-237**).
- All lock / setup / forgot / change-pin / rotate-recovery / disable screens use `theme.colors.background` and related tokens (**P2-240**).
- Throttle counters and lock state must not reset on theme switch (runtime **TEST N**).

## 33. Persistence hardening

Dual-write, optimistic, fail-open:

1. **Zustand persist** — key `storageKeys.themePreference`; `merge` normalizes via `normalizeThemePreference`
2. **MMKV** — `vidorax.mmkv.theme.mode` (`mmkvKeys.themeMode`) synced on every `setTheme`
3. **Bootstrap** — `app-initializer.ts` re-normalizes store + MMKV + `applyNativeColorScheme`

| Input | Result |
|-------|--------|
| missing / empty / corrupt | `light` |
| legacy `system` | `light` |
| unknown string | `light` |
| MMKV write failure | non-blocking; in-memory preference still applies |
| read failure | `light`; app continues |

## 34. System UI mapping

`AppStatusBar` (`src/providers/status-bar.tsx`) — Expo APIs only; no `android/` edits.

| Mode | `statusBarStyle` | Status icons | Nav bar (`NavigationBar.setStyle`) | Root `SystemUI` background |
|------|------------------|--------------|-------------------------------------|----------------------------|
| LIGHT | `dark` | dark on light | `light` (dark icons) | `colors.light.background` |
| LOGO | `light` | light on red chrome | `dark` (light icons) | `colors.logo.background` |
| DARK | `light` | light on dark | `dark` (light icons) | `colors.dark.background` |

Native `Appearance.setColorScheme`: `dark` → `'dark'`; `light` + `logo` → `'light'`.

## 35. Accessibility / contrast measurements

Measured via `src/theme/contrast.ts` (`contrastRatio` / `roundContrast`). **NOT WCAG certified** — design-time audit only.

| Pair | Ratio | Assessment |
|------|-------|------------|
| Light `textPrimary` / `background` | **17.93** | Strong body contrast (re-measured after neutralization) |
| Light `textSecondary` / `background` | **4.83** | Meets normal-text floor |
| Light `textMuted` / `background` | **4.74** | Meets normal-text floor |
| Light button `textOnPrimary` / `primary` | **17.93** | Strong CTA contrast (ink primary) |
| Light `bottomNavActive` / `bottomNavBackground` | **17.93** | Active nav on white |
| Light `bottomNavInactive` / `bottomNavBackground` | **4.83** | Inactive nav readable |
| Light `link` / `background` | **17.93** | Ink link on white |
| Light `error` / `background` | **3.76** | Semantic error — large/UI use |
| Light `success` / `background` | **3.30** | Semantic success — large/UI status text floor |
| Light `warning` / `background` | **3.19** | Semantic warning — large/UI status text floor |
| Light `textPrimary` / `surfaceSelected` | **16.29** | Selected row text |
| Light placeholder `textMuted` / `inputBackground` | **4.74** | Placeholder readable |
| Logo `onBrandRed` / header (`headerText` / `headerBackground`) | **4.44** | Large/UI chrome on brand red; brand red fixed |
| Logo body `textPrimary` / `background` | **17.18** | Body stays dark on light content |
| Logo brand red / white card | **4.44** | Accent on white — acceptable for large/UI |
| Logo inactive nav / brand nav bg | **3.44** | Meets UI component ≥3:1 (white@82% on brand red) |
| Dark `textPrimary` / `background` | **17.83** | Strong (neutral Dark) |
| Dark `textSecondary` / `background` | **9.27** | Strong secondary |
| Dark `bottomNavActive` / `bottomNavBackground` | **19.17** | Active nav readable |

Logo chrome white-on-`#DC3C2C` ≈ 4.44:1 is intentional: canonical brand red is fixed; foreground stays white for icons/titles.

## 36. Intentional fixed-color allowlist

These are **not** theme defects:

| Allowlist | Location | Rationale |
|-----------|----------|-----------|
| Video scrims | `PlayerScreen`, `PlayerTopBar`, `SeekFeedback`, `PlayerAdjustmentHud` (black overlay) | Media contrast over moving video |
| External platform brand icons | `PlatformBrandIcons`, `HeroEcosystem` orbit, `platform-hub-items` | YouTube `#FF0000`, Instagram gradient, etc. — third-party identity |
| Dark intro / onboarding | `resolveIntroColors('dark')`, `DARK_ONBOARDING_ALLOWLIST` | Synced to neutral `colors.dark` (startup continuity) |
| YouTube `#FF0000` | Graphics / SVG only | Platform brand in decorative orbit — never VidoraX chrome |

## 37. Performance

No theme polling / `setInterval` (**P2-265**). WebView / download engine not keyed on theme. Live switch re-renders React chrome only.

## 38. Known limitations

- Player control scrims over video remain intentionally dark for media contrast.
- Hero orbit multi-brand decorative icon hues (non-VidoraX brands) stay fixed.
- Logo inactive bottom-nav uses white@82% on `#DC3C2C` (≈3.44:1) for readable subordinate chrome.
- Runtime Android acceptance for Phase 2 (**TEST A–X**) is **NOT_TESTED** — no APK built (`APK_NOT_BUILT_BY_REQUEST`).
- **Native Expo splash** (`app.json` `#1A2517`) is static pre-JS and may not match persisted theme until the first React-owned frame.
- `SPLASH_COLORS` defaults are LIGHT-neutral fallbacks only; live splash uses `resolveIntroColors`.

## 39. Real Android acceptance plan

Phase 2 completion acceptance: `docs/testing/THEME-SYSTEM-REAL-ANDROID-ACCEPTANCE.md` (**TEST A–X** + **STARTUP / SPLASH THEME CONTINUITY**).

Static gate: `npm run verify:theme-system`.

---

## STARTUP THEME CONTINUITY

### 1. Startup chain

```
Android/Expo native splash (static #1A2517)
  → configure-storage + RootLayout
  → theme store seeded from MMKV (fallback LIGHT)
  → AppProvider root bg = theme / resolveStartupBackground
  → Splash 1 (resolveIntroColors)
  → Onboarding Splash 2–4 (OnboardingSurfacesProvider)
  → optional AppLockGate (theme.colors.background)
  → Browser (unified landing)
```

### 2. Native splash boundary

`app.json` `expo-splash-screen.backgroundColor` remains static Deep Olive until a future native rebuild. It cannot read JS/MMKV. Documented limitation — not a dynamic theme surface.

### 3. React splash behavior

`SplashScreen` paints `resolveIntroColors(theme.mode)` for LIGHT / LOGO / DARK.

### 4. Theme hydration order

1. `configure-storage`  
2. `initialThemeState.themeMode = getThemeMode('light')` (sync MMKV)  
3. Zustand persist rehydrate (same preference)  
4. `runAppInitializer` → `waitForStoresHydration` → `syncMmkvFromStores` + `applyNativeColorScheme`

### 5. First-frame policy

Root / stack chrome use `resolveStartupBackground()` before `isReady`, then `theme.colors.background`. Auth stack uses `resolveIntroColors(mode).background`. Guards fill with theme background (never `null` flash).

### 6–8. Mode mapping

| Mode | Startup / onboarding |
|------|----------------------|
| LIGHT | White + dark text + gray secondary |
| LOGO | White/light surfaces + `#DC3C2C` accents |
| DARK | `#0D0D0D` / charcoal + white/gray (no olive/sage) |

### 9. Onboarding mapping

All Gateway / Trust / Library children via `useOnboardingSurfaces()` → `resolveOnboardingSurfaces(mode)`.

### 10. App Lock bootstrap mapping

`AppLockGate` / integrity / locked surfaces use `theme.colors.background` (unchanged security logic).

### 11. Root fallback mapping

`AppProvider` `ThemedRootView` + `resolveStartupBackground` StyleSheet seed.

### 12. Navigation transition backgrounds

Root + `(auth)` + `(app)` `contentStyle` follow active theme / intro background.

### 13. StatusBar

`AppStatusBar` + splash/onboarding RN StatusBar from intro/`theme.colors.statusBarStyle`.

### 14. Navigation bar

`NavigationBar.setStyle(light|dark)` from `theme.mode` (Logo → dark icons on red chrome).

### 15. Static native splash limitation

Pre-JS olive frame may appear briefly; first React-owned frame must match persisted theme.

### 16. Fixed artwork allowlist

Logo PNG, platform brand SVG hues, semantic success green.

### 17. Regression boundaries

No downloader / browser engine / tab / App Lock PIN / player / WebView theme-key changes. Unified Browser start page layout unchanged.
