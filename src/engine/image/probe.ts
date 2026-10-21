/** Synthetic probe images, with no third-party pictures.
 * PNG/JPEG/GIF/WebP/BMP are 1×1 red pixels (the ICO is a hand-assembled 16×16 32-bit
 * BMP-in-ICO of the same colour: WebKit refuses ICOs smaller than 16×16, including 1-bit ones from ImageMagick), generated with
 * ImageMagick 7.1.2-25 Q16-HDRI:
 * magick -size 1x1 xc:red -strip PNG24:source.png
 * magick source.png -strip sample.<jpg|gif|webp|ico>
 * magick source.png -strip BMP3:sample.bmp
 * Pixel decoding checked with magick <file> null: (all six formats).
 * AVIF reuses the 32×24 synthetic RGBA fixture (691 bytes); provenance,
 * source generation and sips-316 encoding/decoding commands are recorded in
 * tests/fixtures/image/README.md and regenerate.sh. That fixture's recorded
 * verification decoded it to PNG with sips and read the pixels with ImageMagick.
 * Reverification here with sips-316 returned Error 13, including encoding a
 * 1×1 replacement; the existing verified fixture is retained unchanged.
 * Browser tests also decode these bytes and compare with independent fixtures.
 * Encoded sizes (bytes): PNG 69, JPEG 286, GIF 43, WebP 68, BMP 66, ICO 1150, AVIF 691.
 */
export const NATIVE_IMAGE_FORMATS = ['png', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'] as const;
export type NativeImageFormat = typeof NATIVE_IMAGE_FORMATS[number];
export type ImageCapabilities = Record<NativeImageFormat, boolean>;
export type ProbeDecoder = (blob: Blob, options: ImageBitmapOptions) => Promise<{ close(): void }>;

const encoded: Record<NativeImageFormat, string> = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC',
  jpeg: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==',
  gif: 'R0lGODlhAQABAPAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  webp: 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=',
  bmp: 'Qk1CAAAAAAAAAD4AAAAoAAAAAQAAAAEAAAABAAEAAAAAAAQAAAAAAAAAAAAAAAIAAAACAAAAAAD/AAAAAAAAAAAA',
  ico: 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  avif: 'AAAAIGZ0eXBhdmlmAAAAAE1pUHJhdmlmbWlhZm1pZjEAAAG3bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAAOcGl0bQAAAAAAAQAAADhpaW5mAAAAAAACAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAFWluZmUCAAABAAIAAGF2MDEAAAAAGmlyZWYAAAAAAAAADmF1eGwAAgABAAEAAADaaXBycAAAALFpcGNvAAAAE2NvbHJuY2x4AAIAAgAGgAAAAAxjbGxpAMsAQAAAABRpc3BlAAAAAAAAACAAAAAYAAAACWlyb3QAAAAAEHBpeGkAAAAAAwgICAAAAA5waXhpAAAAAAEIAAAAN2F1eEMAAAAAdXJuOm1wZWc6aGV2YzoyMDE1OmF1eGlkOjEAAAAADAAAAAhOAaUEAAH+QAAAAAxhdjFDgQAMAAAAAAxhdjFDgQAcAAAAACFpcG1hAAAAAAAAAAIAAQaBAgMFiIQAAgUDBoeJhAAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAHnAAAAoQACAAAAAQAAAogAAAArAAAAAW1kYXQAAAAAAAAA3BIACg0AAAACJ+5//AgQEDQgMo0BEAGSAAgggiDPlpusGAUp3zFdPYsgfC9Ke/P5rjQPrY1+ynlteZAHGK56UkOuyk+kHuv0mVJlMbmsmecrKyUK5LuM3E6SSBtDnyB8SusUO8n+A+mx4BOtbTXye4ksqeMDJ7oGdPOlH7fhIaQigJe08j4Rk7O2QVXZJNww8ytiMbAqsvWWUyo7t/0O1DfwEgAKCQAAAAIn7n/8FTIcFABjgAgiAM8LyBm3I7J8c+REZfkFbvTImVqPgA==',
};
export function imageProbeBytes(format: NativeImageFormat): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded[format]), character => character.charCodeAt(0));
}

// Each factory owns its cache; injected decoders never share the product cache.
export function createImageCapabilityProbe(decode?: ProbeDecoder): () => Promise<ImageCapabilities> {
  let pending: Promise<ImageCapabilities> | undefined;
  return () => pending ??= (async () => {
    const results = await Promise.all(NATIVE_IMAGE_FORMATS.map(async format => {
      try {
        const bitmap = await (decode ?? globalThis.createImageBitmap)(
          new Blob([imageProbeBytes(format)]), { imageOrientation: 'from-image' });
        bitmap.close();
        return true;
      } catch { return false; }
    }));
    return { png: results[0], jpeg: results[1], gif: results[2], webp: results[3],
      bmp: results[4], ico: results[5], avif: results[6] };
  })();
}
export const probeImageCapabilities = createImageCapabilityProbe();
