# vidorax-cli (P6 #501)

Control VidoraX on your phone from a terminal on the same Wi-Fi. A POSIX shell script; needs only `curl`.

```sh
# On the phone: VidoraX → Settings → Downloads → Remote control → turn it on.
extensions/cli/vidorax-cli pair http://192.168.1.20:41234 123456
extensions/cli/vidorax-cli add https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4
extensions/cli/vidorax-cli list
extensions/cli/vidorax-cli pause <id>      # or: pause --all
extensions/cli/vidorax-cli resume <id>     # or: resume --all
extensions/cli/vidorax-cli unpair
```

- `pair` saves the address and token in `~/.config/vidorax-cli/config` (mode 600). `VIDORAX_URL` and `VIDORAX_TOKEN`
  override it, e.g. for scripts.
- The token is handed to curl on stdin (`curl -K -`), never on the command line.
- `add` waits up to `VIDORAX_WAIT` seconds (default 60) for the phone to check the link and prints the outcome:
  added, already there, needs review on the phone, or refused (YouTube, DRM, audio-only…). `--no-wait` returns at once.
- `list` prints a tab-separated table: `ID  STATE  PROGRESS  TITLE`.
- Exit status: 0 done, 1 error (message on stderr), 2 wrong usage.

The JSON API behind it is in `docs/REMOTE_API.md`.
