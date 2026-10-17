import path from 'node:path';
import filenamify from 'filenamify';

export function reportFileName(title, extension = 'pdf') {
  return `${filenamify(title, { replacement: '-' })}.${extension}`;
}

export function attachmentPath(directory, originalName) {
  return filenamify.path(path.join(directory, originalName), { replacement: '_' });
}
