import type { EngineErrorCode } from '../engine/errors';
import type { AvailableOp } from './ops';

export interface PageContent {
  title: string;
  description: string;
  h1: string;
  lead: string;
  steps: readonly { heading: string; body: string }[];
  faq: readonly { question: string; answer: string }[];
  limits: readonly string[];
}

export type WorkbenchStringKey =
  | 'input'
  | 'choose'
  | 'busy'
  | 'single'
  | 'large'
  | 'unknown'
  | 'source'
  | 'browse'
  | 'extract'
  | 'entries'
  | 'files'
  | 'eligible'
  | 'name'
  | 'size'
  | 'previous'
  | 'next'
  | 'page'
  | 'all'
  | 'one'
  | 'chooseOne'
  | 'run'
  | 'results'
  | 'save'
  | 'saveFile'
  | 'reinput'
  | 'reinputFile'
  | 'count'
  | 'listingError'
  | 'jobError'
  | 'encrypted'
  | 'duplicate'
  | 'reset'
  | 'progress'
  | 'remove'
  | 'fix-names'
  | 'removeGuide'
  | 'keep'
  | 'keepAll'
  | 'clearAll'
  | 'duplicateKeep'
  | 'plannedRemove'
  | 'keptFiles'
  | 'entriesUnit'
  | 'filesUnit'
  | 'emptyKeep'
  | 'removeRun'
  | 'repairRun'
  | 'repairGuide'
  | 'repairBefore'
  | 'repairAfter'
  | 'plannedRepair'
  | 'collision'
  | 'orderGuide'
  | 'goRepair'
  | 'removed'
  | 'kept'
  | 'repaired'
  | 'processingEntry'
  | 'retryListing'
  | 'listingZip'
  | 'listingArchive'
  | 'listingTar'
  | 'listingUnknown'
  | 'wrong-password'
  | 'encrypted-entry'
  | 'bad-central'
  | 'corrupt-entry'
  | 'too-large'
  | 'unsupported'
  | 'not-encrypted'
  | 'aborted'
  | 'genericInput'
  | 'genericListing'
  | 'genericJob'
  | 'removeEncrypted'
  | 'repairEncrypted'
  | 'encryptedKept'
;
export type WorkbenchStrings = { [K in WorkbenchStringKey]: string };
export type SharedStringKey =
  | 'language'
  | 'security'
  | 'required'
  | 'close'
  | 'themeLabel'
  | 'themeToLight'
  | 'themeToDark'
  | 'dropTitle'
  | 'dropHint'
  | 'processing'
  | 'wait'
  | 'installTitle'
  | 'installBody'
  | 'install'
  | 'later'
;
export type SharedStrings = { [K in SharedStringKey]: string };
export type UpdateStrings = { [K in 'title' | 'now' | 'busy' | 'work' | 'tabs' | 'coordination' | 'error' | 'retry' | 'applying' | 'reloadDeferred']: string };
export type ChromeStringKey = 'navigation' | 'home' | 'languages';
export type ChromeStrings = { [K in ChromeStringKey]: string };
export type InputStateKey = 'dropHint' | 'emptyResults' | 'progressLabel';
export type InputStateStrings = { [K in InputStateKey]: string };
export type MenuStringKey = AvailableOp['i18nKey'];
// verb is the primary label and description is supporting text; consumers use menuUi.
export type MenuEntryStrings = { verb: string; description: string };
export type MenuStrings = { [K in MenuStringKey]: MenuEntryStrings };
export interface UiStrings { workbench: WorkbenchStrings; shared: SharedStrings; chrome: ChromeStrings; inputState: InputStateStrings; menu: MenuStrings }

// Every engine code must have localized text in the workbench dictionary.
export type MissingEngineText = Exclude<EngineErrorCode, WorkbenchStringKey>;
