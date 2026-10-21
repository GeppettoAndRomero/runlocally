# Pinned libheif WASM/glue pair (not served)

This directory records the selected artifacts from **libheif-js 1.23.5**.
The npm dependency is pinned exactly, has no runtime dependencies, and declares
LGPL-3.0. Its repository is <https://github.com/catdad-experiments/libheif-js>.
The npm tarball is <https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz>;
its lockfile integrity is
`sha512-umXZPthnWZtF3iG/5mQG+AZ2V6i0UeYpo3z2CkggTEgL8dKmIIwJT6TDuAMuabXa1yTW8uJ1ZAgR+CxNTklYYw==`.

No page imports this library. The verifier only reads files; it does not fetch,
update hashes, or copy anything into public, dist, or node_modules. NOTICE and
precache are unchanged. Only the following non-bundle pair is selected:

| Package-relative path | Bytes | Brotli quality 11 bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `libheif-wasm/libheif.wasm` | 1,463,506 | 355,714 | `184d3d20f8323877f13e9f5254f9c6a0ce272c9a3a2f823b0b2bcd2ee9f73f80` |
| `libheif-wasm/libheif.js` | 91,255 | 25,669 | `376c0bb483c23ac458cd22d718074693748ea75eddc3e4929353d4153e365a2e` |

These values were measured locally. Reproduce from the repository root:

```sh
node scripts/vendor-libheif.mjs --verify
shasum -a 256 node_modules/libheif-js/libheif-wasm/libheif.wasm node_modules/libheif-js/libheif-wasm/libheif.js
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
for (const name of ['libheif.wasm', 'libheif.js']) {
  const bytes = readFileSync('node_modules/libheif-js/libheif-wasm/' + name);
  const compressed = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  console.log(name, bytes.length, compressed.length);
}
JS
```

The npm payload also contains `index.js`, `wasm.js`, `wasm-bundle.js`,
`libheif/{LICENSE,libheif.d.ts,libheif.js}`, and
`libheif-wasm/{LICENSE,libheif-bundle.js,libheif-bundle.mjs,libheif.d.ts}`.
Those other artifacts, including the bundle variants, are not selected or verified.

## Components and build provenance

[components.json](components.json) identifies components, versions, source trees,
license files and inclusion evidence. The eight files in [licenses/](licenses/)
are preserved without modification. Component versions are independent of the
npm wrapper version:

- libheif 1.23.5 (LGPL-3.0), source commit
  `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00` (tag `v1.23.5`).
  Runtime `heif_get_version()` reports `1.23.5`.
- libde265 1.0.15 (LGPL-3.0), HEVC decoder, tag `v1.0.15` at
  `17bb8d9fcea62db8cdeb0fc7ef8d15dbd19a22e4`.
- Emscripten 3.1.61 runtime and embind (MIT / NCSA), musl 1.2.5 (MIT),
  libc++ and libc++abi (Apache-2.0 with LLVM exceptions).

