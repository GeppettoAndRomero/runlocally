/** Size-plausible trailing data descriptors, before CRC verification. */
export interface DescriptorCandidate {
  crc: number;
  compressedSize: number;
  dataEnd: number;
}

function recordKind(bytes: Uint8Array, at: number): number {
  if (bytes[at] !== 0x50 || bytes[at + 1] !== 0x4b) return -1;
  return (bytes[at + 2] << 8) | bytes[at + 3];
}

function isRecord(bytes: Uint8Array, at: number): boolean {
  const kind = recordKind(bytes, at);
  return kind === 0x0304 || kind === 0x0102 || kind === 0x0506 || kind === 0x0708;
}

/** The same first-record boundary used by the local-header scanner. */
export function nextRecordBoundary(bytes: Uint8Array, dataStart: number): number {
  for (let at = dataStart + 1; at + 4 <= bytes.length; at++) {
    if (isRecord(bytes, at)) return at;
  }
  return bytes.length;
}

/** Return every signed/unsigned, 32-bit/ZIP64 size-plausible interpretation. */
export function trailingDescriptors(
  bytes: Uint8Array,
  dataStart: number,
  boundary: number
): DescriptorCandidate[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const candidates: DescriptorCandidate[] = [];
  for (const signed of [true, false]) {
    if (signed && recordKind(bytes, boundary) !== 0x0708) continue;
    for (const zip64 of [false, true]) {
      const length = (signed ? 4 : 0) + (zip64 ? 20 : 12);
      const start = signed ? boundary : boundary - length;
      const end = start + length;
      if (start < dataStart || end > bytes.length) continue;
      if (signed && end !== bytes.length && !isRecord(bytes, end)) continue;
      const fields = start + (signed ? 4 : 0);
      const compressed = zip64
        ? view.getBigUint64(fields + 4, true)
        : BigInt(view.getUint32(fields + 4, true));
      if (compressed !== BigInt(start - dataStart)) continue;
      const uncompressed = zip64
        ? view.getBigUint64(fields + 12, true)
        : BigInt(view.getUint32(fields + 8, true));
      if (uncompressed > BigInt(Number.MAX_SAFE_INTEGER)) continue;
      candidates.push({
        crc: view.getUint32(fields, true),
        compressedSize: Number(compressed),
        dataEnd: start,
      });
    }
  }
  return candidates;
}
