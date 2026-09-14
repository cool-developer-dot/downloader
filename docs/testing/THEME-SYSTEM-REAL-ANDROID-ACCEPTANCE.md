# Theme System — Real Android Acceptance (Phase 2)

Package: `com.anonymous.vidorax`  
Platform: Android only  
Static verifier: `npm run verify:theme-system` → **282 passed** (no APK runtime)  
Status legend: `NOT_TESTED` | `PASS` | `FAIL`

All runtime cases start as **NOT_TESTED**. Do not mark PASS without device evidence.

---

## TEST A — Logo chrome

Select **Logo**. Visit every major route.

| Check | Expected | Result |
|-------|----------|--------|
| Top / header chrome | Canonical brand red `#DC3C2C` where present | NOT_TESTED |
| Bottom navigation | Brand red | NOT_TESTED |
| Main content | White / near-white (`#FAFAFA` / `#FFFFFF`) | NOT_TESTED |
| Cards / sheets / dialogs | Light (not brand-red fills) | NOT_TESTED |
| Full-screen red main content | Must **not** occur | NOT_TESTED |

---

## TEST B — Logo text

Inspect titles, body, metadata, links, buttons, errors, success under **Logo**.

| Check | Expected | Result |
|-------|----------|--------|
| Titles on red chrome | White (`onBrandRed`) | NOT_TESTED |
| Body / metadata | Dark readable (`textPrimary` / `textSecondary`) — not all red | NOT_TESTED |
| Links / primary actions | Brand red | NOT_TESTED |
| Errors | Semantic `#EF4444` — not brand red | NOT_TESTED |
| Success / warning | Semantic status colors | NOT_TESTED |

---

## TEST C — Dark isolation

Select **Dark**. Visit all screens.

| Check | Expected | Result |
|-------|----------|--------|
| Headers / bottom nav | Neutral black/charcoal (`#0F0F0F`) — **no** Logo-red chrome; **no** olive | NOT_TESTED |
| Cards / dialogs / sheets | Charcoal (`#181818` / `#1F1F1F`) | NOT_TESTED |
| Links / primary accent | Off-white (`#F5F5F5`) — not sage, not brand red | NOT_TESTED |
| Onboarding / intro | Cinematic olive allowlist — no forced Logo red; **does not** define private-app Dark | NOT_TESTED |

---

## TEST D — Light consistency

Select **Light**. Visit all screens.

| Check | Expected | Result |
|-------|----------|--------|
| Surfaces | Neutral white / near-white | NOT_TESTED |
| Overall tint | Must **not** look sage/olive-washed (`#F4F7F2` legacy) | NOT_TESTED |
| Headers / bottom nav | White chrome — not brand red | NOT_TESTED |
| Primary accents | Dark ink (`#171717`) — not sage/green | NOT_TESTED |
| Generic primary / links / nav active | Ink neutral — not success green | NOT_TESTED |

---

## LIGHT THEME FINAL ACCEPTANCE

Dedicated Light neutralization acceptance (post **LIGHT THEME FINAL NEUTRAL CONTRACT**). All cases start **NOT_TESTED** — do not mark PASS without device evidence.

### TEST L1 — First open

Fresh install / no saved preference.

| Expected | Result |
|----------|--------|
| Clearly white/neutral app; no overall sage/green identity | NOT_TESTED |

### TEST L2 — Home / root

Inspect root/main screen.

| Expected | Result |
|----------|--------|
| White backgrounds; black titles; gray metadata; no sage surfaces | NOT_TESTED |

### TEST L3 — Navigation

Check top header, bottom nav, active tab, inactive tabs, back, overflow.

| Expected | Result |
|----------|--------|
| White + black + gray; active tab/icon dark neutral; **no** green | NOT_TESTED |

### TEST L4 — Settings

Inspect Settings root, Appearance, Download Settings, Privacy/App Lock entries.

| Expected | Result |
|----------|--------|
| Neutral white/black/gray hierarchy; no sage section headers or green icons | NOT_TESTED |

