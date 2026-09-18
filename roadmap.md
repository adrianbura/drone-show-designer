# Roadmap

- [x] Real GPS site: origin, heading, perimeter, margin, ceiling (canonical geo module + migration)
- [x] Site authoring panel + viewport geofence overlay
- [x] Audience coordinates on the site, with derived viewing direction and facing yaw
- [x] Block export on GPS perimeter breach via full-show validation (regression-tested)
- [x] Restrict Visuals, Transform, Colour, and Motion authoring to SHOW clips
- [x] Real-typeface text: glyph pack registry + Archivo wide outline pack + typeface picker
- [x] Shape and figure library (10 parametric figures + searchable, categorised picker)
- [x] Mermaid figure with an animatable tail (SWAY_Z part motion -> tail-wag motion group)
- [ ] Copy / paste and show templates
- [ ] Advanced lighting effects
- [x] PDF validation report (downloadable document projected from the existing full-show analysis)
- [x] Browser frame-time probe at 150 and 500 drones (software-GL sandbox numbers recorded below)
- [ ] Viewport render cost: idle frames are as expensive as playing frames; make the preview redraw only on change
- [ ] ~~Automatic beat detection~~ — dropped by the owner: show moments are authored manually, the manual BPM grid stays
- [ ] ~~.skyc export~~ — dropped: the target hardware loads ESSP, which the app already reads and writes byte-identically

## Browser frame-time probe (18 Sep 2026, headless software GL — not GPU-representative)

| Fleet | Paused | Playing |
| --- | --- | --- |
| 150 | 62 ms/frame (16 fps) | 107 ms/frame (9 fps) |
| 500 | 158 ms/frame (6 fps) | 220 ms/frame (5 fps) |

One canvas surface in both cases (the two-instanced-surface contract holds). The idle
cost proves the viewport redraws continuously even when nothing moves — the first real
optimisation target, independent of the software renderer.
