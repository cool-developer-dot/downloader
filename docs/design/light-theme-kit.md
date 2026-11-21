# VidoraX · design kit, the six themes and module rules

Source of truth: the CEO's handoff `VidoraX-6-Themes-65-Screens.pdf` (54 pages: six themes × 65 screens, 8 per
page; the geometry below was measured on the light pages and holds for all six). The Browser and Downloads modules are built from it now; Player and Files come later. Every screen is
rebuilt **exactly** as drawn: same rows, same order, same words, same controls (toggle vs chevron vs value), same
chips, same buttons, same header button. Nothing is added that the design does not show, and nothing the design
shows is left out — a row whose feature does not exist yet still appears and says "Not available yet" when tapped.

## Measured tokens (dp on a 360-wide screen)

| Thing | Measurement |
| --- | --- |
| Page | `#FAF9FB`, 16 dp side gutters |
| Header | title 22 semibold `#16161A` at 20 from the top; subtitle 12.5 `#6B6B76` 6 below; one 36 × 36 white button, 11 dp corners, 18 dp dark icon, at the top right; `←` 22 dp before the title on sub-screens |
| Search field | 56 tall, 16 dp corners, white, hairline `#EEEDF1` edge, 20 dp search glass, 15 dp text, grey mic / camera / ✕ at the end |
| Card | white, 16 dp corners, hairline `#EEEDF1` edge, 13 dp inner padding |
| List row | 34 × 34 icon tile (10 dp corners, `#FDECEA`) with a 17 dp red (`#D92D20`) stroke icon · 12 gap · title 15 semibold · subtitle 12.5 grey · chevron 18 grey, or a toggle, or a 13.5 grey value; 58 dp minimum; 1 dp `#EDEDF0` line between rows |
| Toggle | 43 × 25 pill, red on / `#D6D5DB` off, 18 dp white thumb |
| Chip | 31 tall, 16 dp corners, 13.5 text; selected = `#FDECEA` fill, red semibold text, faint red edge; 8 dp gaps; a row scrolls past the gutter |
| Section label | 12 semibold red capitals, 0.6 tracking; 16 above, 10 below |
| Buttons | 45 tall, 12 dp corners, 15 semibold; primary red / white text, secondary white / dark text with a hairline edge; a pair has a 9 dp gap |
| Tile | 70 tall, 13 dp corners, white; 21 dp red stroke icon over a 12.5 semibold label; 3 per row, 10 dp gaps |
| Thumbnail | 54 × 45, 8 dp corners; dark green with ▶ for a finished video, slate with ⤓ for a transfer |
| Progress bar | 6 tall, `#EDEDF0` track, red fill |
| Floating button | 50 tall red pill "+ Add link", 25 dp corners, red-tinted shadow, bottom end corner |
| Bottom bar | 61 tall + 1 dp `#EDEDF0` top line, white; Browser · Downloads · Player · Files · Settings; 20 dp Lucide icons (stroke 2.1) over 11 semibold labels; active red, inactive `#6B6B76` |
| Hero figures | 45 semibold (62 %, 25:00), 34 semibold stat cards, 22.5 → 34 green `#12B76A` for the blocked count |

All of these are code: `src/design/tokens.ts` (dimensions) and `src/theme/colors.ts` → `colors.light` (colours).
Text is Inter only: semibold for titles, row titles, buttons, chips, labels; regular for secondary lines.

## The six themes

Pages 1–9 of the PDF are Light, 10–18 Dark, 19–27 Red, 28–36 Cream, 37–45 Midnight, 46–54 Blush. Every theme
draws the same 65 screens with the same geometry; only the colours differ, and the Red theme also paints the header
and the bottom bar. `src/theme/colors.ts` holds one measured palette per theme (`designPalettes`) and builds every
token set with `designTheme`; `src/theme/colors.test.ts` pins the measured values so a theme cannot drift from its
frames. The values below were read from the PDF's vectors (fills and text colours), not from screenshots.

| Token | Light | Dark | Red | Cream | Midnight | Blush |
| --- | --- | --- | --- | --- | --- | --- |
| Page | `#FAF9FB` | `#121214` | `#FDF1EF` | `#FBF6EC` | `#0D1424` | `#FFF5F7` |
| Card · field · chip · tile · header button | `#FFFFFF` | `#1D1D20` | `#FFF9F8` | `#FFFDF8` | `#151D31` | `#FFFFFF` |
| Card edge | `#EEEDF1` | `#0A0A0B` | `#F0D3CF` | `#F1E8D8` | `#060A12` | `#F8DEE4` |
| Row divider · progress track | `#EDEDF0` | `#2C2C31` | `#F2D8D4` | `#EEE3D0` | `#232D47` | `#F8DDE3` |
| Accent (buttons, toggles on, section labels, icons, active tab) | `#D92D20` | `#E5382B` | `#D92D20` | `#C8321F` | `#FF4A3D` | `#E0313F` |
| Icon tile · selected chip | `#FDECEA` | `#3B1D1B` | `#FBE0DC` | `#F8E3D6` | `#3A1F2B` | `#FFE1E7` |
| Title text | `#16161A` | `#F4F4F6` | `#2A1210` | `#2B2118` | `#EAF0FF` | `#3A1A22` |
| Secondary text | `#6B6B76` | `#9C9CA6` | `#8A5E59` | `#8A7B6A` | `#8F9BB8` | `#94626D` |
| Toggle off | `#D6D5DB` | `#46464D` | `#D6D5DB` | `#D6D5DB` | `#3A4565` | `#D6D5DB` |
| Success (blocked count) | `#12B76A` | `#34D399` | `#12B76A` | `#12B76A` | `#3DDC97` | `#12B76A` |
| Status-bar text | dark | light | light | dark | light | dark |

