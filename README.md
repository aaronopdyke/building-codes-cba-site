# Building Codes CBA — demo site

Static GitHub Pages explorer for seismic building-code cost-benefit results:
hex-tile maps (BCR, avoided losses, AAL), SSP scenario summaries, and retrofit
priorities per building class. **Illustrative demo — modelled aggregates only.**

Live site: https://aaronopdyke.github.io/building-codes-cba-site/

## How it fits together

- The analysis lives in the private `building-regulations-CBA` repo (data on a
  private Drive). GitHub Pages cannot read any of that — this repo holds ONLY
  exported aggregates (hex GeoJSON, metrics JSON, streams CSV, retrofit top-20)
  under `docs/data/`, written by `S.site_export()` in the analysis notebook.
- `pages/` — plain HTML sources (edit these).
- `docs/` — what Pages serves: encrypted copies of the pages, plus
  `assets/` (JS/CSS) and `data/` (exported payloads).
- `tools/protect.py` — password-gates the HTML (AES-256-GCM + PBKDF2,
  decrypted in-browser via WebCrypto). Python equivalent of
  [StatiCrypt](https://github.com/robinmoisson/staticrypt); `npx staticrypt
  pages/*.html -d docs` works too if you prefer Node.

## Publishing a data update

```bash
# 1. in the analysis notebook: S.site_export()   (writes docs/data/)
# 2. re-gate the HTML (only needed if pages/ changed):
py tools/protect.py            # prompts for the password
# 3. push:
git add -A && git commit -m "Update site data" && git push
```

Pages serves `docs/` on the main branch. To preview locally:
`py tools/protect.py --plain && py -m http.server -d docs 8000`.

## Security note (read this)

The password gate is **demo-grade, client-side protection**: it encrypts the
HTML shell only. Everything under `docs/data/` and `docs/assets/` remains
fetchable by direct URL, and the repo itself is public. Do not publish
sensitive data here. Rotating the password = re-running `tools/protect.py`
and pushing.

## License / attribution

**CC BY-NC-SA 4.0** — see [LICENSE](LICENSE). Matches the GEM Global
Vulnerability + Exposure Model licenses (CC BY-NC-SA 4.0) the results derive
from; GHSL and World Bank inputs are CC BY 4.0 and attributed in the LICENSE
file. See the site's About page for method and caveats.
