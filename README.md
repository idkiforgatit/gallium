<p align="center"><img src="docs/icon.png" width="128" alt=""></p>
<h1 align="center">Gallium</h1>
<p align="center">A calm, Arc-style browser for Windows. Liquid Glass, Spaces and real photo wallpapers, built on Chromium (WebView2) with Tauri.</p>
<p align="center"><a href="https://idkiforgatit.github.io/gallium/">Website</a> · <a href="https://github.com/idkiforgatit/gallium/releases/latest">Download</a></p>

## Build

Needs Node.js, Rust and the WebView2 runtime (built into Windows 11).

```bash
npm install
npm run dev     # run in development
npm run build   # installer in src-tauri/target/release/bundle
```

## Themes and mods

Themes (`.gtheme`) and mods (`.gmod`) are plain JSON files: a theme holds colours, a few settings and an optional picture, a mod holds CSS. Nothing in them ever runs. `src/gformat.js` checks every file (the app, the website and the scan job all use it; `docs/gformat.js` is a copy that `tools/scan.js` keeps in sync). Run its tests with `node tools/gformat.test.js`.

Files in `docs/packages` show up on the [Themes & Mods page](https://idkiforgatit.github.io/gallium/themes.html). The `Scan themes and mods` workflow checks and virus-scans them with ClamAV on every change and weekly, and Gallium scans again with Microsoft Defender before installing. `node tools/make-packages.js` rebuilds the starter set.

Not affiliated with Apple or The Browser Company. The wave and liquid-metal wallpapers are Gallium's own renders; the photos are from [Unsplash](https://unsplash.com).
