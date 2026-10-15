# VidoraX 1.0.1 (test build 2) — store listing v2

Copy-paste text for **Play Console → Grow → Store presence → Main store listing**, English (default, en-US) and
Urdu (ur). Written 2026-10-16 for the tester report (item 1: "make the listing keyword-rich and clear about features")
and checked against what **test build 2** (`release/1.0`, versionCode 2) really does. Nothing here describes work
that exists only on `main` (no live recording, no parallel-download controls, no translate page, no remaining-time
label).

**Starting point.** The live listing URL
`https://play.google.com/store/apps/details?id=com.vidorax.fast.videodownloader` returned **HTTP 404** on 2026-10-16
— the app is only in closed testing, so there is no public page to read. The baseline is the copy in
`PLAY_SUBMISSION.md` (name `VidoraX`, the 76-character short description and the sectioned full description).

## Rules this copy follows (Play metadata policy)

- No other apps' or sites' brand names, except the one required disclaimer line ("YouTube … not supported"), which
  restricts rather than promotes. No "download from any site / any video".
- No ranking or price claims (#1, best, top, free, no. 1), no keyword lists, no repetition for its own sake, no emoji,
  no ALL-CAPS title, no reviews or testimonials.
- Every feature line is true for test2 and has its benefit next to it.
- Ends with the permitted-use line (only what you have the right to save; DRM and YouTube not supported).

Character counts below were measured with Python `len()` on the exact text in the blocks (Play counts characters,
not bytes).

---

## English (en-US)

**App name** — 25 / 30

```
VidoraX: Video Downloader
```

**Short description** — 77 / 80

```
Video downloader with a built-in browser. Save videos and watch them offline.
```

**Full description** — 1,872 / 4,000

```
VidoraX is a video downloader, private browser and offline video player in one app. Open a web page, play the video you want, and save it to your phone to watch later without a connection.

HOW IT WORKS
• Paste a video link or search the web in the built-in browser
• Play the video on the page
• When the video can be saved, a "Video available" bar appears. Tap it to download
• A short guided tour on first launch shows you where everything is

SAVE VIDEOS
• Choose the quality, up to HD, when the page offers more than one
• Common web video formats: MP4, WebM, M4V and MOV files, plus unencrypted HLS and DASH streams, saved as a single video you can play anywhere
• Downloads keep running in the background, with a progress notification
• Pause, resume, retry or cancel at any time
• Wi-Fi only option to save mobile data

WATCH OFFLINE
• All your saved videos in one library, with thumbnails, duration, size and the site they came from
• Search, sort and mark favorites
• Rename, share, open in another app or save a copy to your Gallery
• Also plays the videos already on your phone

VIDEO PLAYER
• Swipe to change brightness and volume, double-tap to skip
• Playback speed, Picture-in-Picture and next / previous
• Picks up where you left off

BROWSER
• Tabs, bookmarks and history
• Open links shared from other apps, or set VidoraX as your default browser

PRIVATE BY DESIGN
• No account, no ads, no tracking
• Your downloads, history, bookmarks and settings stay on your device
• Optional PIN App Lock keeps your library private

MADE FOR YOU
• System, Red and Dark themes
• English and Urdu
• Help & Support inside the app: email the VidoraX team at Vidoraxlabs@gmail.com

Download only videos you own or have permission to save, and respect each site's terms. DRM-protected videos and YouTube are not supported, and VidoraX does not bypass logins or paywalls.
```

## Urdu (ur)

Add it under **Store listing → Manage translations → Add your own translations → Urdu – ur**. Brand and format names
(VidoraX, MP4, HLS, HD, Wi-Fi, Picture-in-Picture, DRM, YouTube) stay in Latin letters, as in the app.

**App name** — 24 / 30

```
VidoraX: ویڈیو ڈاؤن لوڈر
```

**Short description** — 74 / 80

```
بلٹ اِن براؤزر والا ویڈیو ڈاؤن لوڈر۔ ویڈیوز محفوظ کریں اور آف لائن دیکھیں۔
```

**Full description** — 2,045 / 4,000

```
VidoraX ایک ویڈیو ڈاؤن لوڈر، پرائیویٹ براؤزر اور آف لائن ویڈیو پلیئر ہے، سب ایک ایپ میں۔ کوئی ویب پیج کھولیں، اپنی پسند کی ویڈیو چلائیں اور اسے اپنے فون میں محفوظ کریں تاکہ بعد میں انٹرنیٹ کے بغیر دیکھ سکیں۔

یہ کیسے کام کرتا ہے
• بلٹ اِن براؤزر میں ویڈیو کا لنک پیسٹ کریں یا ویب پر تلاش کریں
• پیج پر ویڈیو چلائیں
• جب ویڈیو محفوظ کی جا سکتی ہو تو "ویڈیو دستیاب" بار ظاہر ہوتا ہے۔ ڈاؤن لوڈ کے لیے اسے ٹیپ کریں
• پہلی بار کھولنے پر ایک مختصر رہنما دورہ بتاتا ہے کہ ہر چیز کہاں ہے

ویڈیوز محفوظ کریں
• جب پیج ایک سے زیادہ کوالٹی دے تو HD تک اپنی پسند کی کوالٹی منتخب کریں
• عام ویب ویڈیو فارمیٹس: MP4، WebM، M4V اور MOV فائلیں، اور بغیر انکرپشن والی HLS اور DASH اسٹریمز، جو ایک ایسی ویڈیو کے طور پر محفوظ ہوتی ہیں جو کہیں بھی چل سکے
• ڈاؤن لوڈز پس منظر میں جاری رہتے ہیں، پیش رفت کی نوٹیفکیشن کے ساتھ
• کسی بھی وقت روکیں، دوبارہ شروع کریں، پھر سے کوشش کریں یا منسوخ کریں
• موبائل ڈیٹا بچانے کے لیے صرف Wi-Fi کا آپشن

آف لائن دیکھیں
• آپ کی تمام محفوظ ویڈیوز ایک لائبریری میں، تھمب نیل، دورانیہ، سائز اور اس سائٹ کے ساتھ جہاں سے آئیں
• تلاش کریں، ترتیب دیں اور پسندیدہ بنائیں
• نام بدلیں، شیئر کریں، کسی اور ایپ میں کھولیں یا گیلری میں کاپی محفوظ کریں
• آپ کے فون میں پہلے سے موجود ویڈیوز بھی چلاتا ہے

ویڈیو پلیئر
• سوائپ سے روشنی اور آواز بدلیں، ڈبل ٹیپ سے آگے پیچھے جائیں
• پلے بیک کی رفتار، Picture-in-Picture اور اگلی / پچھلی ویڈیو
• وہیں سے شروع کرتا ہے جہاں آپ نے چھوڑا تھا

براؤزر
• ٹیبز، بُک مارکس اور ہسٹری
• دوسری ایپس سے شیئر کیے گئے لنکس کھولیں، یا VidoraX کو اپنا ڈیفالٹ براؤزر بنائیں

پرائیویسی پہلے
• نہ اکاؤنٹ، نہ اشتہارات، نہ ٹریکنگ
• آپ کے ڈاؤن لوڈز، ہسٹری، بُک مارکس اور سیٹنگز آپ کی ڈیوائس پر ہی رہتی ہیں
• اختیاری PIN ایپ لاک آپ کی لائبریری کو پرائیویٹ رکھتا ہے

آپ کے لیے
• سسٹم، ریڈ اور ڈارک تھیمز
• انگریزی اور اردو
• ایپ کے اندر مدد اور سپورٹ: VidoraX ٹیم کو Vidoraxlabs@gmail.com پر ای میل کریں

صرف وہی ویڈیوز ڈاؤن لوڈ کریں جو آپ کی اپنی ہوں یا جنہیں محفوظ کرنے کی آپ کو اجازت ہو، اور ہر سائٹ کی شرائط کا احترام کریں۔ DRM سے محفوظ ویڈیوز اور YouTube معاون نہیں ہیں، اور VidoraX لاگ اِن یا پے وال کو بائی پاس نہیں کرتا۔
```

---

## Keywords

Play has no keyword field: it ranks on the title, the short description and the full description. Each term below
appears where it carries the most weight, used in a natural sentence and not repeated beyond what the text needs.

| Keyword | Where it appears | Why |
| --- | --- | --- |
| video downloader | Name, short description, first sentence | The category's main search term and what the app is; matches the package name |
| video saver / save videos | Short description, "SAVE VIDEOS" | How many users phrase the need ("save a video") |
| offline video player / watch offline | Short description, first paragraph, "WATCH OFFLINE" | Second core use: watch without a connection |
| browser / private browser | Short description, first sentence, "BROWSER" | The download flow starts in the built-in browser; "private" matches the no-tracking design |
| HD | "SAVE VIDEOS" (quality choice) | Common search qualifier; stated as "up to HD when the page offers it", which is true |
| MP4, WebM, HLS, DASH | "SAVE VIDEOS" | Format searches from technical users; all are supported in test2 |
| download manager (pause, resume, retry) | "SAVE VIDEOS" | Users look for reliable background downloads |
| Picture-in-Picture, playback speed | "VIDEO PLAYER" | Player features people search for |
| App Lock / private | "PRIVATE BY DESIGN" | Privacy is a differentiator; App Lock is real and optional |
| Urdu | "MADE FOR YOU" | Urdu speakers searching in English find the language support |

**After a month:** open Play Console → Grow → Store performance → *Search terms* (traffic and conversion per query);
move the two best-converting terms into the short description if they are missing, and drop any term above that
brings no installs.

## Release notes for the testing track (versionCode 2)

```
<en-US>
• Rate VidoraX: Settings → Help & Support → Rate VidoraX opens the Play Store page
• New guided tour of the Browser, Downloads, Player and Settings on first launch; replay it any time from Settings → How to use VidoraX
• Help & Support is easier to reach, with the support email shown and a Copy address option when no email app is installed
</en-US>
<ur>
• VidoraX کو ریٹ کریں: سیٹنگز ← مدد اور سپورٹ ← VidoraX کو ریٹ کریں سے Play Store کا صفحہ کھلتا ہے
• پہلی بار کھولنے پر براؤزر، ڈاؤن لوڈز، پلیئر اور سیٹنگز کا نیا رہنما دورہ؛ سیٹنگز ← VidoraX کیسے استعمال کریں سے کسی بھی وقت دوبارہ دیکھیں
• مدد اور سپورٹ تک پہنچنا آسان: سپورٹ ای میل دکھائی جاتی ہے، اور ای میل ایپ نہ ہو تو پتہ کاپی کرنے کا آپشن
</ur>
```

## Screenshots and feature graphic (T5)

_Filled in by T5._
