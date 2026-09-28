/**
 * CRC-32 (IEEE 802.3, the polynomial ZIP uses for its per-entry checksum).
 *
 * Pure and dependency-free so the recovery engine can validate decoded bytes
 * against the checksum stored in a local file header: a match means the bytes
 * came out intact, a mismatch means the entry is damaged (but the bytes we did
 * decode are still offered for download).
 */

// Precomputed lookup table for the reflected CRC-32 polynomial (0xEDB88320).
const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 checksum of `bytes` as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
