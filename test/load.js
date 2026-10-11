// Loads the browser scripts into Node's global scope for tests.
const path = require('path');
for (const f of ['core', 'terrain', 'player', 'inventory', 'modworld', 'world', 'mesher', 'net']) require(path.join(__dirname, '..', 'js', f + '.js'));
module.exports = globalThis.BC;
