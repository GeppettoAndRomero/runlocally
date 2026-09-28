# Engine API

The current pages do not call these APIs yet. The app boundary in `src/app/engine.ts` owns the ZIP worker; `openArchive` calls the separate libarchive engine directly. `downloadBlob` in `src/app/download.ts` is the DOM-only download helper. No processing is sent to a server.

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
| `extractEntry(file: File, name: string)` | `Promise<Blob>` | First matching full path; rejects for a directory or encrypted entry. |
| `extractAll(file: File, onProgress?: (done: number, total: number) => unknown)` | `Promise<ExtractedFile[]>` | Files in archive order; directories and encrypted files are skipped. Reports each completed extraction. |
| `rewriteZip(file: File, options?: RewriteOptions)` | `Promise<RewriteResult>` | Rebuilds in source order; reports before each source entry, including removed entries. |
| `createZip(files: File[], options?: CreateOptions)` | `Promise<Blob>` | Uses `webkitRelativePath` for folder input; reports before each file. |
| `splitZip(file: File, targetBytes: number, onProgress?: (p: SplitProgress) => unknown)` | `Promise<SplitPart[]>` | Creates independent ZIPs, not a spanned archive. Reports each part before it is built. |
| `mergeZips(files: File[], options: MergeOptions, onProgress?: (p: MergeProgress) => unknown)` | `Promise<MergeResult>` | Reports each input before reading it; collisions are renamed or skipped. |
| `recoverZip(input: ArrayBuffer \| Uint8Array)` | `Promise<RecoverResult>` | Salvages readable content; broken entries carry status and reason. The input buffer is cloned across the worker boundary rather than detached. |

`ZipEntry` has `name`, `directory`, uncompressed `size`, `compressedSize`, optional `date`, `encrypted`, and `utf8`. `ExtractedFile` has `name` and `blob`.

`RewriteOptions` has optional `keep(name)`, `rename(name, entry)`, `password`, `outPassword`, and `onProgress({ index, total, name })`. `keep` and `rename` accept synchronous or Promise results. `RewriteEntry` extends `ZipEntry` with optional `rawFilename: Uint8Array`. `RewriteResult` has `blob`, `total`, `kept`, `removed`, `renamed`, and `encryptedCount`; counts include directories. Input and output passwords are independent. `CreateOptions` has optional `password` and `onProgress({ index, total, name })`; the progress name is the original file name. Progress callbacks are awaited, so callback failures reject the operation. Callback proxies are released after success or failure. Folder paths are transported separately from `File` metadata.

`SplitProgress` is `{ part, totalParts }` with a one-based `part`. Each `SplitPart` has `name`, `blob`, actual `size`, file `count`, and `oversize`; a single entry exceeding the target gets its own part. `MergeOptions` requires `collision: 'rename' | 'skip'`. `MergeProgress` is `{ index, total, name }` with a zero-based input index. `MergeResult` is `{ blob, stats }`, where stats are `inputs`, output file `entries`, `collisions`, and `skipped`.

`RecoverResult` has `source: 'central' | 'scan'`, `entries`, file `total`, and intact `recovered` count. Each recovered entry has `name`, `directory`, `status: 'ok' | 'broken'`, `bytes: Uint8Array | null`, `size`, `expectedSize: number | null`, `via`, and optional `reason` (`crc`, `truncated`, `inflate`, `unsupported`, `encrypted`, `empty`). A broken entry is a result value, not automatically an exception.

## Archive route and ownership

`openArchive(file: File): Promise<OpenArchive>` is an app export that calls `src/engine/archive/libarchive.ts` directly. libarchive.js creates its own worker using the matched lean JS/WASM artifacts. It lists extractable RAR, 7z, tar and tar.gz content; ZIP operations above use the separate ZIP worker. The returned handle has sorted `entries: { path: string; size: number }[]`, `extractOne(path): Promise<File>`, `extractAll(onProgress?: (done: number, total: number) => void): Promise<File[]>`, and `close(): void`. `extractAll` reports each completed file and closes on success. Call `close()` after single extraction, failed full extraction, or discarding a handle. An empty listing can also mean unreadable input; encrypted headers may prevent a precise diagnosis. The page that eventually wires these routes must terminate the ZIP client and close every open archive handle on departure.

