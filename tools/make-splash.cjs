// Draws the launch screen (tools/splash-gen.html) and writes it for iOS and Android.
// usage (from the repo root): node tools/make-splash.cjs
// Needs Playwright's Chromium and sharp (from @capacitor/assets). Only splash files are touched.
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const PORT = 8092;

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const proxy = process.env.HTTPS_PROXY;
  const b = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: 'splash.test' }, args: ['--host-resolver-rules=MAP splash.test 127.0.0.1'] } : {});
  try {
    const p = await b.newPage({ viewport: { width: 800, height: 800 } });
    await p.goto(`http://${proxy ? 'splash.test' : 'localhost'}:${PORT}/tools/splash-gen.html`);
    await p.waitForFunction(() => window.done, null, { timeout: 20000 });
    if (!(await p.evaluate(() => window.fontsOk))) throw new Error('fonts did not load');
    console.log('title', await p.evaluate(() => window.titleInfo));
    const png = Buffer.from((await p.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64');
    for (const f of ['assets/splash.png', 'assets/splash-dark.png']) await sharp(png).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(root, f));
    const out = sz => sharp(png).resize(sz[0], sz[1], { fit: 'cover', position: 'centre' }).png({ palette: true, quality: 100, effort: 10, dither: 1 });
    // iOS: the launch storyboard fills the screen with this square image
    const iosDir = path.join(root, 'ios/App/App/Assets.xcassets/Splash.imageset');
    for (const f of fs.readdirSync(iosDir).filter(f => f.endsWith('.png'))) await out([2732, 2732]).toFile(path.join(iosDir, f));
    // Android: one image per orientation and density, same sizes as before
    const res = path.join(root, 'android/app/src/main/res');
    for (const d of fs.readdirSync(res).filter(d => d.startsWith('drawable'))) {
      const f = path.join(res, d, 'splash.png');
      if (!fs.existsSync(f)) continue;
      const m = await sharp(f).metadata();
      await out([m.width, m.height]).toFile(f + '.tmp'); fs.renameSync(f + '.tmp', f);
    }
    console.log('splash written');
  } finally { await b.close(); srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
