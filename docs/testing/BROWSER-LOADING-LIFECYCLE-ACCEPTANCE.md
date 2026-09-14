# Browser Loading Lifecycle — Real Android Acceptance

**Rule:** Mark **NOT_TESTED** until verified on a real Android device.

| # | Case | Expected | Status |
|---|---|---|---|
| 1 | google.com | Page usable; spinner stops | NOT_TESTED |
| 2 | Normal article page | Spinner stops | NOT_TESTED |
| 3 | TikTok | Spinner stops | NOT_TESTED |
| 4 | Instagram | Spinner stops | NOT_TESTED |
| 5 | HLS test page | Spinner stops while media/.ts requests continue | NOT_TESTED |
| 6 | Redirect-heavy page | Spinner stops after final document | NOT_TESTED |
| 7 | SPA navigation | No permanent spinner | NOT_TESTED |
| 8 | Failed URL | Error UI + spinner stops | NOT_TESTED |
| 9 | Back | Spinner stops after settle | NOT_TESTED |
| 10 | Forward | Spinner stops | NOT_TESTED |
| 11 | Home | Spinner cleared | NOT_TESTED |
| 12 | Tab A loading → switch B | No spinner leak onto B | NOT_TESTED |
| 13 | Switch back to A | Correct loading state | NOT_TESTED |
