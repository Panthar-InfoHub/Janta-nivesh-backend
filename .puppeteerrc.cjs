const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
    // Bundles Chrome into the permanent image so it survives the deploy
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};