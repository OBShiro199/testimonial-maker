# Testimonial Studio

A small, dependency-free web app for recording video testimonials. It is styled with the Quiet Precision design system (white surfaces, hairlines, Geist, one pastel-blue accent).

1. **Sign in** with the password (`rosewell`).
2. **Frame**: turn on the webcam and centre your face in the oval. Live checks show when you're centred and sitting still.
3. **Record**: an optional 3-2-1 countdown starts the take, and the teleprompter at the top (just under your camera) scrolls the script. You can pause and resume the recording.
4. **Export**: play the take back, retake it, or export it (MP4 where the browser supports it, otherwise WebM).

## Mirroring

With **Mirror video** on (the default), the recording is mirrored exactly like the preview, so playback and the exported file look the way you saw yourself. Turn it off in Settings to record the camera's unmirrored view.

## Teleprompter controls

| Control | Shortcut |
| --- | --- |
| Play or pause the teleprompter (works without recording, for rehearsing) | `P` |
| Back to the start | `Home` |
| Previous or next paragraph | `←` `→` |
| Speed in words per minute, 60–240 | `↑` `↓` |
| Text size S, M, L, XL | `[` `]` |
| Start or stop recording | `Space` |
| Pause or resume the recording | `M` |
| Shortcut list | `?` |

You can also scroll the teleprompter with the mouse wheel or by dragging, or click a paragraph to jump to it. The paragraph on the reading line is highlighted, and a progress bar shows time left at the current speed.

Settings: mirror video, 3-second countdown, play the teleprompter when recording starts, rewind the script before each take, and show the framing guide. The script, speed, size and settings are saved in the browser.

## Run locally

It's plain HTML, CSS and JS with no build step. Serve the folder over HTTP (camera access needs `localhost` or HTTPS):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Drop the folder onto any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages). It must be served over HTTPS for the camera to work.

## Notes

- The password check runs in the browser, so it is a casual gate, not real security. Anyone who reads the page source can find it. Put the site behind your host's password protection if that matters.
- Face centring uses MediaPipe's face detector, loaded from a CDN. If it can't load, the app falls back to the oval guide plus the stillness meter.
- Recordings never leave the device unless you export them.