### TEST L5 — Appearance picker

Select **Light** in Appearance.

| Expected | Result |
|----------|--------|
| Selected Light segment black/dark neutral + white label; **not** green | NOT_TESTED |

### TEST L6 — Switches

Toggle multiple Settings switches.

| Expected | Result |
|----------|--------|
| ON → dark neutral track; OFF → gray; **no** Paper green leak | NOT_TESTED |

### TEST L7 — Inputs

Open Browser address bar, Library search, PIN field, Recovery field.

| Expected | Result |
|----------|--------|
| Neutral black/gray focus styling; **no** green focus ring | NOT_TESTED |

### TEST L8 — Browser

Inspect VidoraX browser chrome with a live page loaded.

| Expected | Result |
|----------|--------|
| White chrome; black/gray icons; neutral address bar; webpage untouched | NOT_TESTED |

### TEST L9 — Downloads

Start an active download; observe through completion if possible.

| Expected | Result |
|----------|--------|
| Active progress neutral dark (not green); completed state may use semantic success green | NOT_TESTED |

### TEST L10 — App Lock

Check Lock Screen, Forgot PIN, Change PIN, Recovery Code, Disable.

| Expected | Result |
|----------|--------|
| White/black/gray; error red semantic; **no** green branding | NOT_TESTED |

### TEST L11 — Dialogs / sheets / menus

Trigger representative dialogs, bottom sheets, and overflow menus.

| Expected | Result |
|----------|--------|
| White surfaces; black text; gray secondary; neutral primary actions; **no** sage | NOT_TESTED |

### TEST L12 — Player

Inspect app-owned player chrome (playlist, metadata, sheets).

| Expected | Result |
|----------|--------|
| White/neutral panels; video scrims may remain dark | NOT_TESTED |

### TEST L13 — Intro / onboarding

Inspect Light intro/splash and onboarding surfaces.

| Expected | Result |
|----------|--------|
| White/neutral Light experience; **no** cinematic olive/sage leak | NOT_TESTED |

### TEST L14 — Semantic success

Find a completed/success state (e.g. completed download).

| Expected | Result |
|----------|--------|
| Green allowed **only** because it means success — not generic primary | NOT_TESTED |

### TEST L15 — LIGHT → LOGO

Switch **LIGHT → LOGO** on a deep route.

| Expected | Result |
|----------|--------|
| Neutral black controls become brand-red where Logo semantics require; red chrome appears; no restart | NOT_TESTED |

### TEST L16 — LOGO → LIGHT

Switch **LOGO → LIGHT**.

| Expected | Result |
|----------|--------|
| Logo-red generic UI returns to black/neutral; no stale red; no green | NOT_TESTED |

### TEST L17 — DARK → LIGHT

Switch **DARK → LIGHT**.

| Expected | Result |
|----------|--------|
| Neutral Dark (black/charcoal) surfaces become white/neutral; no stale olive/sage | NOT_TESTED |

### TEST L18 — Process restart

Select **Light** → force-stop → reopen.

| Expected | Result |
|----------|--------|
| Same neutral Light appearance persists | NOT_TESTED |

---

## DARK THEME FINAL NEUTRAL ACCEPTANCE

Dedicated Dark neutralization acceptance (post **DARK THEME FINAL NEUTRAL CONTRACT**). All cases start **NOT_TESTED** — do not mark PASS without device evidence.

### TEST D1 — Open Dark

Select **Dark**.

| Expected | Result |
|----------|--------|
| App reads BLACK / CHARCOAL / WHITE / GRAY — not olive/sage | NOT_TESTED |

### TEST D2 — Root / home

| Expected | Result |
|----------|--------|
| Neutral-black background; charcoal cards; white text; gray secondary; no green tint | NOT_TESTED |

### TEST D3 — Top nav

| Expected | Result |
|----------|--------|
| Black/charcoal header; white title/icons; neutral border; no olive; no red | NOT_TESTED |

### TEST D4 — Bottom nav

