import { expose } from 'comlink';
import { createImageWorkerApi } from './worker-api';

expose(createImageWorkerApi());
