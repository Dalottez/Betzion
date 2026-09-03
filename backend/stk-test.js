const os = require('os');
const path = require('path');

// This launcher is deliberately local-only. It prevents real STK test deposits
// from reading or writing the MongoDB connection configured for production.
process.env.MIN_DEPOSIT_AMOUNT = '10';
process.env.MONGODB_URI = '';
process.env.LOCAL_DATA_DIR = path.join(os.tmpdir(), `aviator-stk-test-${process.pid}`);

console.log('Starting isolated STK test mode: minimum KES 10; disposable local data; MongoDB disabled.');
console.log('Stop this process after the two tests. Normal "npm start" keeps the KES 999 production minimum.');

require('./server');