| Expected | Result |
|----------|--------|
| Dark background; white active; gray inactive; **no** green active tab | NOT_TESTED |

### TEST D5 — Settings

| Expected | Result |
|----------|--------|
| Dark neutral; white titles; gray descriptions; neutral controls | NOT_TESTED |

### TEST D6 — Appearance

| Expected | Result |
|----------|--------|
| Dark selected → light fill + dark label; **not** sage | NOT_TESTED |

### TEST D7 — Switches

| Expected | Result |
|----------|--------|
| ON → neutral light/dark contrast; **not** green | NOT_TESTED |

### TEST D8 — Checkbox / radio

| Expected | Result |
|----------|--------|
| White/light neutral selected state | NOT_TESTED |

### TEST D9 — Inputs / search

| Expected | Result |
|----------|--------|
| Charcoal input; white text; gray placeholder; neutral focus | NOT_TESTED |

### TEST D10 — Browser

| Expected | Result |
|----------|--------|
| Neutral dark VidoraX chrome; website unchanged | NOT_TESTED |

### TEST D11 — WebView survival

Switch LIGHT → DARK and LOGO → DARK with loaded page/tabs.

| Expected | Result |
|----------|--------|
| Page/history/tabs remain; no forced webpage Dark CSS | NOT_TESTED |

### TEST D12 — Downloads

| Expected | Result |
|----------|--------|
| Active progress white/light neutral; completed may be success green; failed red | NOT_TESTED |

### TEST D13 — App Lock

Lock / Forgot PIN / Change PIN / Recovery / Regenerate / Disable / Throttle.

| Expected | Result |
|----------|--------|
| Neutral Dark presentation; security unchanged | NOT_TESTED |

### TEST D14 — Dialogs

| Expected | Result |
|----------|--------|
| Charcoal surfaces; white title; gray body; neutral actions; semantic destructive red | NOT_TESTED |

### TEST D15 — Sheets / menus

| Expected | Result |
|----------|--------|
| Neutral charcoal; no olive/sage | NOT_TESTED |

### TEST D16 — Player

| Expected | Result |
|----------|--------|
| App-owned surfaces neutral Dark; video untouched; black scrims allowed | NOT_TESTED |

### TEST D17 — Loading / empty / error

| Expected | Result |
|----------|--------|
| Neutral Dark states; semantic error/success only where meaningful | NOT_TESTED |

### TEST D18 — Intro boundary

| Expected | Result |
|----------|--------|
| Dark intro may keep documented cinematic olive; private app after intro is neutral Dark | NOT_TESTED |

### TEST D19 — LIGHT → DARK

| Expected | Result |
|----------|--------|
| White/black Light → black/white Dark; no green intermediate; no route reset | NOT_TESTED |

### TEST D20 — LOGO → DARK

| Expected | Result |
|----------|--------|
| Red chrome → black/charcoal; red brand primary → neutral Dark primary; no sage | NOT_TESTED |

### TEST D21 — DARK → LIGHT

| Expected | Result |
|----------|--------|
| Neutral Dark → neutral Light; no stale olive | NOT_TESTED |

### TEST D22 — DARK → LOGO

| Expected | Result |
|----------|--------|
| Neutral Dark → red + white Logo; no stale sage | NOT_TESTED |

### TEST D23 — Active download survival

| Expected | Result |
|----------|--------|
| Theme switching does not pause/retry/restart download | NOT_TESTED |

### TEST D24 — App Lock state survival

| Expected | Result |
|----------|--------|
| Theme switching does not reset lock/throttle/recovery security state | NOT_TESTED |

### TEST D25 — Process restart

| Expected | Result |
|----------|--------|
| Dark preference returns; private app neutral Dark | NOT_TESTED |

### TEST D26 — EN / UR

| Expected | Result |
|----------|--------|
| Dark readable under EN and UR; no theme-induced RTL regression | NOT_TESTED |

---

## TEST E — All navigation

Check bottom tabs, top bars, back, overflow, active/inactive states, tab indicators under **Light**, **Logo**, and **Dark**.

