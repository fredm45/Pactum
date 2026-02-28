const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 监听控制台日志
  page.on('console', msg => {
    console.log('[Browser]', msg.text());
  });

  // 访问页面
  console.log('Loading http://localhost:3000...');
  await page.goto('http://localhost:3000', { timeout: 30000, waitUntil: 'domcontentloaded' });

  // 等待 3D 场景加载
  console.log('Waiting for 3D scene...');
  await page.waitForTimeout(3000);

  // 截图
  await page.screenshot({ path: '/tmp/pactum_auto.png', fullPage: true });
  console.log('Screenshot saved to /tmp/pactum_auto.png');

  // 获取页面信息
  const agentCount = await page.evaluate(() => {
    return document.querySelectorAll('.agent-label').length;
  });
  console.log(`Agents visible: ${agentCount}`);

  await browser.close();
})();
