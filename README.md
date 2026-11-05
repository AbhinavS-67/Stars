# A Sky For Two

A personal celestial tracker and AR sky finder. Ranchi (her sky, **Capricornus**) and Manipal (his sky,
**Sagittarius**), joined by a glowing "celestial tether" between the brightest stars of the two signs.

Streamlit serves the page. The sky is a static web app in `frontend/` that runs entirely in the visitor's
browser: canvas renderer, astronomy maths (checked against `astronomy-engine`), bundled Hipparcos star data.

```
app.py                     Streamlit shell (hides Streamlit chrome, embeds the sky)
requirements.txt           streamlit
.streamlit/config.toml     dark theme
frontend/
  index.html  main.js
  config.json              <-- every personal text lives here
  css/style.css
  components/  SkyCanvas.js  ARView.js  Dashboard.js
  utils/       celestialMath.js  skyModel.js  orientation.js  weather.js  audio.js  bridge.js  text.js
  data/        stars.json  constellations.json  starnames.json
tools/                     data builder + test scripts (not needed at runtime)
```

## Run it

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Deploy on Streamlit Community Cloud

1. Push this folder to a GitHub repo.
2. On share.streamlit.io choose the repo, branch, and main file `app.py`.
3. Open the URL on the phone. Cloud apps are served over HTTPS, which the camera and motion sensors require.

If you host the app anywhere else (your own server, Docker), it must be HTTPS too, or the browser will
refuse camera and motion access.

The `frontend/` folder is plain static files, so it also works on GitHub Pages or Netlify if you ever want
a link that opens straight into the sky with no Streamlit around it.

## Personalise without touching code

Edit `frontend/config.json` (a normal text file). Nothing else needs changing.

| Key | What it controls |
|---|---|
| `names.her`, `names.him` | Optional names. Empty = "you" / "me". |
| `intro.*` | Welcome screen: eyebrow, title, subtitle, button label, `show: false` to skip it. |
| `reveal.cap`, `reveal.sgr`, `reveal.both` | Messages that fade in the first time each sign is found in AR (and when both are). |
| `lockOn.cap`, `lockOn.sgr` | One-line note on each lock-on card. |
| `bridge.*`, `tether.*` | Text for the bridge section, tether label and caption, which two stars the tether joins. |
| `footer` | Line at the bottom of the panel. |
| `observers.*` | Names and coordinates for the two places. |
| `features.defaultLayers` | Which overlays start switched on. |
| `ar.*` | Default camera field of view, lock-on radius, magnetic declination. |

Tokens usable inside any text: `{her}` `{him}` `{km}` (distance on the ground) `{sep}` (degrees between the
two signs) `{tetherSep}` `{tetherFrom}` `{tetherTo}`.

## Using it

* **Dome view** (default): drag to look around (with inertia), pinch or scroll to zoom, double-tap to recentre.
  Switch between Ranchi, Manipal, or your GPS position at the top. Time travel and "Best time for both" are in the panel.
* **AR**: tap *Launch AR sky finder*. It asks for motion access first (iOS), then the camera. Point the phone at the
  sky; the arrow and text guide you to the selected sign, and a card appears when it is centred.
* If the sky is not lined up with the real horizon (some phones have no absolute compass), tap **Align north** and drag sideways.
* AR always uses the live clock. The dome can show any time.

### If AR does not start inside the Streamlit frame

Phones can be strict about cameras inside embedded frames. Tap the **expand icon** (top of the right-hand column)
to open the sky as its own full-screen page; AR is most reliable there.

Fallbacks: camera but no motion sensors = camera with drag-to-look; sensors but no camera = gyro-driven sky on a dark
background; neither = normal dome view.

## Rebuilding the star data (optional)

```bash
cd tools && npm install        # downloads d3-celestial (star data) and test tools
python3 -I build_data.py       # rewrites frontend/data/*.json (limiting magnitude is MAG_LIMIT in the script)
node test_math.mjs             # checks the astronomy maths against astronomy-engine
```

## Notes and limits

* Positions use a standard precession model and Sun/Moon series good to a fraction of a degree. Planets are not drawn.
* The Moon is drawn with its real phase and position; its size is exaggerated so it is visible.
* Phone compasses are typically good to a few degrees, so expect to nudge the alignment.
* Weather uses Open-Meteo (free, no key). If it cannot be reached the cloud figure is an estimate and is marked with `*`.
* The Sun is above the horizon in the daytime; the app shows the stars anyway as a "preview" and says so.

Credits: star and constellation data from d3-celestial (BSD-3-Clause), derived from the Hipparcos catalogue and IAU
boundaries. Weather by Open-Meteo.

## What's new in this version
- Smoother: idle sky redraws at ~30 fps, Milky Way is cached, adaptive quality tiers, no per-frame allocations.
- Cleaner layout: compact top bar, tools rail (Find, Layers, Save, Sound), tappable cards, landscape and small-phone layouts.
- New features: planets (precomputed 2026-2028 in `frontend/data/planets.json`, rebuild with `tools/build_planets.mjs`), tap any star/planet for details, Find search, "Best time for both" button, shooting stars with a wish, hearts on your two stars (`ourStars` in config.json), a note of the night (`dailyNotes`), and Save as picture.
- All texts stay in `frontend/config.json`.

## Streamlit hosting (important)
The app ships as one self-contained file, `sky.html` (code, styles and star data inlined), which `app.py` renders directly. No extra files are served, so it works on Streamlit Community Cloud. `static/sky.html` is a copy Streamlit serves for the full-screen button (best for camera and motion sensors).
If you change `frontend/config.json` or any frontend file, run `cd tools && npm i esbuild && node bundle.mjs` and re-upload `sky.html` and `static/sky.html`.
