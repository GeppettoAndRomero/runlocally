# Engine API

The Japanese and English index pages mount a Workbench that calls the listing, extraction, ZIP rewrite, and ZIP creation APIs. The app boundary in `src/app/engine.ts` owns the ZIP worker; `openArchive` calls the separate libarchive engine directly. `downloadBlob` in `src/app/download.ts` is the DOM-only download helper. No processing is sent to a server.

## App entry points

```ts
const zip = createZipEngine(); // src/app/engine.ts; creates a module Worker
try {
  const entries = await zip.listEntries(file);
  // Use the other methods below as needed.
} finally {
  zip.terminate();
}

const archive = await openArchive(file); // libarchive.js creates its own worker
try {
  const file = await archive.extractOne(archive.entries[0].path);
} finally {
  archive.close();
}
```

`createZipEngine(): ZipEngineClient` creates one ZIP worker on call, not on module import. It exposes the eight async operations below. `terminate(): void` is idempotent; `pagehide`, worker `error`, and `messageerror` also terminate it. Pending calls reject with an app-layer `AbortError`, later calls reject immediately, and a terminated client does not restart. Create a new client for later work. The ZIP client's termination does not close a libarchive handle.

| ZIP client method | Result | Progress and behavior |
| --- | --- | --- |
| `listEntries(file: File)` | `Promise<ZipEntry[]>` | Metadata only, in central-directory order. |
| `extractEntry(file: File, name: string)` | `Promise<Blob>` | First matching full path; rejects for a directory, encrypted entry, or CRC mismatch. |
| `extractAll(file: File, onProgress?: (done: number, total: number) => unknown)` | `Promise<ExtractedFile[]>` | Files in archive order; directories and encrypted files are skipped. Verifies CRC and reports each completed extraction. Any CRC mismatch rejects the whole operation without returning partial results. |
| `rewriteZip(file: File, options?: RewriteOptions)` | `Promise<RewriteResult>` | Rebuilds in source order; verifies CRC of kept unencrypted files and reports before each source entry, including removed entries. |
| `createZip(files: File[], options?: CreateOptions)` | `Promise<Blob>` | Uses `webkitRelativePath` for folder input; reports before each file. |
| `splitZip(file: File, targetBytes: number, onProgress?: (p: SplitProgress) => unknown)` | `Promise<SplitPart[]>` | Creates independent ZIPs, not a spanned archive. Reports each part before it is built. |
| `mergeZips(files: File[], options: MergeOptions, onProgress?: (p: MergeProgress) => unknown)` | `Promise<MergeResult>` | Reports each input before reading it; collisions are renamed or skipped. |
| `recoverZip(input: ArrayBuffer \| Uint8Array)` | `Promise<RecoverResult>` | Salvages readable content; broken entries carry status and reason. The input buffer is cloned across the worker boundary rather than detached. |

`ZipEntry` has `name`, `directory`, uncompressed `size`, `compressedSize`, optional `date`, `encrypted`, `utf8`, and optional `rawFilename: Uint8Array`. Listing retains the original name bytes for name repair previews; it does not extract file bodies. `ExtractedFile` has `name` and `blob`.

`RewriteOptions` has optional `keep(name)`, `rename(name, entry)`, `password`, `outPassword`, and `onProgress({ index, total, name })`. `keep` and `rename` accept synchronous or Promise results. `RewriteEntry` has the same metadata as `ZipEntry`. `RewriteResult` has `blob`, `total`, `kept`, `removed`, `renamed`, and `encryptedCount`; counts include directories. Input and output passwords are independent. `CreateOptions` has optional `password` and `onProgress({ index, total, name })`; the progress name is the original file name. Progress callbacks are awaited, so callback failures reject the operation. Callback proxies are released after success or failure. Folder paths are transported separately from `File` metadata.

