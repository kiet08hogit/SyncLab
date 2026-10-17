const path = require('node:path');
const mime = require('mime');

const TEXT_TYPES = new Set(['application/json', 'application/javascript', 'image/svg+xml']);

function contentTypeFor(file) {
  const type = mime.lookup(file);
  if (type.startsWith('text/') || TEXT_TYPES.has(type)) {
    return `${type}; charset=utf-8`;
  }
  return type;
}

function downloadName(baseName, type) {
  const extension = mime.extension(type);
  return extension ? `${path.parse(baseName).name}.${extension}` : baseName;
}

module.exports = { contentTypeFor, downloadName };
