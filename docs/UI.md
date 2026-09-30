# Workbench UI

The Japanese and English top and available operation pages each mount the same Workbench. It owns presentation and dispatches actions to the pure session reducer. The controller owns asynchronous listing and jobs, creates and closes one ZIP client or archive handle per request, and ignores notifications after invalidation. The engine performs local parsing and rewriting. `downloadBlob` handles explicit saves. Results are separate Blobs; creating one neither saves it nor replaces the input.

## State and transitions

```text
new input or explicit result reinput -> listing: idle -> reading -> ready | error
                                                error -> retry -> reading
ready -> job: idle -> running -> succeeded | failed
                             failed -> change selection/op -> running
reset -> empty session
```

The input card keeps a native file picker inside a visible label. Its hint also describes drag and clipboard paste. The full-screen overlay reports drag and file checking separately; it uses the same global intake path. A source chip shows the unmodified filename and archive kind. Reset appears when input, processing, an error, or results make clearing the session meaningful; it is absent in the initial and reset state.

The results container is always present. Before an operation creates a result, it shows guidance rather than a result article. A successful operation with zero extracted files still creates a result article. Each result keeps its source line, actual counts, and explicit Save and reinput controls; it never saves or replaces input automatically. Alerts and status messages retain their text and roles, with decorative icons hidden from assistive technology. Extract progress adds a native progress bar when the total is valid; rewrite progress names the next entry and does not indicate completed work.

The `inputState` text lives in the locale UI dictionaries and is aggregated separately by `src/ui/input-state-copy.ts`. The existing workbench and shared dictionary export keeps its finite key contract.

The URL records only the current public page and locale. Header operation links, language links, tabs, keyboard, entry extraction, repair guidance, and the language select use the same in-page transition. The header marks the current page and language. Back and Forward restore the page, locale, and selected operation without rolling back the File, selection, settings, job, or results. Reset clears the session but keeps the current page and locale. Reloading creates a new session. Accepted inputs hide only the page explanation; reset shows the current page explanation again. Header links also have ordinary public URLs for navigation without JavaScript.

`html[data-zip-top]` exists only on ZIP top. Static HTML and `displayPage()` set it from the same page condition. Operation cards appear only for the current language on ZIP top while the session is closed; their visibility does not depend on the brand link's current-page marker. Workbench continues to manage `data-session`. Reset keeps the current page and language, and the brand link still points to ZIP top.

Listing and job are separate state machines. A new input increments `generation`; each listing attempt has a new `requestId`, and each job has a new ID. Late progress and responses are discarded. Reset, pagehide, and unmount close active resources. A return from the page cache creates a new controller. Listing retry keeps the same File, generation, result history, and chain. A failed job keeps its input, selection, results, and successful log.

A result becomes the next input only through the explicit action. Its chain is derived from that result's own source chain and ID. A size check of 1,000,000,000 bytes precedes header reading for both new and derived inputs. The first 263 bytes choose the ZIP or archive route; an unknown signature does not start an engine job.

## Operations

Operation pages request their corresponding tab after a ZIP is accepted. RAR, 7z, and tar keep only Browse and Extract available; a removal or name repair URL is replaced with the Browse URL when such an input is accepted. Opening a page never runs its operation automatically.

ZIP has Browse, Extract, Remove, and Repair names tabs. RAR, 7z, and tar have Browse and Extract. The selected tab keeps an underline and bold text. Left and Right arrows cycle through available tabs, moving selection and focus together. The tab panel has one card frame. The displayed entry lists use pages of 500 rows, including a one-page empty list. Sizes remain raw `N B` values. Entry names wrap without truncation; ZIP directories have a distinct decorative icon, while entries without directory metadata use a generic file icon. Extract all ignores removal selection. A single extract chooses the first matching ZIP name; encrypted ZIP entries are unavailable in the extraction controls.

Removal selection means **keep**. All entries start selected. Native checkboxes retain checked, unchecked, and mixed states, also marked by the row edge. A directory control covers itself and actual descendants at a directory boundary. Its checked, unchecked, or mixed state includes the directory entry itself, matching the set passed to rewrite even when all children are excluded. Duplicate names share a decision, including across pages. Planned exclusions count entry rows, including directories and duplicates; the separate kept file count excludes directories. Zero exclusions or zero kept files disable execution. The controller snapshots the keep set and sends only `keep` to rewrite. Encrypted entries that are excluded can be skipped before decryption; keeping one causes an error without a password. The engine's empty ZIP behavior is unchanged.

Repair candidates must be non-UTF-8 and non-ASCII, have original filename bytes, and decode to a different name as Shift_JIS. Preview and rewrite callback use the same function. Before and candidate names stay in that order, side by side when space permits and wrapped in narrow layouts. Candidate names are text, not executable content. UTF-8 names, absent bytes, unchanged decodes, and zero targets do not start repair. A newly created collision between distinct source names blocks execution and shows the target name. The candidate is a suggestion, not a guarantee of correct encoding. A rename callback evaluates each entry's own metadata, including duplicate entries. Removal rewrites output names as UTF-8, so inspect repair before removal; later repair of a trimmed ZIP is not guaranteed.

The layout follows the operating system light or dark scheme. Check every panel, pager, and result at 360, 768, and 1280 pixels in both schemes for horizontal overflow and visible keyboard focus. Radio buttons, checkboxes, and selects remain native controls with at least 44-pixel control areas.

Rewrite progress points at the entry about to be processed. The result card appears only after the rewrite Promise resolves. Removal displays actual `removed` and `kept`, repair actual `renamed`, all including directories and including zero. The derived ZIP name is shared by the card, explicit save, and explicit reinput. The original File is not modified.

## Errors and recovery

Input, listing, and job failures share localized explanations for all six engine codes, aborts, and ordinary exceptions. Raw engine messages are not the main text. Failed jobs identify the operation that failed even if another tab is selected. Errors use alerts. A ZIP signature with failed listing prompts a separate future recovery feature; it does not promise repair. RAR and 7z listing errors offer retry before extraction. Tar listing errors also offer retry. Unknown signatures request another input. Signature detection does not establish integrity or promise extraction success.

## Adding an operation

See [I18N.md](I18N.md) for the publication and language workflow.

Register the operation in `src/i18n/ops.ts` with its legacy slug and representative engine entry point. Extend input and output types, route and reducer guards, then controller execution and resource cleanup. Add progress, result fields, and actual counts, then tabs, localized text, keyboard and accessible names. Set `available` only after the screen, guards, text, and verification are ready; an engine API alone does not make an operation publishable. Page and navigation generation should use the derived available list. Test worker transfer and component behavior, and update public documentation.
