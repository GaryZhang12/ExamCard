const path = require('node:path');
module.exports = function dependency(name) {
  try { return require(name); } catch (e) {
    if (!process.env.EXAMCARD_TEST_MODULES) throw new Error('Install test dependencies or set EXAMCARD_TEST_MODULES. Missing: ' + name);
    return require(path.join(process.env.EXAMCARD_TEST_MODULES, name));
  }
};
