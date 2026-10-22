import type { ImageStage } from './convert';
import type { ImageOutputFormat, ImageResult } from './types';

export type ImageProgressMessage = { type: 'image-progress'; requestId: number; stage: ImageStage };

export type ImageConvertRequest = {
  type: 'convert'; requestId: number; input: Blob; format: ImageOutputFormat;
};
export type ImageInterruptRequest = { type: 'interrupt'; requestId: number };
export type ImageWorkerResult = { type: 'result'; requestId: number; result: ImageResult<Blob> };
