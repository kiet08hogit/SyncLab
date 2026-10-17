const path = require('path');

function guide(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'guide.txt'));
}

module.exports = { guide };
