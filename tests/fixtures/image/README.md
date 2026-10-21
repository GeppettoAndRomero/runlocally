# Image fixtures

All images are synthetic and contain no third-party photographs. `alpha.png` is the
32×24 RGBA source, generated from pixel values with Node's zlib in `regenerate.sh`:
red/green gradients, a blue left half, and transparent, half-transparent and opaque
vertical bands. Derived files use this source except the red/blue animation.

| File | Dimensions | Content | SHA-256 |
| --- | --- | --- | --- |
| alpha.png | 32×24 | RGBA source | d6547be40e840f0c02748efcb0486506a426b4cea779f3bd4c524802dd33eacb |
| oriented.jpg | 32×24 stored | White-composited source, EXIF Orientation=6 (RightTop) | c782c64e3b052393b13921ccf56945bc5c6cc6e82f414c37a68c26aa729ef557 |
| alpha.webp | 32×24 | Lossless source with alpha | efb7296c59f7b4386a401579eccf13f03a971b5f61dadc66400ac597466855fb |
| animated.gif | 32×24, 2 frames | Solid red then blue, 10 ticks per frame, looping | 7dff46f2f3dcd357fbed797becf28edaec7d46e7cc77ed5cdf7795025f754271 |
| sample.bmp | 32×24 | 24-bit BMP3, white-composited source | dfa3555a5546f25f755201fdcf8d9ba6a68966fe917430cfeeec188e068e75a7 |
| sample.ico | 32×32 and 16×16 | Two square resized source entries with alpha | 1aa4a4e71a66b51218efc10227a2a01db85f7836307bd2f6706b08449e7ef15e |
| sample.heic | 240×240 | Reused synthetic gradient | 132c242992638e745013ee5e413294f1696a8642fba5581cb09591b1d37c375f |
| sample.avif | 32×24 | AVIF of the RGBA source, encoded with sips | c68e83bd9ea854e862cfca97f4504c5124031a214c4f3916deef14a0901cae74 |

## Reproduction and verification

Run `bash tests/fixtures/image/regenerate.sh`. It only generates fixtures, downloads
nothing, and never writes `sample.heic`. Commands and the PNG/EXIF construction are
in the script. EXIF is a minimal APP1 TIFF Orientation SHORT with value 6, inserted
after JPEG SOI. Tools used: Node v25.6.1 (zlib), ImageMagick 7.1.2-25 Q16-HDRI,
cwebp 1.6.0 (libsharpyuv 0.4.2), sips-316. Codec versions can change encoded hashes.

Verification on 2026-10-21: `magick <file> null:` decoded all pixels/frames/entries of
PNG, JPEG, WebP, GIF, BMP and ICO successfully. `magick identify` confirmed the table's
dimensions, RightTop orientation, PNG/WebP alpha and two ICO sizes; `file` confirmed
24-bit BMP3 and GIF89a. `magick animated.gif -format '%[pixel:p{0,0}]' info:`
confirmed red then blue. These are real encoded images, not signature-only data.

AVIF is produced by `sips -s format avif alpha.png --out sample.avif` (the AVIF encoder shipped with
macOS); `file` identifies it as an AVIF image and sips decodes it back to a 32×24 PNG that ImageMagick
reads. ImageMagick and `heif-enc` on the maintainer's machine cannot encode or decode AVIF/HEIC, so
AVIF and HEIC are verified by decoding with sips instead. The script returns failure if an AVIF cannot
be generated or if either file cannot be decoded, while generating the other fixtures.

## Reused HEIC

`sample.heic` came unchanged from a past prototype repository, where multiple tools
used the same file. Its supplied provenance is a synthetic gradient PNG converted
to HEIC using macOS sips; no third-party image is included. The original PNG,
conversion command options and historical sips version are unavailable, so this
file is not regenerated. Its SHA-256 above was measured locally. The major brand
is `heic`, compatible brands are `mif1 MiPr miaf MiHB heic`.
`file` confirmed HEIF/HEVC and `sips -g pixelWidth -g pixelHeight` reported 240×240.
Full decode with sips to a temporary PNG failed with Error 13 in this environment;
HEIC pixel decoding remains unverified. Truncated/malformed cases live only in tests.
