import type { ImageInputFormat } from './types';

/** A byte-only format hint, not a guarantee of decoding, integrity or safety.
 * Supply complete boxes through ftyp; extended-size and size-to-EOF boxes are rejected.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageInputFormat {
  const at = (offset: number, signature: readonly number[]) =>
    offset + signature.length <= bytes.length &&
    signature.every((value, index) => bytes[offset + index] === value);
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (at(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'png';
  // SOI, optional 0xFF fill bytes, then a marker: not stuffing, another SOI or EOI, or a restart marker.
  if (at(0, [255, 216, 255])) {
    let index = 3;
    while (bytes[index] === 255) index++;
    const marker = bytes[index];
    if (marker >= 0xc0 && marker <= 0xfe && !(marker >= 0xd0 && marker <= 0xd9)) return 'jpeg';
  }
  if (at(0, [71, 73, 70, 56, 55, 97]) || at(0, [71, 73, 70, 56, 57, 97])) return 'gif';
  if (bytes.length >= 12 && text(0) === 'RIFF' && text(8) === 'WEBP') return 'webp';
  if (bytes.length >= 18 && at(0, [66, 77])) {
    const dibSize = view.getUint32(14, true);
    if ([12, 16, 40, 52, 56, 64, 108, 124].includes(dibSize) &&
        dibSize <= bytes.length - 14) return 'bmp';
    return 'unknown';
  }
  // An ICO is 00 00 01 00, a count, then 16-byte entries. A 256-byte ISOBMFF box starts 00 00 01 00 too,
  // so check the first entry (reserved byte, planes, size, and an image offset past the directory).
  if (bytes.length >= 22 && at(0, [0, 0, 1, 0])) {
    const count = view.getUint16(4, true);
    if (count > 0 && bytes[9] === 0 && view.getUint16(10, true) <= 1 && view.getUint32(14, true) > 0 &&
        view.getUint32(18, true) >= 6 + 16 * count) return 'ico';
  }

  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 8) return 'unknown';
    const size = view.getUint32(offset);
    if (size < 8 || size > bytes.length - offset) return 'unknown';
    if (text(offset + 4) === 'ftyp') {
      if (size < 16 || (size - 16) % 4 !== 0) return 'unknown';
      let avif = false, heic = false, heif = false;
      // Read major brand and aligned compatible brands; skip the minor version.
      for (let brandOffset = offset + 8; brandOffset < offset + size; brandOffset += 4) {
        if (brandOffset === offset + 12) continue;
        const brand = text(brandOffset);
        avif ||= ['avif', 'avis'].includes(brand);
        heic ||= ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(brand);
        heif ||= ['mif1', 'msf1'].includes(brand);
      }
      // Specific brands override generic HEIF; conflicting specifics are unknown.
      if (avif && heic) return 'unknown';
      return avif ? 'avif' : heic ? 'heic' : heif ? 'heif' : 'unknown';
    }
    offset += size;
  }
  return 'unknown';
}
