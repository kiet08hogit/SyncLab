const TERMS = {
  overlay: 'A config layer that is merged over the base, as with ramda helpers.',
  tag: 'A short label attached to a record.',
};

function define(term) {
  return TERMS[term] || null;
}

module.exports = { define };
