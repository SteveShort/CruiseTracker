const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    await page.goto('http://localhost/');
    await page.waitForTimeout(5000);
    const count = await page.locator('#dealsContainer .deal-card').count();
    console.log('CARDS FOUND:', count);
    
    const errs = await page.evaluate(() => {
        return window.errLogs || [];
    });
    console.log('CLIENT ERRORS:', errs);
    
    await browser.close();
})();
