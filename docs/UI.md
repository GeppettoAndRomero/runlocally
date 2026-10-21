# Workbench UI

The Japanese and English ZIP top (`/zip/` and `/en/zip/`) and available operation pages each mount the same Workbench. The hubs (`/` and `/en/`) have a ZIP card and an image conversion coming-soon card, but no Workbench. The coming-soon pages (`/image/` and `/en/image/`) provide explanatory text, ordinary links and PWA prompts, with no Workbench, ZIP operation navigation or retained work. Workbench owns the session, controller lifecycle, input intake, routing, menu, updates, feedback, results and saves, and dispatches actions to the pure session reducer. Operation components in `src/app/panels/` own panel contents, display calculations and paging state. Workbench renders their tabpanel sections in the available operation order; nonselected panels stay mounted with `hidden`. Pager positions survive operation and language changes and reset when the session generation changes. The controller owns asynchronous listing and jobs, creates and closes one ZIP client or archive handle per request, and ignores notifications after invalidation. The engine performs local parsing and rewriting. `downloadBlob` handles explicit saves. Results are separate Blobs; creating one neither saves it nor replaces the input.

## State and transitions

```text
new input or explicit result reinput -> listing: idle -> reading -> ready | error
                                                error -> retry -> reading
ready -> job: idle -> running -> succeeded | failed
                             failed -> change selection/op -> running
reset -> empty session
```

The input card keeps a native file picker inside a visible label. Its hint also describes drag and clipboard paste. The full-screen overlay reports drag and file checking separately; it uses the same global intake path. A source chip shows the unmodified filename and archive kind. Reset appears when input, processing, an error, or results make clearing the session meaningful; it is absent in the initial and reset state.

The results container is always present. Before an operation creates a result, it shows guidance rather than a result article. A successful operation with zero extracted files still creates a result article. Archive-operation results keep their source line, actual counts, and explicit Save and reinput controls; it never saves or replaces input automatically. Alerts and status messages retain their text and roles, with decorative icons hidden from assistive technology. Extract progress adds a native progress bar when the total is valid; rewrite progress names the next entry and does not indicate completed work.

The `inputState` text lives in the locale UI dictionaries and is aggregated separately by `src/ui/input-state-copy.ts`. The existing workbench and shared dictionary export keeps its finite key contract.

The URL records only the current public page and locale. On ZIP pages, header operation links, language links, the operation menu, keyboard, entry extraction, repair guidance, and the language select use the same in-page transition. The brand link opens the current language's hub as an ordinary navigation; the hub and coming-soon pages have no ZIP operation navigation. The header marks the current page and language; menu selection marks the current operation. Back and Forward restore the page, locale, and selected operation without rolling back the File, selection, settings, job, or results. Reset clears the session but keeps the current page and locale. Reloading creates a new session. Accepted inputs hide only the page explanation; reset shows the current page explanation again. Header links also have ordinary public URLs for navigation without JavaScript.

`html[data-zip-top]` exists only on ZIP top. Static HTML and `displayPage()` set it from the same page condition. Operation cards appear only for the current language on ZIP top while the session is closed; their visibility does not depend on the brand link's current-page marker. Workbench continues to manage `data-session`. Reset keeps the current page and language, and the brand link points to the current language's hub.

Listing and job are separate state machines. A new input increments `generation`; each listing attempt has a new `requestId`, and each job has a new ID. Late progress and responses are discarded. Reset, pagehide, and unmount close active resources. A return from the page cache creates a new controller. Listing retry keeps the same File, generation, result history, and chain. A failed job keeps its input, selection, results, and successful log.

A result becomes the next input only through the explicit action. Its chain is derived from that result's own source chain and ID. A size check of 1,000,000,000 bytes precedes header reading for both new and derived inputs. The first 263 bytes choose the ZIP or archive route; an unknown signature does not start an engine job.

## Operations

