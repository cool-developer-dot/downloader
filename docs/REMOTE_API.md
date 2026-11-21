# VidoraX Remote control API (P6 — #439 Web UI, #438 Remote, #501 CLI, #500 extension, #511 Send to device)

The phone runs a small web server while **Settings → Downloads → Remote control** is on. It is the only server
involved: there is no backend of ours, and nothing is reachable from the internet.

## Where it listens and when it stops

- **Address:** the phone's IPv4 address on its Wi-Fi (or wired) network, never mobile data or a VPN, on a random
  port between 20000 and 59999 (the same port is reused next time when it is free). It also listens on the phone's
  loopback (127.0.0.1) on the same port, so a computer on USB can use `adb forward tcp:8080 tcp:<port>`; loopback is
  not reachable from the network.
- **Stops by itself** after 30 minutes with no request, as soon as the Wi-Fi network is lost (or the address
  changes), and one minute after VidoraX leaves the screen unless downloads are running. It is started only from the
  app and never starts on its own. No service of its own: while downloads run, the existing download runner keeps the
  app alive (no new foreground-service type).

## Security

- **Host check:** a request must name the address shown on the phone (`Host: 192.168.1.20:41234`; loopback names on
  the loopback listener). Anything else gets `421` — this stops DNS-rebinding pages.
- **Origin check:** a request carrying an `Origin` must come from the Web UI itself or a browser extension
  (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`); other web pages get `403`, and only
  extensions get CORS headers (with `Access-Control-Allow-Private-Network`). Every `POST` must be
  `Content-Type: application/json`, so a page cannot send a "simple" cross-site form either.
- **Pairing:** a 6-digit PIN shown on the phone (and in the phone's QR code, after `#`). Wrong PINs are rate limited
  for everyone: 5 wrong → 30 s lock, doubling per lock (max 15 min); 15 wrong → the PIN is withdrawn until the user
  taps "New PIN". A paired client gets a random 256-bit token; the phone keeps only its SHA-256 hash, at most 10
  clients, each forgotten after 90 days unused, or from the phone's screen at any time.
- **Limits:** request bodies ≤ 16 KB with a `Content-Length` (never written to disk), at most 16 connections.
- Answers never contain a media URL, a file path or a token hash. Pages are served with a strict CSP,
  `X-Frame-Options: DENY`, `nosniff`, `no-referrer` and `Cache-Control: no-store`.

## Endpoints

All under `/api/v1/`. Everything except `info` and `pair` needs `Authorization: Bearer <token>`. Errors are
`{"error": "<code>", "message": "<English text>"}`.

| Method & path | Body | Answer |
| --- | --- | --- |
| `GET info` | — | `{"name":"VidoraX","api":1,"language":"en"}` |
| `POST pair` | `{"pin":"123456","name":"Chrome on macOS"}` | `200 {"token","clientId","name"}` · `401 wrong_pin {attemptsLeft}` · `429 locked {retryAfterSeconds}` + `Retry-After` · `403 pairing_closed` |
| `POST unpair` | `{}` | Forgets the caller's token. |
| `GET downloads` | — | `{"downloads":[{id,title,state,site,quality,bytesDone,totalBytes,fraction,speedBps,etaSeconds,errorCode,createdAt,updatedAt,actions}]}` — the engine's list: everything not finished plus what finished in the last 24 h. `actions` ⊆ `pause`, `resume`, `retry`, `cancel`. |
| `GET downloads?format=tsv` | — | `ID\tSTATE\tPROGRESS\tTITLE` lines (the CLI's `list`). |
| `POST downloads` | `{"url":"https://…","source":"web"\|"extension"\|"cli"}` | `202 {"requestId","status"}` — `status` is `checking`, or `waiting_for_app` when VidoraX's screen isn't running yet. `400 invalid_url`, `503 busy` (50 links waiting). |
| `GET links/<requestId>` | — | `{"requestId","status","title","downloadId","detail"}`; `status` ends as `added`, `duplicate`, `needs_review` or `refused`. |
| `POST downloads/<id>/pause` · `resume` · `retry` · `cancel` | `{}` | `200 {"ok":true}` · `404 not_found` · `409 invalid_state` |
| `POST queue/pause-all` · `queue/resume-all` | `{}` | `200 {"ok":true}` |
| `GET sent` | — | `{"items":[{id,title,url,hasFile,sizeBytes,sentAt}]}` — the "Sent from phone" list. |
| `DELETE sent/<id>` | — | Removes it from the list. |
| `POST sent/<id>/ticket` | `{}` | `{"href":"/files/<ticket>/<name>"}` — a 10-minute download path for the item's video (`404 no_file` for a link). |

`GET /files/<ticket>/<name>` (no token: the ticket is the secret) streams the video with
`Content-Disposition: attachment` and single `Range` support. A video moved to Private or deleted is no longer served.

A link sent with `POST downloads` goes through exactly what a link pasted into the app goes through (Batch Add): the
page is read, the video verified, YouTube / DRM / audio-only / private hosts refused, and the engine's duplicate
check applied. It is added at the default quality.

## Examples (curl)

```sh
PHONE=http://192.168.1.20:41234
TOKEN=$(curl -s -H 'Content-Type: application/json' -d '{"pin":"123456","name":"curl"}' $PHONE/api/v1/pair | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $TOKEN" "$PHONE/api/v1/downloads?format=tsv"
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"url":"https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4","source":"cli"}' \
  $PHONE/api/v1/downloads
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' $PHONE/api/v1/queue/pause-all
```

`extensions/cli/vidorax-cli` wraps these (pair, add, list, pause, resume, retry, cancel, sent, unpair).
