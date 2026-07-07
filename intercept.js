const fs = require('fs');
const originalWriteFileSync = fs.writeFileSync;

fs.writeFileSync = function(file, data, options) {
    if (typeof file === 'string' && file.includes('db_conn.log')) {
        console.log('[Interceptor] Suppressed writing to hardcoded db_conn.log to prevent ENOENT crash.');
        return;
    }
    return originalWriteFileSync(file, data, options);
};