**Red theme chrome.** The header is a full-width band in the accent, 85 dp from the top of the safe area to its
square bottom edge, darkening a little towards the bottom (`#D92D20` → `#C42419`); the title is white, the subtitle
white at 70 %, the header button a 36 dp white square at 15 % with a white icon; the first card sits 12 dp below the
band, and the Video sheet carries the same band. The bottom bar is the accent too: white labels (inactive at 70 %)
and a 52 × 26 white pill at 20 % behind the active icon. `theme.colors.headerStyle === 'band'` drives all of it
(`DsHeader`, `DsIconButton tone="header"`, `DsScreen` paints the status-bar strip, `DsTabBar` draws the pill).

**Night themes.** Dark and Midnight are the dark themes (`isDarkThemeMode`): Android night mode, the dark navigation
and Paper bases and force-dark web pages follow them; Light, Red, Cream and Blush paint on the light scheme.

**Choosing.** Settings → Appearance shows six swatches in the PDF's order; Light is the default; a stored `logo`
preference from older builds opens as Red; the intro, splash and onboarding take the chosen theme's page and accent.

## The kit — `src/design`

| Component | Use |
| --- | --- |
| `DsScreen` | the page; scrolls; `footer` for a full-width bottom button; `scroll={false}` for list screens |
| `DsHeader` | title / subtitle / `onBack` / one `action` `{ icon, accessibilityLabel, onPress }` |
| `DsIconButton` | the 36 dp header button (`raised`) or a bare 44 dp hit area (`plain`) |
| `DsSearchField` | the 56 dp field: `icon`, `actions` (mic, camera, ✕), or `onPress` to make it a button |
| `DsCard` | a white card (`padded={false}` when it holds rows) |
| `DsRowGroup` + `DsRow` | a card of rows with hairline dividers; `icon`, `title`, `subtitle`, `value`, `toggle`, `trailing`, `onPress` |
| `DsToggle` | the switch (inside rows via `toggle=`) |
| `DsChipRow` + `DsChip` | filter chips (`selected`) |
| `DsSectionLabel` | red capitals label |
| `DsButton` / `DsButtonRow` | 45 dp buttons, `variant="primary" | "secondary"`, `flex` for pairs, `fullWidth` for one |
| `DsTileGrid` + `DsTile` | 3-column tiles (`icon`, `label`, `badge`) |
| `DsProgressBar` | the 6 dp bar |
| `DsThumb` | the 54 × 45 thumbnail (`uri` or `kind="video" | "transfer"`) |
| `DsStatCard` | figure-over-label card |
| `DsFab` | the floating "+ Add link" |
| `DsText` | text roles: `title subtitle rowTitle rowSub rowValue section chip button tile body bodyStrong tabLabel hero stat cardTitle` |
| `DsIcon` | Lucide icons by name (`DsIconName`); add a name to `DsIcon.tsx` when a screen needs one |

Colours always come from `useTheme().colors` (`background`, `card`, `cardBorder`, `divider`, `track`, `primary`,
`accentSoft`, `switchOff`, `textPrimary`, `textSecondary`, `success`); never a hex literal in a screen.

## Modules and navigation

The bottom bar has five tabs. **Browser** and **Downloads** are nested stacks inside their tabs
(`src/app/(app)/(tabs)/browser/*`, `src/app/(app)/(tabs)/downloads/*`), so each of their screens opens with the bar
still showing — exactly as every design frame shows it. Paths are in `src/navigation/constants/route-paths.ts`
(`routePaths.browserTabs`, `routePaths.downloadsAdd`, …); a new screen is one route file that renders the screen
component plus one `routePaths` entry.

What belongs where (the design decides; red = Browser, every download thing = Downloads):

- **Browser** (`src/browser`): home / start page, tabs and tab options, page tools, bookmarks, history, privacy,
  incognito, passwords & autofill, developer tools, browser settings, search, focus & site blocker, utilities,
  display & Urdu. New tabs, incognito, Paste & Go and Scan QR on the start page are browser features.
- **Downloads** (`src/screens/downloads`): the list, add download (link · batch · torrent / magnet · playlist),
  details, queues & schedule, torrent, statistics, download settings, alerts & sync, video-detected sheet,
  playlist download, live & convert, organize, link grabber, network, file actions, failed · retry, notifications &
  widgets. "+ Add link" lives here, not on the browser.

## Rules for every screen

1. Reuse the existing services, stores and repositories behind each row (the features were all built in the B
   packages; see `docs/ARCHITECTURE.md` §8.1 and `docs/work-log/hamza-browser.md`). The screen is new; the logic is
   not. Never duplicate a service.
2. Every user-visible string goes in `src/localization/en.ts` **and** `ur.ts` (real Urdu) under the screen's own
   group; `catalog-parity.test.ts` must pass. Reuse an existing key when the same text already exists.
3. Nothing in `src/browser/webview/webview-configuration.ts`, the download rules, permissions or native code changes.
4. Accessibility: every control has a label; rows read title and subtitle; toggles are switches; 48 dp targets.
5. RTL: use `useRtl()` row directions (the kit does); never hard-code `left` / `right`.
6. The gate before every commit: `npm run typecheck`, `npm test`, `npm run lint` (0 errors), `git diff --check`.
7. Commits: `Light: <screen or area> — <what>`; explicit `git add` paths.