The upstream review supplied with these artifacts traced npm's
[`scripts/install.js`](https://github.com/catdad-experiments/libheif-js/blob/1.23.5/scripts/install.js)
to [libheif-emscripten release v1.23.5](https://github.com/catdad-experiments/libheif-emscripten/releases/tag/v1.23.5),
published 2026-09-28. The release lists the libheif commit above and provides
`libheif.js`, `libheif.tar.gz` (1,362,463 bytes), and `LICENSE`.
The release workflow sets `EMSCRIPTEN_VERSION=3.1.61`.

Rebuilding requires that toolchain, the libheif source commit, its
[`build-emscripten.sh`](https://github.com/strukturag/libheif/blob/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00/build-emscripten.sh),
the libde265 tag above, and the release workflow/packaging and wrapper install
steps. The build script defaults are `ENABLE_LIBDE265=1`,
`LIBDE265_VERSION=1.0.15`, `ENABLE_AOM=0`, `ENABLE_WEBCODECS=0`,
`ENABLE_UNCOMPRESSED=0`, `ENABLE_OPENJPEG=0`; cmake receives
`-DENABLE_PLUGIN_LOADING=OFF -DBUILD_SHARED_LIBS=OFF`.
There are no x265, kvazaar, aom or rav1e encoder settings in that build recipe
apart from the disabled AOM option. These defaults and the runtime observations
support the codec inventory; they are not a static linkage proof.

## Runtime codec inventory

Run this from the repository root. The subshell cwd is required: `wasm.js`
reads `./libheif-wasm/libheif.wasm` relative to the process cwd.

```sh
(
  cd node_modules/libheif-js
  node <<'JS'
const m = require('./wasm');
console.log('libheif', m.heif_get_version());
for (const [format, name] of [
  [1, 'HEVC'], [2, 'AVC'], [3, 'JPEG'], [4, 'AV1'], [5, 'VVC'],
  [6, 'EVC'], [7, 'JPEG2000'], [8, 'uncompressed'], [9, 'mask'],
  [10, 'HTJ2K']
]) {
  console.log(name, 'encoder', m._heif_get_encoder_descriptors(format, 0, 0, 0),
    'decoder', m._heif_get_decoder_descriptors(format, 0, 0));
}
const p = m._malloc(4);
m._heif_get_encoder_descriptors(9, 0, p, 1);
const d = m.HEAPU32[p / 4];
const start = m._heif_encoder_descriptor_get_name(d);
let end = start;
while (m.HEAPU8[end]) end++;
console.log('encoder name', Buffer.from(m.HEAPU8.subarray(start, end)).toString(),
  'compression format', m._heif_encoder_descriptor_get_compression_format(d));
m._free(p);
JS
)
```

Measured results: HEVC encoder **0**, decoder **1**; mask encoder **1**,
decoder **0**; every other listed format has **0 / 0**, including AV1.
The sole encoder name is `mask`, compression format **9**: a built-in mask
encoder, not a pixel codec. There are no HEVC or AV1 encoders. This WASM cannot
decode AVIF (AV1); the planned AVIF path uses standard browser decoding.
It contains no dav1d, openh264, aom, x265, kvazaar, rav1e or OpenJPH codec
implementation. Strings such as `openh264` are entries in libheif's name tables,
not evidence of a usable codec. Descriptor enumeration and the build settings
above are the evidence used here; JS API names alone are insufficient.

## Comparing release artifacts and transformed glue

The supplied upstream review found the release WASM byte-identical to the
selected npm WASM. The npm glue is a minified transformation of the release's
`libheif-wasm/libheif.js`; transforming with esbuild **0.21.5** reproduced it
byte for byte. These upstream comparisons were not repeated during the local,
offline verification. To reproduce separately, obtain the reviewed release's
`libheif.tar.gz` from
<https://github.com/catdad-experiments/libheif-emscripten/releases/download/v1.23.5/libheif.tar.gz>
and unpack into a separate `release-artifacts/` directory. Do not overwrite the
installed package. With its `libheif-wasm/` directory at that location:

```sh
shasum -a 256 release-artifacts/libheif-wasm/libheif.wasm node_modules/libheif-js/libheif-wasm/libheif.wasm
cmp release-artifacts/libheif-wasm/libheif.wasm node_modules/libheif-js/libheif-wasm/libheif.wasm
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
if (esbuild.version !== '0.21.5') throw new Error('Use reviewed esbuild 0.21.5');
const file = readFileSync('release-artifacts/libheif-wasm/libheif.js', 'utf8');
const result = await esbuild.transform(file, { target: 'es2019', minify: true });
writeFileSync('release-artifacts/libheif.min.js', result.code);
JS
shasum -a 256 release-artifacts/libheif.min.js node_modules/libheif-js/libheif-wasm/libheif.js
cmp release-artifacts/libheif.min.js node_modules/libheif-js/libheif-wasm/libheif.js
```

## Verification and replacement

`node scripts/vendor-libheif.mjs` and `--verify` perform the same read-only
checks. The installed npm package must be exactly 1.23.5. SHA256SUMS must list
exactly the two package-relative paths above, once each, with valid hashes.
Malformed, duplicate, missing, unknown and directory-escaping entries fail.
Postinstall, prebuild and predev run verification after the existing libarchive
hook, and stop on a mismatch.

Prepare a replacement directory containing `libheif-wasm/libheif.wasm` and
`libheif-wasm/libheif.js`, then run from the repository root:

```sh
node scripts/vendor-libheif.mjs --from replacement
```

Relative directories resolve against the caller's cwd. This verifies the
replacement pair against the same pinned hashes and still checks the installed
npm version. It does not accept arbitrary rebuilds, copy files, or alter hashes.
A different build requires explicit review of both artifacts, provenance,
component/license metadata and both hashes together. Actual unmodified copying,
serving and user replacement will be completed in the later distribution step.

The LGPL compliance plan preserves full LGPL/GPL texts and component licenses
here, records corresponding source locations above, and will expose usage
attribution and source/replacement instructions in NOTICE when distribution is
enabled. The WASM will be served separately, unchanged, with a supported
replacement path. Those distribution obligations remain to be completed before
shipping; the current verifier does not implement distribution or relinking.

Unverified: the exact LLVM (libc++) revision used by Emscripten 3.1.61 for the
release; static proof of libde265 inclusion (only build defaults and runtime
decoder enumeration are confirmed); other npm files, including bundle variants.
The rebuild inputs above are not a claim of a locally reproduced full build.
