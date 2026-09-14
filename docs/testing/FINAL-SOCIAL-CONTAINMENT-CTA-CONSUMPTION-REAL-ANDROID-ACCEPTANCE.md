# Final social containment + CTA consumption — real Android acceptance

All items: **NOT_TESTED**

Static verification is not device proof.

## ANDROID TEST A — TikTok no escape

Open TikTok inside VidoraX. Browse normally. Scroll at least 20 videos.

Expected: TikTok app never launches; no chooser; no Play Store; no Chrome; VidoraX remains current; no `Can't open url: snssdk…`.

Status: **NOT_TESTED**

## ANDROID TEST B — TikTok Open-app controls

Trigger any visible TikTok “Open app” control.

Expected: nothing leaves VidoraX; page usable; CTA correct for current video; no loading-spinner corruption.

Status: **NOT_TESTED**

## ANDROID TEST C — CTA consume

Video A → CTA visible → Download → quality if needed → enqueue accepted.

Expected: CTA disappears for A. Remain on A 30 seconds: CTA does not return.

Status: **NOT_TESTED**

## ANDROID TEST D — CDN refresh

After A is accepted, remain on A long enough for a source refresh.

Expected: CTA remains hidden.

Status: **NOT_TESTED**

## ANDROID TEST E — Next video

A consumed → scroll B → CTA B → enqueue B → CTA B hidden → scroll C → CTA C.

Status: **NOT_TESTED**

## ANDROID TEST F — Quality cancel

Video C → Download → quality sheet → cancel.

Expected: CTA C remains/returns. C is not consumed.

Status: **NOT_TESTED**

## ANDROID TEST G — Failure

Use a safe handoff failure if practical.

Expected: CTA is not permanently lost.

Status: **NOT_TESTED**

## ANDROID TEST H — Fast scroll

A → B → C → D quickly. Stop D. Tap Download.

Expected: D downloads. After accepted enqueue, CTA D disappears. Previous videos not consumed accidentally.

Status: **NOT_TESTED**

## ANDROID TEST I — Instagram

Reel A → CTA → enqueue A → CTA hides → scroll B → CTA B. No Instagram app launch.

Status: **NOT_TESTED**

## ANDROID TEST J — Snapchat

Accessible supported video A → CTA → enqueue → hide. New video B → CTA B. No Snapchat app launch.

Status: **NOT_TESTED**

## ANDROID TEST K — General website

Video A → CTA → enqueue accepted → hide. Player switches to B → CTA B.

Status: **NOT_TESTED**

## ANDROID TEST L — Tabs

Tab A consumed video → CTA hidden. Tab B unconsumed → CTA visible. Switch repeatedly. No cross-tab consumption.

Status: **NOT_TESTED**

## ANDROID TEST M — Console

Must not show `Can't open url: snssdk1233://` / `snssdk1340://` / native TikTok intent launch errors.

Status: **NOT_TESTED**

## ANDROID TEST N — Privacy

Logs must not expose Cookie, Authorization, requestContext, password, OTP, signed query strings.

Status: **NOT_TESTED**
