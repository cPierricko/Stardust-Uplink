const crypto = require('crypto');

module.exports = {
    jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')
};
