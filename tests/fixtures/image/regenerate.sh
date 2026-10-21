#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
incomplete=0
# Only synthetic fixtures are regenerated. The reused sample.heic is never written.
node --input-type=module <<'NODE'
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(32, 0); header.writeUInt32BE(24, 4);
header[8] = 8; header[9] = 6;
const pixels = Buffer.alloc(24 * (1 + 32 * 4));
for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
  const offset = y * 129 + 1 + x * 4;
  pixels.set([x * 8, y * 10, x < 16 ? 255 : 0, x < 8 ? 0 : x < 16 ? 128 : 255], offset);
}
writeFileSync('alpha.png', Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
NODE
magick alpha.png -background white -alpha remove -alpha off oriented.jpg
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
// APP1 EXIF: little-endian TIFF, one Orientation SHORT with value 6.
const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
const jpeg = readFileSync('oriented.jpg');
writeFileSync('oriented.jpg', Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]));
NODE
cwebp -quiet -lossless alpha.png -o alpha.webp
if ! sips -s format avif alpha.png --out sample.avif >/dev/null; then
  incomplete=1
  rm -f sample.avif
  echo "AVIF generation unavailable; rerun with an AVIF-capable sips." >&2
fi
magick -delay 10 -size 32x24 xc:red -size 32x24 xc:blue -loop 0 animated.gif
magick alpha.png -background white -alpha remove -alpha off -type TrueColor BMP3:sample.bmp
magick alpha.png -define icon:auto-resize=32,16 sample.ico
# Decode all frames/entries; identify alone is insufficient to check pixel data.
for image in alpha.png oriented.jpg alpha.webp animated.gif sample.bmp sample.ico; do
  if [[ -f "$image" ]]; then magick "$image" null:; fi
done
# AVIF and the reused HEIC: sips decodes both even when ImageMagick lacks these codecs, so decode
# each to a PNG with sips and read that PNG back with ImageMagick.
heif_preview=$(mktemp -d)
trap 'rm -rf "$heif_preview"' EXIT
for image in sample.avif sample.heic; do
  if [[ ! -f "$image" ]]; then
    incomplete=1
    echo "Missing $image; it cannot be verified." >&2
    continue
  fi
  if sips -s format png "$image" --out "$heif_preview/$image.png" >/dev/null; then
    magick "$heif_preview/$image.png" null:
  else
    incomplete=1
    echo "Decode verification unavailable for $image." >&2
  fi
done
for image in alpha.png oriented.jpg alpha.webp sample.avif animated.gif sample.bmp sample.ico sample.heic; do
  if [[ -f "$image" ]]; then file "$image"; shasum -a 256 "$image"; fi
done
exit "$incomplete"
