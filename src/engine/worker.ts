import { expose } from 'comlink';
import { configure } from '@zip.js/zip.js';
import { registerEngineErrorTransfer } from './worker-protocol';
import { workerApi } from './worker-api';

configure({ useWebWorkers: false });
registerEngineErrorTransfer();
expose(workerApi);
