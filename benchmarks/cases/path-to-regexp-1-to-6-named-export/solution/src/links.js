const { compile } = require('path-to-regexp');

const profilePath = compile('/users/:user', { encode: encodeURIComponent });
const filePath = compile('/projects/:project/files/:name', { encode: encodeURIComponent });

function profileLink(user) {
  return profilePath({ user });
}

function fileLink(project, name) {
  return filePath({ project, name });
}

module.exports = { profileLink, fileLink };
