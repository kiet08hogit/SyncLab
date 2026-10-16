import path from 'node:path';
import filenamify, { filenamifyPath } from 'filenamify';

export function reportFileName(title, extension = 'pdf') {
  return `${filenamify(title, { replacement: '-' })}.${extension}`;
}

export function attachmentPath(directory, originalName) {
  return filenamifyPath(path.join(directory, originalName), { replacement: '_' });
}