`SplitProgress` is `{ part, totalParts }` with a one-based `part`. Each `SplitPart` has `name`, `blob`, actual `size`, file `count`, and `oversize`; a single entry exceeding the target gets its own part. `MergeOptions` requires `collision: 'rename' | 'skip'`. `MergeProgress` is `{ index, total, name }` with a zero-based input index. `MergeResult` is `{ blob, stats }`, where stats are `inputs`, output file `entries`, `collisions`, and `skipped`.

`RecoverResult` has `source: 'central' | 'scan'`, `entries`, file `total`, and intact `recovered` count. Each recovered entry has `name`, `directory`, `status: 'ok' | 'broken'`, `bytes: Uint8Array | null`, `size`, `expectedSize: number | null`, `via`, and optional `reason` (`crc`, `truncated`, `inflate`, `unsupported`, `encrypted`, `empty`). A broken entry is a result value, not automatically an exception.

## Archive route and ownership

`openArchive(file: File): Promise<OpenArchive>` is an app export that calls `src/engine/archive/libarchive.ts` directly. libarchive.js creates its own worker using the matched lean JS/WASM artifacts. It lists extractable RAR, 7z, tar and tar.gz content; ZIP operations above use the separate ZIP worker. The returned handle has sorted `entries: { path: string; size: number }[]`, `extractOne(path): Promise<File>`, `extractAll(onProgress?: (done: number, total: number) => void): Promise<File[]>`, and `close(): void`. `extractAll` reports each completed file and closes on success. Call `close()` after single extraction, failed full extraction, or discarding a handle. An empty listing can also mean unreadable input; encrypted headers may prevent a precise diagnosis. The Workbench opens a new handle for each archive listing and extraction. It closes listing and single extraction handles, and closes failed or discarded handles. Successful full extraction closes through the archive API. Departure closes active resources, including handles returned after departure.

`downloadBlob(blob: Blob, fileName: string): void` creates an object URL and temporary anchor, clicks it, removes the anchor, then revokes the URL after a delay. Callers choose the download name.

## Errors

`EngineError` carries one of seven codes. ZIP worker transfer preserves `code`, `message`, `name`, and `stack`, constructing a new instance on the receiving side; arbitrary `cause` objects and object identity do not cross. Ordinary errors and callback exceptions may propagate without an `EngineError` code.

| Code | Meaning and current sources |
| --- | --- |
| `wrong-password` | Recognized encrypted ZIP decryption failure in `rewriteZip`. |
| `not-encrypted` | `rewriteZip` received an input password but found no encrypted entries. |
| `encrypted-entry` | Unsupported encrypted data in `extractEntry`, `rewriteZip`, `splitZip`, `mergeZips`, or `openArchive`. Merge checks after collision skipping. |
| `bad-central` | Known ZIP central-directory failures via `readCentralEntries` in listing, extraction, rewrite, split, or merge. |
| `corrupt-entry` | CRC mismatch while reading an unencrypted file in `extractEntry`, `extractAll`, or `rewriteZip`. |
| `too-large` | Existing engine APIs do not create it. The app state rejects an input larger than 1,000,000,000 bytes before listing or a job is started. The Workbench applies this check before reading the header or calling a worker, including result reinput. |
| `unsupported` | Unsupported ZIP format, target or arguments; archive initialization, opening, listing or extraction failure. |

`extractAll` skips encrypted ZIP files rather than emitting `encrypted-entry`. Recover reports entry damage in result fields. Worker termination emits `AbortError`, not an `EngineError` code.

## Other exports and internal boundaries

Synchronous helpers are available directly from their modules, outside the worker API: `zip/names.ts` exports `baseName`, `isGarbled`, `decodeShiftJisName`; `zip/split.ts` exports `entryPackSize`, `planParts`, `buildPlan`, `partBaseName`, `humanSize`; `zip/merge.ts` exports `disambiguate`; `recover/zipScan.ts` exports `scanLocalHeaders`, `isPkSignature`; `recover/crc32.ts` exports `crc32`; `recover/recoverEngine.ts` and `archive/libarchive.ts` each export their own `baseName`. `zip/list.ts`'s `readCentralEntries` is shared engine plumbing. `archive/libarchive.ts`'s `__setArchiveForTesting` and `app/engine.ts`'s `__createZipEngineForEndpoint` are test seams, not app operations. `worker-api.ts` separates data from proxied callbacks for transport and is not the public client signature.

