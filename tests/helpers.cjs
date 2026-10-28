const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(file, names = [], globals = {}) {
  let code = fs.readFileSync(path.join(root, 'app', file), 'utf8');
  const context = { console, URL, Blob, Uint8Array, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
    document: { addEventListener() {}, getElementById() { return null; } }, ...globals };
  context.window = context;
  if (names.length) {
    const at = code.lastIndexOf(file === 'app.js' ? '})();' : '})(typeof window');
    if (at < 0) throw Error('Test instrumentation boundary missing: ' + file);
    code = code.slice(0, at) + '\nglobalThis.testApi = {' + names.join(',') + '};\n' + code.slice(at);
  }
  vm.runInNewContext(code, context, { filename: file });
  return context;
}
module.exports = { load, root, plain: x => JSON.parse(JSON.stringify(x)) };
