const { parse } = require('csv-parse');

function parseOrders(text) {
  return new Promise((resolve, reject) => {
    parse(text, { columns: true, cast: true, delimiter: ';' }, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows.map((row) => ({ ...row, total: row.quantity * row.price })));
    });
  });
}

module.exports = { parseOrders };
