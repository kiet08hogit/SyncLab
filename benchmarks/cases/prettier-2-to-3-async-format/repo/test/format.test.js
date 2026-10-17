const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatProject, unformattedFiles } = require('../src/format.js');

const files = {
  'src/index.js': 'const greet = (name)=>{return "hi " + name}\n',
  'src/theme.css': 'a{color:red;margin:0}\n',
  'package.json': '{"name":"demo","version":"1.0.0"}\n',
  'README.md': '# Demo\n',
  'src/ok.js': "export const answer = 42;\n",
};

describe('formatProject', () => {
  it('formats every supported file', async () => {
    assert.deepEqual(await formatProject(files), {
      'src/index.js': "const greet = (name) => {\n  return 'hi ' + name;\n};\n",
      'src/theme.css': 'a {\n  color: red;\n  margin: 0;\n}\n',
      'package.json': '{ "name": "demo", "version": "1.0.0" }\n',
      'README.md': '# Demo\n',
      'src/ok.js': 'export const answer = 42;\n',
    });
  });
});

describe('unformattedFiles', () => {
  it('lists the files that need formatting', async () => {
    assert.deepEqual(await unformattedFiles(files), ['src/index.js', 'src/theme.css', 'package.json']);
  });
});
