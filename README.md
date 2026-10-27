# SGP Tactical — decompiled Android Studio project

Rebuilt, buildable Android Studio project for `com.sgp.tactical` ("SGP Tactical", versionCode 2, v2.0),
recovered from `SGP_Tactical_v4.apk`.

**Status: `./gradlew clean assembleDebug` succeeds.** A debug APK is produced at
`app/build/outputs/apk/debug/app-debug.apk` and still launches `com.sgp.tactical.MainActivity`.

## Open it

Android Studio → *Open* → select this folder (`analysis/SGP_Tactical_AndroidStudio`).
Let it sync (it will use the bundled Gradle 8.13 wrapper and `local.properties`, which points at
`~/Android/Sdk`). JDK 21 is required.

## What the app actually is

A **Capacitor 8 hybrid app**. There is almost no native code:

| File | Role |
|---|---|
| `app/src/main/java/com/sgp/tactical/MainActivity.java` | Extends `BridgeActivity`; only calls `registerPlugin(CyberPlugin.class)` |
| `app/src/main/java/com/sgp/tactical/CyberPlugin.java` | The whole native surface: Wi-Fi/BLE/LAN scanning, ARP table, port scan, shell exec, root check |
| `app/src/main/assets/public/` | The real UI — plain, readable HTML/CSS/JS (`index.html`, `app.js`, `oui-mini.js`) |
| `app/src/main/assets/capacitor.config.json` | Capacitor config (appId, `webDir: www`, https scheme) |

The web layer is not obfuscated, so it can be read directly — start at `assets/public/app.js`.

## Versions pinned

- `@capacitor/android` **8.5.3**, vendored as the local module `capacitor-android/` (Capacitor is not
  published to Maven; it ships as Gradle source from npm). The version was identified by matching the
  decompiled `com.getcapacitor` class set 60/60 against npm release tarballs.
- compileSdk 36, targetSdk 36, minSdk 24, AGP 8.13.0, Gradle 8.13, Java 17 app / 21 module.

## Repairs needed to make it compile

Decompiler output is never directly buildable; these were the concrete blockers:

1. **Deleted `app/src/main/java/com/sgp/tactical/R.java`** — Gradle regenerates `R` from resources.
2. **Deleted `res/values/public.xml`** — pins fixed resource IDs and breaks AAPT2.
3. **Removed 299 `<attr>` declarations from `res/values*/`** — the decoded `res/` already contained
   every library resource (they were merged into the original APK), so they collided with the same
   attrs from the real appcompat/core/capacitor AARs. Done structurally with
   `tools/strip_dup_attrs.py`; all 404 dependency attrs were left to the libraries.
4. **`MainActivity`/`CyberPlugin` jadx artifacts:**
   - `@CapacitorPlugin(name = CyberPlugin.TAG)` → inlined the literal `"CyberPlugin"` (the annotation
     sits outside the class body, so the private constant isn't in scope).
   - `this.f$0.lambda$...` (outer-instance refs inside jadx-inlined anonymous classes) →
     `CyberPlugin.this.lambda$...`.
   - `mergeDevicesWithArp()` lost its exception handler around the second loop; the `try/catch
     (JSONException)` was restored, otherwise the file doesn't pass javac.

## Map tile providers (patched)

The original build pointed the basemap at providers that now demand API keys, so the map rendered
"API KEY REQUIRED" placeholder tiles. Verified by fetching each tile directly:

| Layer | Original (broken) | Response | Now uses |
|---|---|---|---|
| Dark Tactical | CARTO `dark_all` | 200 but a 2.5 KB "API key required" PNG | Esri World Dark Gray Canvas |
| Night vision | CARTO `dark_nolabels` | same placeholder | Esri World Dark Gray Canvas |
| Grey ops | CARTO `light_all` | same placeholder | Esri World Light Gray Canvas |
| Street Intel | `tile.openstreetmap.org` | HTTP 418 "Access blocked" | Esri World Street Map |
| Hybrid labels | CARTO `dark_only_labels` | placeholder | Esri World Boundaries & Places |
| Watercolor | Stadia Maps (Stamen) | HTTP 401 | Esri World Shaded Relief |

All replacements are keyless Esri ArcGIS Online services — the same host the app already used for
Satellite/Ocean/NatGeo, so nothing new is required. `maxNativeZoom` is set below the Esri native limit
so Leaflet upscales instead of showing blank tiles when you zoom deeper.

Night Vision shipped with the `.map-tiles-nightvision` class but no matching CSS rule, so it rendered
identically to Dark Tactical. A green tint rule was added to `style.css` (on the layer container —
Leaflet applies `className` there, not to the tile images).

This is an edit to `assets/public/app.js`, not a decompiler artifact.

## Scan / live data (patched)

Drawing a scan box loads OSM data. That path was broken in four separate ways:

| # | Problem | Fix |
|---|---|---|
| 1 | `loadCameras()` called `fetchOverpass()`, a function that does not exist (ReferenceError) | calls `queryOverpass()` |
| 2 | Public Overpass mirrors: `overpass-api.de` 406, `kumi` 429, `mail.ru` intermittent 504 | race all mirrors in parallel, first answer wins |
| 3 | A hanging host (OpenSky) left `DOWNLOADING DATA...` up forever, because native HTTP removes the CORS failure that used to end it | `fetchWithTimeout()` on every external call |
| 4 | Nothing loaded at all when every mirror was down | fallback to the official OSM map API, reshaped into Overpass-style elements |

The fallback fetches `api.openstreetmap.org/api/0.6/map?bbox=...` (no key), parses the XML and
filters locally with the same tag predicates the Overpass queries used, so no loader logic changed.
One in-flight request is shared across the four loaders. First scan takes ~15-30 s (the payload is
several MB); results are then cached per bounding box.

`CapacitorHttp` is enabled in `capacitor.config.json` so requests leave through the native stack
instead of the WebView, which is what makes the cross-origin APIs (OpenSky, Nominatim) reachable.

## Locate-me control

Two Leaflet controls sit under the zoom buttons, both styled by `.map-locate-btn`:

- `◎` locate — recentres on the device GPS fix via the existing `locateUser()`
- `🗂` layers — toggles the "LAYERS & LIVE DATA" panel, the same one the `CAPAS` tool button opens

The `CAPAS` button itself lives at the far right of the horizontally scrolling tool strip (after
UNITS), so it is easy to miss — hence the on-map button.

## Layer toggles

Police/hospitals/fire/military/government markers are the **Infrastructure** toggle; towers are
**Cell Towers**; the moving cars are **Traffic / Vehicles**. Overpass is only queried for the
features whose toggle is on, so turning one off also removes it from the scan.

## Caveats

- Source is **decompiled, not original**: names like `jSONObject3`, `string4` are jadx artifacts.
  Logic is faithful; comments, formatting and some inlined generics are not.
- 85 library classes failed jadx decompilation during the full dump. None are app classes.
- `assets/public/` is the **prebuilt** web bundle. There is no npm/Ionic toolchain here, so
  `npx cap sync` is not wired up — edit the JS in place if you want to experiment.
- No native `.so` libraries are in the APK (`extractNativeLibs=false`, empty `lib/`).
- `release` builds will need your own signing config.

## Reference material (not compiled)

- `reference/decompiled-java/` — full jadx output: all 2,541 classes, including every library, so you can
  read how `com.getcapacitor`, androidx etc. actually behave in this build.
- `reference/apktool/` — apktool decode: original `AndroidManifest.xml`, decoded resources and smali.
