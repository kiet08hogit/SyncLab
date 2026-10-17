const pathToRegexp = require('path-to-regexp');

const profilePath = pathToRegexp.compile('/users/:user');
const filePath = pathToRegexp.compile('/projects/:project/files/:name');

function profileLink(user) {
  return profilePath({ user });
}

function fileLink(project, name) {
  return filePath({ project, name });
}

module.exports = { profileLink, fileLink };
