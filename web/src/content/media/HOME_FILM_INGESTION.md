# Home cinematic film — ingestion

For the CarUp media specialist. The Home hero already plays a film when a valid manifest is
present; until then it plays the live-listing reel. Ingesting a film is a manifest change plus
files. No component changes.

## 1. Before generating

- **Owner GO with a credit estimate.** Generation consumes Higgsfield credits; do not start without it.
- **Content rules:**
  - silent;
  - about 10–15 s, seamless loop;
  - several vehicle categories (SUV, sedan, pickup, city car, a closing showroom shot);
  - no burned-in text, prices, logos or navigation;
  - no fabricated manufacturer badges, implied partnerships or anything presented as inventory.

## 2. Deliverables

| File | Spec | Budget |
|---|---|---|
| `landscape.webm` | 1920×1080, AV1 or VP9, no audio track | ≤ 4 MB |
| `landscape.mp4` | 1920×1080, H.264 High, `+faststart`, no audio | ≤ 5 MB |
| `landscape-poster.jpg` | first frame, 1920×1080 | ≤ 150 KB |
| `portrait.mp4` (+ `.webm`) | 1080×1920, same encoding rules | ≤ 3 MB |
| `portrait-poster.jpg` | first frame, 1080×1920 | ≤ 120 KB |

Put the files in `web/public/media/home-film/`. Only same-origin files there are accepted.

## 3. Fill the manifest

In `web/src/content/media/homeFilm.ts`, set `HOME_FILM` to a `CinematicFilm`:

- **Sources:** each source gets `src`, `type`, `sha256` and `bytes`. List them preferred-first (WebM before MP4).
- **Posters:** each poster gets `src`, `sha256` and `bytes`.
- **Renditions:** each rendition gets `width`, `height` and `durationSeconds` (30 s or less).
- **`provenance`:**
  - generator and model;
  - every generation id;
  - generation date;
  - who approved this exact cut, and when;
  - where the approval is recorded.
- **`rights`:**
  - owner;
  - the licence the footage is used under;
  - a reference to that licence;
  - attribution, and any restrictions.
- **`disclosure`:** for example “CarUp brand film — editorial footage, not inventory”.

Hashes:

```sh
shasum -a 256 web/public/media/home-film/*      # sha256
wc -c web/public/media/home-film/*              # bytes
```

## 4. Verify before review

```sh
cd web && npx vitest run src/content/media src/components/showroom
```

- `validateFilm` refuses any manifest without rights, approval, hashes or same-origin paths, and the hero then falls back to the reel.
- `homeFilm.test.ts` re-hashes every listed file and fails on any mismatch.
- **Browser evidence:** run `scripts/video-path.mjs` from the RX03 evidence kit. It checks autoplay muted inline, Pause, the portrait rendition, reduced motion (poster only), Data Saver (no video request) and fallback on error. Also measure LCP and video bytes on a throttled phone.

## 5. What the page does with it

| Visitor condition | Behaviour |
|---|---|
| Default | autoplays muted and inline, loops |
| Pause pressed | pauses; stays paused |
| `prefers-reduced-motion: reduce` | poster only; the video is never downloaded |
| Data Saver or 2G | live-listing reel, or the brand plate; no video request |
| The film fails to load | live-listing reel |
| Off-screen, or tab hidden | paused |
