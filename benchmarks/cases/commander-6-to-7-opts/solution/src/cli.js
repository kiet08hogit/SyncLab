const { Command } = require('commander');

function collect(value, previous) {
  return previous.concat([value]);
}

function parseArgs(argv) {
  const program = new Command();
  program
    .name('backup')
    .option('-d, --dest <dir>', 'destination directory', './backups')
    .option('-k, --keep <count>', 'number of archives to keep', (value) => parseInt(value, 10), 7)
    .option('-x, --exclude <pattern>', 'pattern to skip, repeatable', collect, [])
    .option('--no-compress', 'store archives uncompressed')
    .option('-v, --verbose', 'log every file');

  program.parse(argv, { from: 'user' });
  const options = program.opts();

  return {
    dest: options.dest,
    keep: options.keep,
    exclude: options.exclude,
    compress: options.compress,
    verbose: Boolean(options.verbose),
    sources: program.args,
  };
}

module.exports = { parseArgs };
