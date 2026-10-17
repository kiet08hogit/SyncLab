const parse = require('csv-parse/lib/sync');

function parseContacts(text) {
  return parse(text, {
    columns: (header) => header.map((name) => name.trim().toLowerCase()),
    skip_empty_lines: true,
    skip_lines_with_error: true,
    trim: true,
  }).filter((contact) => contact.email);
}

module.exports = { parseContacts };
