# Lean libarchive.js artifacts

These five files are a matched build for libarchive.js 2.0.2. The WASM is 862,582 bytes and was built without OpenSSL. Password-protected archives are detected when possible and rejected; decryption is not provided. The JavaScript glue and WASM must come from the same build because WASM export names can differ between builds.

`SHA256SUMS` fixes the bytes of all five files. Run `node scripts/vendor-libarchive.mjs --verify` from the repository root to validate them. Run `node scripts/vendor-libarchive.mjs` to replace the five installed dist files and copy the browser worker and WASM into `public/vendor/libarchive/` as a pair. The generated public directory is ignored by Git.

A new build must be reviewed and its five hashes updated together before use.

The [rebuild recipe](../../wasm/libarchive-lean/README.md) describes the component versions, verification gates, and artifact update process.
