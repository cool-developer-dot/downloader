# Secondary Content Relocation — Real Android Acceptance

Phase 3. Static gate: `npm run verify:secondary-content-relocation`

All runtime cases start **NOT_TESTED**. Do not mark passed from code review alone.

Device: _______________  
Build: _______________  
Date: _______________  
Tester: _______________

---

## MANUAL A — BROWSER CLEANLINESS

Open the Browser start page.

Expected:

- No Active Downloads card
- No Recent Downloads carousel
- No Continue Watching section
- No Recently Watched section
- No Storage card
- No permanent History block
- No permanent Bookmarks block
- Start page remains minimal (intro + 3×3 Quick Access)
- Tab count, omnibox, overflow, and browser controls remain

Result: **NOT_TESTED**

Notes:

---

## MANUAL B — ACTIVE DOWNLOADS

Browser ⋮ → **Active Downloads**

Expected:

- Downloads tab opens
- Existing **Running** filter is selected
- The list is the existing Downloads list (no second Active Downloads UI)
- Jobs still use current statuses (no new state names)

Result: **NOT_TESTED**

Notes:

---

## MANUAL C — RECENT DOWNLOADS

Browser ⋮ → **Recent Downloads**

Expected:

- Downloads tab opens
- Existing **Completed** filter is selected (newest first)
- No restored Home carousel

Result: **NOT_TESTED**

Notes:

---

## MANUAL D — CONTINUE WATCHING

Browser ⋮ → **Continue Watching**

Expected:

- Library opens
- Continue Watching section is visible (Library default / `all` filter, search cleared)
- Tiles use existing playback-progress data
- Playing an item uses the existing player

Result: **NOT_TESTED**

Notes:

---

## MANUAL E — RECENTLY WATCHED

Browser ⋮ → **Recently Watched**

Expected:

- Library opens with the existing Recently Watched filter
- Empty state is the existing Library empty state when there is no history
- No new watch-history database

Result: **NOT_TESTED**

Notes:

---

## MANUAL F — HISTORY

Browser ⋮ → **History**

Expected:

- Existing Browser history screen/sheet opens
- Prior visits are still present (nothing reset)

Result: **NOT_TESTED**

Notes:

---

## MANUAL G — BOOKMARKS

Browser ⋮ → **Bookmarks**

Expected:

- Existing bookmarks UI opens
- Saved bookmarks are still present
- Add bookmark for the current page still works when a page is open

Result: **NOT_TESTED**

Notes:

---

## MANUAL H — STORAGE

Settings → **Storage**

Expected:

- Used / available (and location if already supported) from existing storage data
- Opening Storage does not delete files
- Download paths are unchanged

Result: **NOT_TESTED**

Notes:

---

## MANUAL I — PHASE 2 MEDIA REGRESSION

Open a supported video page in Browser.

Expected:

- Automatic detection
- **Video available** only after verification
- Play / Download (and quality sheet when multiple options exist) still work
- Overflow shortcuts do not hide or break the bar

Result: **NOT_TESTED**

Notes:

---

## MANUAL J — THEMES

Check Browser overflow + Downloads / Library / Settings Storage in:

- LIGHT
- LOGO
- DARK

Expected:

- Existing theme tokens
- LOGO brand red remains `#DC3C2C`
- No unthemed raw palette on the new menu rows

Result: **NOT_TESTED**

Notes:

---

## MANUAL K — PERSISTENCE / DATA

After using overflow shortcuts, confirm:

- Browser history still exists
- Bookmarks still exist
- Downloads still exist
- Watch history / continue-watching still exists
- Storage values remain correct

Expected: no migration and no data loss.

Result: **NOT_TESTED**

Notes:

---

## MANUAL L — EXISTING BROWSER UTILITIES

From ⋮ confirm New tab, Tabs (tab switcher), Desktop/mobile, Copy, Share, Settings still work.

Result: **NOT_TESTED**

Notes:

---

## MANUAL M — RTL / URDU

Switch language to Urdu and open ⋮.

Expected:

- Active Downloads / Recent Downloads / Continue Watching / Recently Watched / History / Bookmarks are localized
- RTL layout of the menu remains usable

Result: **NOT_TESTED**

Notes:

---

## MANUAL N — ACCESSIBILITY

TalkBack:

- Overflow trigger announces as the browser menu button
- Shortcut rows have labels and usable touch targets
- Downloads filter chips / Library Continue Watching controls remain reachable

Result: **NOT_TESTED**

Notes:
