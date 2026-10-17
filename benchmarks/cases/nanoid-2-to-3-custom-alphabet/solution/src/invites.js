const { customAlphabet } = require('nanoid');

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const generate = customAlphabet(INVITE_ALPHABET, 8);

function inviteCode() {
  const raw = generate();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

module.exports = { inviteCode, INVITE_ALPHABET };
