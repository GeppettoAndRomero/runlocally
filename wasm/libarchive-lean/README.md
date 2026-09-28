# Lean libarchive build

The Dockerfile builds libarchive.js v2.0.2 with emsdk 3.1.52, libarchive 3.7.2, zlib 1.3, xz 5.2.11, and bzip2 1.0.8. OpenSSL is disabled. The JavaScript bundles and WASM are generated together because their export names must match.

Build from the repository root:

```sh
docker buildx build --file wasm/libarchive-lean/Dockerfile --output type=local,dest=wasm/libarchive-lean/out wasm/libarchive-lean
```

The output contains five matched distribution files and `libarchive-configure.log`. The manual workflow checks that the WASM has no OpenSSL or SSLeay strings, is smaller than 1,002,547 bytes, and creates and checks `SHA256SUMS`. Its artifact contains all seven files.

Review a new build before replacing the five files in [the vendor directory](../../vendor/libarchive-lean/README.md). Replace all five together, update their `SHA256SUMS`, and run `node scripts/vendor-libarchive.mjs --verify`. A rebuild is not guaranteed to reproduce the existing hashes because external source and tool inputs can change.
