import { expose } from 'comlink';
import { createHeicWorkerApi } from './libheif-adapter';

expose(createHeicWorkerApi());
