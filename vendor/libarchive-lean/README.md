# Lean libarchive.js artifacts

These five files are a matched build for libarchive.js 2.0.2. The WASM is 862,582 bytes and was built without OpenSSL. Password-protected archives are detected when possible and rejected; decryption is not provided. The JavaScript glue and WASM must come from the same build because WASM export names can differ between builds.

`SHA256SUMS` fixes the bytes of all five files. Run `node scripts/vendor-libarchive.mjs --verify` from the repository root to validate them. Run `node scripts/vendor-libarchive.mjs` to replace the five installed dist files and copy the browser worker and WASM into `public/vendor/libarchive/` as a pair. The generated public directory is ignored by Git.

The browser loads that pair from `/vendor/libarchive/`. The installed library also contains an unused fallback URL for its worker. `scripts/libarchive-vendor-plugin.mjs`, registered in `astro.config.mjs`, replaces that one expression before Vite processes asset URLs. This prevents a second worker from being emitted in `_astro/` while leaving the ZIP worker path alone. The plugin checks the installed version and expression before changing the module.

A temporary browser entry importing `src/app/engine.ts` emitted `_astro/worker-bundle-K0KAlExN.js` before this replacement. Under the same Vite build conditions, the output afterward contained the app entry and ZIP worker chunks, with no libarchive worker chunk in `_astro/`.

In a production build served locally and opened in Chromium, a temporary page listed and extracted `sample.tar`, `sample.7z` and a RAR5 archive through `openArchive`. Each archive opened a worker from `/vendor/libarchive/worker-bundle.js` only; no `_astro/worker-bundle-*` request was made, and `dist/` contained the worker and WASM only under `vendor/libarchive/`.

Run `npx vitest run tests/unit/libarchive-build.test.ts --cache=false` to build the app engine entry in isolated output directories and check both normal and NOTICE analysis settings. The test checks the vendor bytes, duplicate files, browser references, and sourcemap attribution. Run `npm run notice:check` and `npm run size` after the regular build. The analysis build retains sourcemaps, and the static worker and WASM remain attributed to their source packages in NOTICE.

A new build must be reviewed and its five hashes updated together before use.

The [rebuild recipe](../../wasm/libarchive-lean/README.md) describes the component versions, verification gates, and artifact update process.

[Component metadata](components.json) and primary-source [license texts](licenses/) feed the generated [NOTICE](../../NOTICE.md). The npm packages copied to public assets are identified explicitly by the generator.
