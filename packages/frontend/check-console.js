const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 收集所有日志
  const logs = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    logs.push(`[ERROR] ${err.message}`);
  });

  try {
    await page.goto('http://localhost:3000/test-3d', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(8000);

    // 截图
    await page.screenshot({ path: '/tmp/pactum_playwright.png' });

    // 打印日志
    console.log('\n=== Console Logs ===');
    logs.forEach(log => console.log(log));

    // 检查页面内容
    const bodyText = await page.textContent('body');
    console.log('\n=== Page Content (first 500 chars) ===');
    console.log(bodyText.substring(0, 500));

  } catch (e) {
    console.error('Error:', e.message);
    console.log('\n=== Collected Logs Before Error ===');
    logs.forEach(log => console.log(log));
  }

  await browser.close();
})();
