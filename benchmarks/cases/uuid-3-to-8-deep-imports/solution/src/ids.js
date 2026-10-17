const { v4: uuidv4, v5: uuidv5 } = require('uuid');

const TENANT_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function requestId() {
  return uuidv4();
}

function tenantId(domain) {
  return uuidv5(domain.toLowerCase(), TENANT_NAMESPACE);
}

module.exports = { requestId, tenantId };
