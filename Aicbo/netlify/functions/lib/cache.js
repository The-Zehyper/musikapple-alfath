const NodeCache = require('node-cache');

// TTL 3600 detik = 1 jam, khusus dipakai untuk cache Dashboard Home
// stdTTL: umur default tiap key | checkperiod: interval pembersihan key kedaluwarsa
const homeCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

module.exports = { homeCache };
