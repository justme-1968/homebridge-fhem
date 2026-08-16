var h = require('./helpers');

require('./hmccu-mappings');
require('./hmccu-accessory');
require('./hmccu-commands');

process.exit( h.summary() ? 1 : 0 );