Operation pages select their corresponding menu item before an input is chosen. The menu is always present on ZIP pages, including during listing and after a listing failure. It shows five operations (Browse, Extract, Remove, Fix names, and Create) before input and for ZIP; RAR, 7z, tar, gzip, and unknown input show Browse and Extract. A removal or name repair URL is replaced with the Browse URL when a non-ZIP input is accepted. Opening a page or selecting an operation never runs it automatically. Every displayed item has a panel before listing completes; archive panels give input, progress, or retry guidance while their execution controls wait for a successful listing. Create has its own file selection and does not wait for an archive listing.

The operation menu shows a localized verb with a short description; the verb alone names each tab. At 48rem and wider it sits to the left of the workspace and Up, Down, Left, and Right arrows cycle through available operations. Below 48rem it wraps above the workspace and Left and Right cycle; Up and Down retain normal scrolling. Arrow selection moves focus and updates the URL. The selected item uses a line and bold text. The tab panel has one card frame. The displayed entry lists use pages of 500 rows, including a one-page empty list. Sizes remain raw `N B` values. Entry names wrap without truncation; ZIP directories have a distinct decorative icon, while entries without directory metadata use a generic file icon. Extract all ignores removal selection. A single extract chooses the first matching ZIP name; encrypted ZIP entries are unavailable in the extraction controls.

Removal selection means **keep**. All entries start selected. Native checkboxes retain checked, unchecked, and mixed states, also marked by the row edge. A directory control covers itself and actual descendants at a directory boundary. Its checked, unchecked, or mixed state includes the directory entry itself, matching the set passed to rewrite even when all children are excluded. Duplicate names share a decision, including across pages. Planned exclusions count entry rows, including directories and duplicates; the separate kept file count excludes directories. Zero exclusions or zero kept files disable execution. The controller snapshots the keep set and sends only `keep` to rewrite. Encrypted entries that are excluded can be skipped before decryption; keeping one causes an error without a password. The engine's empty ZIP behavior is unchanged.

Repair candidates must be non-UTF-8 and non-ASCII, have original filename bytes, and decode to a different name as Shift_JIS. Preview and rewrite callback use the same function. Before and candidate names stay in that order, side by side when space permits and wrapped in narrow layouts. Candidate names are text, not executable content. UTF-8 names, absent bytes, unchanged decodes, and zero targets do not start repair. A newly created collision between distinct source names blocks execution and shows the target name. The candidate is a suggestion, not a guarantee of correct encoding. A rename callback evaluates each entry's own metadata, including duplicate entries. Removal rewrites output names as UTF-8, so inspect repair before removal; later repair of a trimmed ZIP is not guaranteed.

The layout follows the operating system light or dark scheme. Check every panel, pager, and result at 360, 768, and 1280 pixels in both schemes for horizontal overflow and visible keyboard focus. Radio buttons, checkboxes, and selects remain native controls with at least 44-pixel control areas.

Rewrite progress points at the entry about to be processed. The result card appears only after the rewrite Promise resolves. Removal displays actual `removed` and `kept`, repair actual `renamed`, all including directories and including zero. The derived ZIP name is shared by the card, explicit save, and explicit reinput. The original File is not modified.

## Errors and recovery

Archive input, listing, and job failures share localized explanations for all six engine codes, aborts, and ordinary exceptions. Creation failures use the creation panel’s localized failure and retry guidance. Raw engine messages are not the main text. Failed jobs identify the operation that failed even if another tab is selected. Errors use alerts. A ZIP signature with failed listing prompts a separate future recovery feature; it does not promise repair. RAR and 7z listing errors offer retry before extraction. Tar and gzip listing errors also offer retry. Gzip headers route to libarchive for readable tar.gz content; plain .gz, empty gzip, empty tar.gz, and truncated tar.gz are unsupported. Unknown signatures request another input. Signature detection does not establish integrity or promise extraction success.

## Adding an operation

See [I18N.md](I18N.md) for the publication and language workflow.

