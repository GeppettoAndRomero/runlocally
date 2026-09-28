export interface ZipEntry {
  name: string;
  directory: boolean;
  size: number;
  compressedSize: number;
  date?: Date;
  encrypted: boolean;
  utf8: boolean;
}

export interface ExtractedFile {
  name: string;
  blob: Blob;
}