`downloadBlob(blob: Blob, fileName: string): void` creates an object URL and temporary anchor, clicks it, removes the anchor, then revokes the URL after a delay. Callers choose the download name.

## Errors

`EngineError` carries one of six codes. ZIP worker transfer preserves `code`, `message`, `name`, and `stack`, constructing a new instance on the receiving side; arbitrary `cause` objects and object identity do not cross. Ordinary errors and callback exceptions may propagate without an `EngineError` code.

| Code | Meaning and current sources |
| --- | --- |
| `wrong-password` | Recognized encrypted ZIP decryption failure in `rewriteZip`. |
| `not-encrypted` | `rewriteZip` received an input password but found no encrypted entries. |
| `encrypted-entry` | Unsupported encrypted data in `extractEntry`, `rewriteZip`, `splitZip`, `mergeZips`, or `openArchive`. Merge checks after collision skipping. |
| `bad-central` | Known ZIP central-directory failures via `readCentralEntries` in listing, extraction, rewrite, split, or merge. |
| `too-large` | Existing engine APIs do not create it. The app state rejects an input larger than 1,000,000,000 bytes before listing or a job is started. The caller must apply this check before reading the file or calling a worker. |
| `unsupported` | Unsupported ZIP format, target or arguments; archive initialization, opening, listing or extraction failure. |

`extractAll` skips encrypted ZIP files rather than emitting `encrypted-entry`. Recover reports entry damage in result fields. Worker termination emits `AbortError`, not an `EngineError` code.

## Other exports and internal boundaries

Synchronous helpers are available directly from their modules, outside the worker API: `zip/names.ts` exports `baseName`, `isGarbled`, `decodeShiftJisName`; `zip/split.ts` exports `entryPackSize`, `planParts`, `buildPlan`, `partBaseName`, `humanSize`; `zip/merge.ts` exports `disambiguate`; `recover/zipScan.ts` exports `scanLocalHeaders`, `isPkSignature`; `recover/crc32.ts` exports `crc32`; `recover/recoverEngine.ts` and `archive/libarchive.ts` each export their own `baseName`. `zip/list.ts`'s `readCentralEntries` is shared engine plumbing. `archive/libarchive.ts`'s `__setArchiveForTesting` and `app/engine.ts`'s `__createZipEngineForEndpoint` are test seams, not app operations. `worker-api.ts` separates data from proxied callbacks for transport and is not the public client signature.

`sniffArchiveKind(bytes)` is a synchronous, byte-only hint for ZIP, RAR, 7z, and tar. Callers can read the first 263 bytes to include tar's `ustar` marker at offset 257; the function does not read a `File` or use its name, extension, or MIME type. It recognizes common ZIP PK records, both RAR generations, 7z, and the null or space terminated `ustar` marker. A gzip header alone does not identify tar.gz. Self-extracting archives and tar files without that marker may return `unknown`. A recognized signature does not establish archive integrity, encryption status, safety, or extractability.

`src/app/state` holds a pure ZIP session reducer. Its `selection` contains kept names across the entire listing. Duplicate ZIP names therefore share a rewrite keep decision; `extractEntry` returns the first match. Rewrite counts include directories, while extracted file counts come from the returned files. Rewrite progress identifies the entry about to be processed; extract progress counts completed files. Generation and request IDs discard notifications from replaced inputs, reset sessions, and completed jobs. Results enter a source chain only through an explicit derived `File` action. The reducer stores no worker, archive handle, callback, or object URL. Other archive listing and recovery entry shapes are not represented as ZIP entries.
