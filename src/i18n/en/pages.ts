import type { AvailableOp } from '../ops';
import type { PageContent } from '../types';

type PageKey = 'top' | AvailableOp['i18nKey'];

export const pages = {
  top: {
    title: 'Browser ZIP Workbench | runlocally',
    description: 'Inspect archives, extract selected entries, and rebuild ZIP files in your browser using a local file.',
    h1: 'Work with ZIP entries in your browser',
    lead: 'Select a local archive to inspect its entries. Extract files, or filter and repair names in ZIP files before saving a separate result.',
    steps: [{ heading: 'Select an archive', body: 'Choose or drop a local ZIP, RAR, 7z, or tar file.' }, { heading: 'Inspect and act', body: 'Review entries, then extract files. ZIP inputs also offer removal and filename repair.' }, { heading: 'Save a result', body: 'Review generated results and save them explicitly.' }],
    faq: [{ question: 'Does this overwrite the source?', answer: 'Generated results are separate from the input file. Saving is an explicit action.' }],
    limits: ['The input limit is decimal 1 GB (1,000,000,000 bytes). An input within that limit is not guaranteed to process successfully.'],
  },
  browse: {
    title: 'Inspect ZIP Entries and Metadata | runlocally',
    description: 'Select a local archive to inspect entry names and sizes without saving its contents first.',
    h1: 'Inspect ZIP entries before extracting files',
    lead: 'Choose or drop an archive from your device. The entry list shows names and sizes without requiring you to extract and save the contained files.',
    steps: [{ heading: 'Select a local file', body: 'Choose or drop a ZIP, RAR, 7z, or tar archive already on your device.' }, { heading: 'Review metadata', body: 'Inspect entry names and sizes to decide what to extract.' }],
    faq: [{ question: 'Can I preview document or image contents?', answer: 'The browse view lists entries. It does not preview document or image contents.' }],
    limits: ['ZIP listing reads central-directory metadata; a successful list does not validate entry contents.', 'Missing or damaged directory information can fail listing. An encrypted central directory is reported as unsupported.'],
  },
  extract: {
    title: 'Extract Selected ZIP Entries | runlocally',
    description: 'Extract one selected entry or eligible files from an archive, then explicitly save the results.',
    h1: 'Extract the ZIP entries you need',
    lead: 'Inspect the entry list and extract one file or all eligible files. Generated results are saved only when you choose to save them.',
    steps: [{ heading: 'Inspect entries', body: 'Choose a local archive and review its file list.' }, { heading: 'Extract and save', body: 'Run a single-entry or all-files extraction, then save the results you need.' }],
    faq: [{ question: 'What if ZIP entries share a name?', answer: 'Single-entry extraction uses the first entry whose full name matches.' }],
    limits: ['ZIP extract-all excludes encrypted entries and directories. Single-entry extraction rejects an encrypted entry.'],
  },
  remove: {
    title: 'Filter ZIP Entries and Rebuild | runlocally',
    description: 'Choose entries to keep and build a separate ZIP without manually extracting and recompressing files.',
    h1: 'Remove unwanted entries by rebuilding a ZIP',
    lead: 'Select entries to keep, then build a new ZIP. You do not need to manually extract and recompress the archive; saving the result is a separate action.',
    steps: [{ heading: 'Choose what remains', body: 'Use the entry list to select what the new ZIP will keep.' }, { heading: 'Build and save', body: 'Run the rebuild, review its result, and save it explicitly. The source stays unchanged.' }],
    faq: [{ question: 'What happens to encrypted entries?', answer: 'Excluded entries can be skipped before decryption. Keeping an encrypted entry fails this screen’s rebuild without a password.' }],
    limits: ['The screen requires at least one file to remain. Kept files are read and written into the new ZIP internally.'],
  },
  'fix-names': {
    title: 'Preview ZIP Filename Decoding | runlocally',
    description: 'Compare Shift_JIS filename candidates with original names and rebuild a ZIP after reviewing changes.',
    h1: 'Review garbled ZIP filenames before rebuilding',
    lead: 'Preview names decoded from original filename bytes as Shift_JIS. Compare each candidate before building a separate ZIP; the proposed encoding may not be correct.',
    steps: [{ heading: 'Review candidate names', body: 'Compare original filenames with the proposed decoded names.' }, { heading: 'Rebuild if suitable', body: 'If there is no new name collision, create and optionally save a separate ZIP.' }],
    faq: [{ question: 'Which entries are candidates?', answer: 'Detection starts with non-ASCII names without a UTF-8 flag. Only names with original bytes that change when decoded as Shift_JIS are included.' }],
    limits: ['Entries without original filename bytes are excluded. A new collision between names blocks the operation.', 'This does not repair damaged directory metadata or entry contents. The screen does not offer password-based rebuilding of retained encrypted entries.'],
  },
} satisfies Record<PageKey, PageContent>;