`sniffArchiveKind(bytes)` is a synchronous, byte-only hint for ZIP, RAR, 7z, tar, and gzip. Callers can read the first 263 bytes to include tar's `ustar` marker at offset 257; the function does not read a `File` or use its name, extension, or MIME type. It recognizes common ZIP PK records, both RAR generations, 7z, and the null or space terminated `ustar` marker. A header of at least 10 bytes starting with `1f 8b 08` and with zero reserved flag bits yields `gzip`. This identifies the gzip wrapper, not its tar contents or integrity. Self-extracting archives and tar files without that marker may return `unknown`. A recognized signature does not establish archive integrity, encryption status, safety, or extractability.

`src/app/state` holds a pure session reducer for ZIP and archive routes. Its `selection` contains kept names across the entire listing. Duplicate ZIP names therefore share a rewrite keep decision; `extractEntry` returns the first match. Rewrite counts include directories, while extracted file counts come from the returned files. Rewrite progress identifies the entry about to be processed; extract progress counts completed files. Generation and request IDs discard notifications from replaced inputs, reset sessions, and completed jobs. Results enter a source chain only through an explicit derived `File` action. The reducer stores no worker, archive handle, callback, or object URL. Archive listings use a separate `archiveEntries` array with `{ path, size }` values. ZIP entries retain their own metadata. A new source resets both arrays and the extract input; an explicit result reinput derives its chain from that result. An unknown signature remains outside the ready listing state.

## Workbench boundary

The Workbench reads only the first 263 input bytes for signature detection after the decimal 1 GB size check. ZIP uses a new worker client for each request; RAR, 7z, tar, and gzip use `openArchive`. Readable tar.gz content can be listed and extracted through libarchive. Plain .gz, empty gzip, empty tar.gz, and truncated tar.gz are unsupported and rejected when listing yields no extractable files. Gzip listing failures receive the same retry guidance as tar. Results remain in the session until reset, and saving uses `downloadBlob` without extraction. A recognized signature does not guarantee that listing will succeed.

Creation bypasses archive listing. The controller snapshots the selected files and checks their combined size against 1,000,000,000 bytes, inclusive, before calling `createZip`; an input within the limit may still fail. The engine uses `webkitRelativePath` when present, otherwise the file name, and keeps colliding names with (1), (2) suffixes. The panel ignores re-additions matching relative path, name, size, and modification time. Folder selection and drop paths depend on the browser and need device verification. Although the internal `CreateOptions` API accepts a password, the public screen passes only a progress callback and offers no password or encryption. The result is kept as a Blob named `created.zip`; saving is a separate action and does not clear it. Pending selection belongs to the panel; executed input and results remain in session state, deferring updates along with running creation, until Reset, a new archive input, or a result re-input clears the whole creation state; an unsaved `created.zip` is discarded then. Clearing selection or saving does not discard the executed input or result.

## Follow-up documentation

See [UI.md](UI.md) for the connected operation screen. Removal and name repair are ZIP only. Their displayed counts come from rewrite results and include directories. Keeping an encrypted entry without a password fails the rewrite; removing it before decryption can succeed. Recovery controls are not mounted.

## Dormant image conversion

`src/engine/image/convert.ts` exports `convertImage(input: Blob, format: 'jpg' | 'png', adapters?: ImageAdapters): Promise<ImageResult<Blob>>`. File inputs are accepted as Blobs. No page or app imports this pipeline. Its dedicated worker is not a production entry or distributed asset; the image pages remain coming-soon pages. Saving and naming belong to a future caller.

