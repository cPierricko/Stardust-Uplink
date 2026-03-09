const isProd = process.env.NODE_ENV === 'production';

module.exports = {
    rpName: process.env.RP_NAME || 'Rogue One App Center',
    rpID: isProd ? 'rogue-one.cloud' : 'localhost',
    origin: isProd ? 'https://rogue-one.cloud' : (process.env.ORIGIN || 'http://localhost:5173')
};