Add a `src/app/panels/<operation>.panel.tsx` module exporting `panels`, keyed by operation ID and satisfying `PanelDefinitions`. The eager registry collects these modules without a central import list. Existing components share `builtin.panel.tsx`. Public operations must have a component; missing public registrations, unknown IDs and duplicate registrations fail during registry construction. Unpublished operations may be absent, and registering one does not publish its menu, panel or URL.

Use `PanelProps` for the session, locale, typed text, busy/update flags and callbacks; keep controller ownership and routing in Workbench. Return only section contents, without another wrapper. Preserve IDs, accessible names, event order and the lifetime of hidden panels. New operations still require the input, execution and result support below before publication.

Optional `PanelProps.active` follows the shared menu selection. Creation uses `onCreate(files)` with the latest session at execution time; `onCreateSelectionChange(count)` reports pending selection synchronously for update protection and Reset. Pending files belong to the panel; `session.create.input` is the execution snapshot. Clearing selection leaves executed input and results intact until Reset. Clear the selection and notify zero on generation changes and unmount, while retaining it across operation and language changes.

The creation panel accepts drops only when active, ready for intake, and neither busy nor updating (including the synchronous update guard). Workbench skips archive acceptance for the current create session, hides its shared picker, and alone emits `filesProcessed` once per drop, including ignored drops. The published creation panel owns its file and folder inputs. It lists selected paths and sizes, skips re-additions matching relative path, name, size, and modification time, and preserves other name collisions with (1), (2) suffixes in the ZIP. Empty selection and a combined size above 1,000,000,000 bytes disable execution; the exact limit is accepted, but processing may still fail. Failure shows retry guidance and retains the selection. Progress identifies the next file. Success shows the file count and `created.zip` with an explicit Save control, without an automatic download. The screen offers no password or encryption. Folder selection and drop relative paths depend on the browser and need device verification; an automation skip does not establish browser incompatibility.

Register the operation in `src/i18n/ops.ts` with its short public `ZIP_SLUGS` slug and representative engine entry point. Historical slugs live separately in `legacy/slugs.json`; publishing an operation does not revive its old URL. Extend input and output types, route and reducer guards, then controller execution and resource cleanup. Add progress, result fields, and actual counts, then tabs, localized text, keyboard and accessible names. Set `available` only after the screen, guards, text, and verification are ready; an engine API alone does not make an operation publishable. Page and navigation generation should use the derived available list. Test worker transfer and component behavior, and update public documentation.

## Dormant image UI

`src/app/image/ImageConverter.tsx` is an independent, unmounted image tool. No public
page imports it. It owns one PWA startup component; page integration must remove
the coming-soon page's existing startup mount to avoid duplication.

Picker, global drop and clipboard paste enter one serial queue. Drop notifications
are acknowledged immediately after registration, without waiting for conversion.
JPG is the default; the selected format stays locked until the queue drains,
including additional inputs received during conversion. Inputs are identified by
bytes, not their extension or MIME hint. Logs contain names, states and error
codes only; filenames are rendered as text. AVIF guidance appears only for a
byte-identified AVIF decode failure.

Unlike ZIP's explicit saves, each successful image immediately starts a browser
download. Names are unique across the mount, including previous numbered names
and format changes. A thrown download error is logged as failure and processing
continues. “Saved” records a successful download initiation, not OS confirmation.
The queue releases each completed input and Blob before the next conversion;
there is no preview, retained result Blob, or re-save action.

Synchronous queue state protects update safety before rendering. Only unfinished
work blocks updates; completed logs do not. Update application stops all intake
and readiness. Page departure clears pending inputs, invalidates late results and
terminates the client and its workers. Unmount also removes subscriptions and
input listeners. Returning from the back-forward cache accepts fresh inputs with
a new client and never replays interrupted work.

Multiple download permission, OS saves, real worker execution, browser decoding,
and device memory limits remain unverified for this dormant UI. Public image
pages retain coming-soon content and noindex.