The converter reads the complete input bytes for `sniffImageFormat`, independently of names and MIME types, then calls `createImageBitmap` with `imageOrientation: 'from-image'`. Dimensions are checked after orientation, without another rotation. Even same-format inputs are drawn and re-encoded. JPG uses a white background, `image/jpeg` and quality 0.92; PNG retains alpha. Output must have the requested MIME and nonzero size. Original EXIF, GPS and ICC metadata are not copied; an encoder may generate its own information. Animated inputs produce a static first frame.

`ImageAdapters` injects `decode`, `canvas`, optional `rescueDecode` and `interrupted`. A decoded image supplies oriented dimensions, `paint(context)` and `close()`. A canvas supplies its context, async `encode(spec)` and `release()`. Defaults use a bitmap and OffscreenCanvas/convertToBlob. For a DOM canvas, a main-thread caller supplies `mainThreadImageCanvas(() => /* caller-created HTMLCanvasElement */ canvas)` with `decodeNativeImage`. The engine creates no DOM elements. Adapter functions and DOM objects never cross the worker boundary. The converter owns returned decoded images and canvases and releases them on success, failure and interruption, including bitmaps returned late. Adapters own cleanup if their own allocation fails before returning a resource.

`limits.ts` exports the shared `MAX_IMAGE_PIXELS = 16_777_216` and `checkImageDimensions`. Width and height must be positive safe integers. Exactly 4096×4096 is accepted; greater area returns `too-large` before canvas allocation, without resizing. This uses the iOS Safari canvas area ceiling: 4032×3024 fits, while typical 24/48 megapixel images do not. One RGBA surface at the limit is 64 MiB; a decoded surface, canvas and temporary surface suggest about 192 MiB. This estimate excludes compressed input, decoder internals and encoder allocations. The limit does not prevent memory allocation during native decoding. Actual iOS limits and peak memory remain unverified.

Failures are values: `unsupported-type` for unknown bytes; `decode-failed` for read/decode failures or invalid dimensions; `heic-decoder-unavailable` for native HEIC/HEIF failure without a rescue adapter; `too-large`; `out-of-memory` only for an explicit adapter `ImageMemoryError`; `encode-failed` for canvas, drawing, empty/null output, MIME fallback or encoding failure; and `interrupted`. Arbitrary exceptions are not assumed to indicate memory exhaustion. Only HEIC/HEIF native decode failure can call the optional rescue decoder. No rescue implementation or library is loaded, and AVIF never enters that path. Excessive dimensions and interruption do not retry decoding. Native HEIC support and HEIC pixel output require browser/device verification.

`createImageWorkerApi()` is exposed by the thin `image-worker.ts` Comlink entry. `convert({ type: 'convert', requestId, input, format })` returns `{ type: 'result', requestId, result }`; `interrupt({ type: 'interrupt', requestId })` affects only that active ID. IDs are nonnegative safe integers and must increase for the worker's lifetime, so reuse needs no growing history set. There is one active conversion; concurrent requests and invalid/reused IDs receive `interrupted`. Unknown or completed interrupts are harmless. Cancellation is checked around async stages and late success becomes `interrupted`; native operations themselves cannot be forcibly interrupted. The future caller owns worker termination, including departure and discarded jobs, and should normally use one worker per conversion. Image failures do not use the ZIP exception transfer handler.

`tests/unit/image-convert.test.ts` exercises injected failures, limits, cleanup, cancellation and the DOM-independent worker API. `tests/e2e/image-convert.spec.ts` builds a test-only harness outside dist and serves it temporarily, exercising real module workers and caller-created DOM canvases with the existing synthetic fixtures. It checks orientation, white compositing, alpha, first-frame GIF output and browser-specific AVIF/HEIC decode capability. The harness, server and workers are released after tests; browser results do not establish iOS device limits or peak memory behavior.
