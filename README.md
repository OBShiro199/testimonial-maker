# Testimonial Studio

A small, dependency-free web app for recording video testimonials.

1. **Sign in** with the password (`rosewell`).
2. **Frame**: turn on the webcam and centre your face in the oval. Live checks show when you're centred and sitting still.
3. **Record**: a 3-2-1 countdown starts the take, and the teleprompter at the top (right under your camera) scrolls the script.
4. **Export**: review the take, retake it, or download it (MP4 where the browser supports it, otherwise WebM).

The script, scroll speed and text size are saved in the browser. You can also scroll the teleprompter by hand.
Shortcuts: `Space` starts or stops recording, and `↑`/`↓` change the scroll speed.

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