| Check | Expected | Result |
|-------|----------|--------|
| Token-driven chrome | No mixed-theme nav leftovers | NOT_TESTED |
| Active / inactive contrast | Readable per mode | NOT_TESTED |
| `headerBorder` / `headerSubtitle` | Correct per mode (no manual logo branches visible) | NOT_TESTED |

---

## TEST F — Live switch

Keep a deep route open. Switch: **LIGHT → LOGO → DARK → LIGHT**.

| Expected | Result |
|----------|--------|
| Immediate visual update; no restart; no navigation reset; no crash; no stale mixed-theme screen | NOT_TESTED |

---

## TEST G — Browser survival

Open a live webpage with navigation history. Switch themes.

| Check | Expected | Result |
|-------|----------|--------|
| Webpage content | Unchanged (no CSS injection) | NOT_TESTED |
| URL / history / tab | Preserved | NOT_TESTED |
| Page reload | Not triggered by theme change alone | NOT_TESTED |
| VidoraX browser chrome | Updates to match theme | NOT_TESTED |

---

## TEST H — Multi-tab

Open multiple browser tabs. Switch theme.

| Expected | Result |
|----------|--------|
| All tabs remain; current owner remains; no WebView recreation caused by theme | NOT_TESTED |

---

## TEST I — Active download

Start a large download. Switch **LIGHT → LOGO → DARK** several times.

| Expected | Result |
|----------|--------|
| Download continues; progress continues; no pause / cancel / retry / restart | NOT_TESTED |

---

## TEST J — Paused download

Pause a download. Switch theme.

| Expected | Result |
|----------|--------|
| Remains paused; resume state unaffected | NOT_TESTED |

---

## TEST K — Player

Start playback. Switch themes if reachable without destroying the player surface.

| Expected | Result |
|----------|--------|
| App-owned chrome updates; video session not restarted because of theme | NOT_TESTED |

---

## TEST L — App Lock normal

Test lock screen in **Light**, **Logo**, and **Dark**.

| Expected | Result |
|----------|--------|
| Readable visuals per theme; PIN / unlock behavior unchanged | NOT_TESTED |

---

## TEST M — App Lock recovery

Test Forgot PIN, New PIN, Change PIN, Recovery Code, Regenerate Recovery Code, Disable App Lock under applicable themes.

| Expected | Result |
|----------|--------|
| Correct visuals; no security state reset | NOT_TESTED |

---

## TEST N — App Lock throttle

Trigger temporary PIN or recovery throttle. Switch theme / background / reopen as appropriate.

| Expected | Result |
|----------|--------|
| Theme does not bypass or reset throttle | NOT_TESTED |

---

## TEST O — Dialogs

Trigger delete, cancel, retry, security, download, and confirmation dialogs under all themes.

| Expected | Result |
|----------|--------|
| No light dialog on Dark; no dark dialog on Light; Logo uses correct light + red chrome relationship | NOT_TESTED |

---

## TEST P — Sheets

Trigger all major bottom sheets (resume playback, file actions, browser sheets, etc.).

| Expected | Result |
|----------|--------|
| Correct backgrounds, handles, and text per theme | NOT_TESTED |

---

## TEST Q — Menus

Trigger browser, player, and settings overflow / action menus.

| Expected | Result |
|----------|--------|
| No stale theme; menu backgrounds match `menuBackground` token | NOT_TESTED |

---

## TEST R — Empty states

Inspect empty Downloads, Library, History, Browser tabs, Playlist under all themes.

| Expected | Result |
|----------|--------|
| EmptyState surfaces match active theme | NOT_TESTED |

---

## TEST S — Error states

Inspect failures and error affordances under all themes.

| Expected | Result |
|----------|--------|
| Error remains semantic (`#EF4444`); Logo brand red does not replace error identity | NOT_TESTED |

---

## TEST T — Android system UI

Inspect status bar, status icons, and navigation bar under each mode.

