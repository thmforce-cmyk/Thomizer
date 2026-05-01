# THOMIZER v.alpha.0.3 test branch package

Branch target: `gui-hardware-v01`

## Main changes

- Compact modular hardware-style layout.
- Always-visible floating `LOCK` / `LOCKED` screen-lock button.
- Sticky collapsible player dock.
- Polyphonic sequencer grid: multiple notes can now be active on the same step.
- Left-side note labels retained.
- Scale changes subtly alter background glow.
- Delay module renamed to `THOMLAY AY-Y420`.
- `DELAY FB` renamed to `FEEDBACK`.
- `DUBBER` renamed to `FORCER`.
- Visible Delay EQ / LOW / HIGH controls removed; the tonal shaping remains internal under `FORCER`.
- `HOW MUCH?` now controls compressor plus light tape-style bus saturation.
- New sound list: `SINE`, `CHIPTUNE`, `BELL`, `FLUTE`, `RAVE STAB`, `DUB ORGAN`, `VOX CHOIR`.
- Minimal PWA icon set included.

## Files

```text
index.html
manifest.json
icons/
  icon-192.png
  icon-512.png
  apple-touch-icon.png
  favicon-32.png
  favicon.ico
  icon-source-selected.png
```

## Notes

The favicon file is a PNG fallback copied to `.ico` extension for broad simple-host compatibility. Browsers also receive `favicon-32.png` explicitly from `index.html`.
