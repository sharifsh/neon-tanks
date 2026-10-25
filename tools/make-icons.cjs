const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'neon.test' }, args: ['--host-resolver-rules=MAP neon.test 127.0.0.1'] });
  const p = await b.newPage(); await p.goto('http://neon.test:8080/icon-gen.html');
  await p.waitForFunction(() => window.out, null, { timeout: 20000 });
  const o = await p.evaluate(() => window.out);
  for (const [k, v] of Object.entries(o)) fs.writeFileSync(`assets/${k === 'icon' ? 'icon-only' : 'splash'}.png`, Buffer.from(v.split(',')[1], 'base64'));
  fs.copyFileSync('assets/splash.png', 'assets/splash-dark.png');
  await b.close();
})();