| Mode | Expected | Result |
|------|----------|--------|
| Light | Dark status / nav icons on light background | NOT_TESTED |
| Logo | Light icons on red chrome; readable nav contract | NOT_TESTED |
| Dark | Light icons on dark background | NOT_TESTED |

---

## TEST U — Process restart

For each mode: select theme → force-stop → reopen.

| Mode | Expected | Result |
|------|----------|--------|
| Light | Same mode returns | NOT_TESTED |
| Logo | Same mode returns | NOT_TESTED |
| Dark | Same mode returns | NOT_TESTED |

---

## TEST V — Invalid saved value

Using a safe development-only mechanism, simulate invalid stored theme preference.

| Expected | Result |
|----------|--------|
| Falls back to **LIGHT**; no crash | NOT_TESTED |

Do not modify production behavior merely to make this test easy.

---

## TEST W — EN / UR

Inspect Appearance labels and major themed UI in English and Urdu.

| Locale | Expected | Result |
|--------|----------|--------|
| English | Light / Logo / Dark labels correct | NOT_TESTED |
| Urdu | لائٹ / لوگو / ڈارک labels correct; no RTL regression | NOT_TESTED |

---

## TEST X — Small / large text

If Android font scaling is available, test a larger system font setting.

| Expected | Result |
|----------|--------|
| Critical buttons and navigation remain usable; no text clipping introduced by theme | NOT_TESTED |

Do not redesign for extreme unsupported scale.

---

## STARTUP / SPLASH THEME CONTINUITY

All cases: **NOT_TESTED** until exercised on device.

### S1 — LIGHT COLD START

Select LIGHT → force-stop → reopen.

| Expected | Result |
|----------|--------|
| Native launch boundary (static) then first React splash is LIGHT | NOT_TESTED |
| Onboarding / App Lock (if shown) LIGHT | NOT_TESTED |
| Browser LIGHT | NOT_TESTED |
| No olive/green or dark React frames | NOT_TESTED |

### S2 — LOGO COLD START

| Expected | Result |
|----------|--------|
| Logo treatment continuous on React-owned startup | NOT_TESTED |
| No white Light flash before Logo surfaces | NOT_TESTED |

### S3 — DARK COLD START

| Expected | Result |
|----------|--------|
| First React-owned startup surface is neutral DARK | NOT_TESTED |
| No white flash | NOT_TESTED |
| No olive/sage private-app startup UI | NOT_TESTED |

### S4 — ONBOARDING LIGHT

All onboarding pages: white/light + dark text. **NOT_TESTED**

### S5 — ONBOARDING LOGO

Approved Logo treatment. **NOT_TESTED**

### S6 — ONBOARDING DARK

Neutral black/charcoal + white/gray; no olive/sage UI. **NOT_TESTED**

### S7 — APP LOCK STARTUP

Enabled App Lock under all 3 themes: bootstrap → lock continuous theme; no private UI flash. **NOT_TESTED**

### S8 — ROUTE TRANSITIONS

Splash→Browser, Splash→App Lock, Onboarding→Browser, App Lock→Browser: no wrong-theme frame. **NOT_TESTED**

### S9 — STATUS BAR

All themes during splash/startup/onboarding: readable icons. **NOT_TESTED**

### S10 — NAVIGATION BAR

All themes during startup: correct contrast. **NOT_TESTED**

---

## Notes

- Canonical brand red: `#DC3C2C` from `assets/logos/vidorax-logo.png`
- Theme persistence: Zustand persist (`storageKeys.themePreference`) + MMKV `vidorax.mmkv.theme.mode`
- Static gate: `npm run verify:theme-system`
- Architecture: `docs/ui/THEME-SYSTEM-ARCHITECTURE.md` (includes **STARTUP THEME CONTINUITY**)
- Native splash `#1A2517` is a static pre-JS boundary
- Light acceptance: **TEST L1–L18**
- Dark acceptance: **TEST D1–D26**
- Startup continuity: **S1–S10**
- APK not built for this workstream (`APK_NOT_BUILT_BY_REQUEST`)
