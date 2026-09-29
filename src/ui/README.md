# Shared UI components

Import individual components from this directory. Load `../styles/tokens.css`, then `../styles/base.css`, then `components.css` in the host layout. The components have no stylesheet imports and do not mount themselves on a page.

- `AppButton`: `variant` is `primary`, `secondary`, or `ghost`; `type` defaults to `button`. Disabled buttons retain native disabled behavior.
- `AppCard`: optional title and description precede the children.
- `AppField`: controlled `value` and `onChange`; the label, error and help text are connected to the input through `for` and `aria-describedby`. `locale` selects the required marker.
- `AppModal`: `isOpen`, `onClose`, title and children. The close button, backdrop and Escape call `onClose`. Its effect restores the prior body overflow and removes the key listener.
- `ThemeToggle`: reads and writes the `runlocally-theme` display preference. `auto` follows the system color setting and removes its listener on unmount.
- `GlobalDropZone`: listens on `document.body` for drag and drop, on `document` for pasted files, and on `window` for `filesProcessed`. It emits `filesDropped` as `CustomEvent<File[]>`. The Workbench host sets `window.__toolReady` after installing its listener, acknowledges each `filesDropped` notification with `filesProcessed`, and clears ready and listeners on departure. This component does not set ready. Workbench accepts one archive per notification; the shared drop component can still emit multiple files. Folder entries are read through all batches and nested levels. When folder scanning fails or yields no files, available flat files are used. If a browser does not allow `webkitRelativePath` assignment, only the filename remains. Unmount removes listeners and suppresses results from pending scans. Folder support here does not itself add a create screen.
- `InstallPrompt`: only shows after `beforeinstallprompt`; the browser must provide that event. The component does not promise installation or offline support. It stores only display preferences under the `runlocally-install-prompt-*` keys. It removes the listener on unmount.

All components accept `ja` or `en` through `Locale` from `src/i18n/locales.ts`. Omitting `locale` keeps the existing English fallback, derived from that locale list. Generic text remains in `strings.ts` and must satisfy the finite shared keys in `UiStrings` from `src/i18n/types.ts`. Workbench text stays in `src/app/workbench-strings.ts` and satisfies the workbench keys of the same contract. Component tests use jsdom; they do not establish browser installation availability or visual appearance.

## Changes from the source components

| Component | Display or styling difference | Reason |
| --- | --- | --- |
| `AppButton` | Button element, variant classes, and disabled styling are retained. The required button rules are copied into `components.css`; unrelated form and page rules are omitted. | Keep the button's appearance without loading the source application's whole stylesheet. |
| `AppCard` | Header, title, description, and child order are retained. Card rules are included in `components.css`. | Preserve the card structure and its visual dependencies. |
| `AppField` | Error and help text now render together instead of hiding help when an error exists. Both IDs are listed in `aria-describedby`. The field rules are included in `components.css`. | Keep both pieces of guidance available to sighted and assistive technology users. |
| `AppModal` | The backdrop, dialog, header, close button, and content remain. Inline layout styles moved to `components.css`; the inline hover handlers and animations were removed. The dialog now has a role, modal state, and title label. | Keep layout styles in one place and expose the dialog structure to assistive technology. |
| `ThemeToggle` | The icon and text button remains. Inline base and hover styles moved to `components.css`; the hover transform, shadow, and icon sizing were omitted. | Avoid style mutation handlers while retaining a visible theme control. |
| `GlobalDropZone` | The full-screen, non-intercepting overlay remains, but its inner bordered panel was removed. Icon, heading, and supporting text are direct children; inline fade and spinner animations were omitted. | Keep the drop feedback while using a smaller shared CSS surface. |
| `InstallPrompt` | Banner and footer modes remain, but the nested banner layout, phone icons, pulse and slide animations, and inline hover styles were removed. The banner uses a named region; both modes use classes in `components.css`. | Keep the event-driven install action and dismissal controls without carrying over decorative effects or source-specific layout. |

`tokens.css` and `base.css` retain their shared token and base rules. `components.css` contains only the selectors needed by these components; it is not a copy of the source application's full component stylesheet. Folder scans and emitted file notifications are independent: a `filesProcessed` event acknowledges a previously emitted notification and does not cancel a scan still in progress.

## Browser check

In a production build opened in Chromium, a temporary page rendered every component in Japanese and English. The theme toggle switched between light and dark tokens; without a stored choice the page stays light, matching the source components, which deliberately do not follow the system setting. The modal opened and closed with Escape, keyboard focus showed a 2px outline, and dragging over the page showed the drop overlay. No request left the page's origin.
