module.exports = {
    rpName: process.env.RP_NAME || 'Rogue One App Center',
    rpID: process.env.RP_ID || 'localhost',
    origin: process.env.ORIGIN || (process.env.NODE_ENV === 'production' ? 'https://rogue-one.cloud' : 'http://localhost:5173')
};
