const generate = require('nanoid/generate');

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function inviteCode() {
  const raw = generate(INVITE_ALPHABET, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

module.exports = { inviteCode, INVITE_ALPHABET };
