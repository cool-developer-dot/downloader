# TikTok MSE source correlation — real Android acceptance

All items: **NOT_TESTED**

Static verification is not device proof.

## A. Open /foryou first video

Expected: owner + identity + candidate + verified offer without a second scroll.

Status: **NOT_TESTED**

## B. CTA first video

Tap Download. Expected: the current TikTok video enqueues in Phase 1 (not blob).

Status: **NOT_TESTED**

## C. 20-video scroll

Each supported current video: identity changes; source correlates to the current item.

Status: **NOT_TESTED**

## D. Fast A→B→C→D

Download D. Expected: D only.

Status: **NOT_TESTED**

## E. Blob/MSE

Expected: `blob:` is never handed to Phase 1.

Status: **NOT_TESTED**

## F. Preload

Expected: future B/C media does not replace current A while A is owner.

Status: **NOT_TESTED**

## G. Consumption

A successfully enqueued → CTA hides for A. B gets a new CTA.

Status: **NOT_TESTED**

## H. Native app containment

Still no TikTok native launch.

Status: **NOT_TESTED**

## I. Privacy

No signed query / Cookie / Authorization in logs.

Status: **NOT_TESTED**
