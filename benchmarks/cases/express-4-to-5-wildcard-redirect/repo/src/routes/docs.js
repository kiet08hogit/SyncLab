const path = require('path');

function guide(req, res) {
  res.sendfile(path.join(__dirname, '..', 'public', 'guide.txt'));
}

module.exports = { guide };
