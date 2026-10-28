import { test, expect } from '@playwright/test';
import { backend, fakeSmtp, routeBackend, READY, SMTP_PASS } from './support-standins.js';

// The support form and the admin page, in the browser, against the real server code wired to
// stand-ins (in-memory database, fake sign-in, scripted mail server). Nothing reaches the real backend.

const MESSAGE = 'The tank gets stuck on the bridge in River Crossing when I hold left.';

async function openSupport(page, be, { app } = {}) {
  if (app) await page.addInitScript(p => { window.Capacitor = { getPlatform: () => p, isNativePlatform: () => true }; }, app);
  const net = await routeBackend(page, be);
  await page.goto('/support.html');
  return net;
}

test.describe('support form', () => {
  test('explains what is missing, then sends; the server keeps the message with device details', async ({ page }) => {
    const smtp = fakeSmtp(), be = backend({ connect: smtp.connect });
    be.setSettings(READY, SMTP_PASS);
    const net = await openSupport(page, be);
    await page.click('#sfSend');
    await expect(page.locator('#sfStatus')).toHaveText(/check the highlighted fields/i);
    await expect(page.locator('#sfTopicErr')).toBeVisible();
    await expect(page.locator('#sfEmailErr')).toBeVisible();
    await expect(page.locator('#sfMessageErr')).toBeVisible();
    await expect(page.locator('#sfTopic')).toBeFocused();
    await page.selectOption('#sfTopic', 'purchase');
    await expect(page.locator('#sfRestoreTip')).toBeVisible(); // the usual answer, right there
    await page.selectOption('#sfTopic', 'bug');
    await expect(page.locator('#sfRestoreTip')).toBeHidden();
    await page.fill('#sfEmail', 'player@example.com');
    await page.fill('#sfMessage', MESSAGE);
    await expect(page.locator('#sfCount')).toHaveText(`${MESSAGE.length} / 4000`);
    await expect(page.locator('.hp')).not.toBeInViewport(); // the bot trap stays out of sight
    await page.waitForTimeout(2600); // people take longer than bots
    await page.click('#sfSend');
    await expect(page.locator('#supportSent')).toBeVisible();
    await expect(page.locator('#sentTo')).toHaveText('player@example.com');
    await expect(page.locator('#supportForm')).toBeHidden();
    expect(be.rows).toHaveLength(1);
    expect(be.rows[0]).toMatchObject({ email: 'player@example.com', topic: 'bug', message: MESSAGE, source: 'web', status: 'new' });
    expect(Object.keys(be.rows[0].device).sort()).toEqual(['lang', 'page', 'screen', 'tz', 'ua']);
    const sent = net.calls.find(c => c.action === 'submit');
    expect(sent.website).toBe(''); expect(sent.elapsed).toBeGreaterThanOrEqual(2500);
    await be.flush();
    expect(smtp.sent).toHaveLength(1); expect(smtp.ports).toEqual([465]);
    expect(be.rows[0].mail_status).toBe('sent');
    // another message: the form comes back empty
    await page.click('#sfAgain');
    await expect(page.locator('#supportForm')).toBeVisible();
    await expect(page.locator('#sfMessage')).toHaveValue('');
    expect(net.stray).toEqual([]);
  });

  test('in the app it says which app sent it', async ({ page }) => {
    const be = backend({ connect: fakeSmtp().connect });
    await openSupport(page, be, { app: 'ios' });
    await page.selectOption('#sfTopic', 'online');
    await page.fill('#sfEmail', 'player@example.com');
    await page.fill('#sfMessage', 'Friends cannot join my room code from Android.');
    await page.waitForTimeout(2600);
    await page.click('#sfSend');
    await expect(page.locator('#supportSent')).toBeVisible();
    expect(be.rows[0].source).toBe('ios');
  });

  test('when sending fails, the typed message stays and the email address is offered', async ({ page }) => {
    const be = backend({ connect: fakeSmtp().connect });
    await openSupport(page, be);
    await page.selectOption('#sfTopic', 'idea');
    await page.fill('#sfEmail', 'player@example.com');
    await page.fill('#sfMessage', 'Please add a desert map with quicksand.');
    await page.waitForTimeout(2600);
    // too many messages from this network
    for (let i = 0; i < 5; i++) await be.db.throttleAdd(['submit:h(unknown)']);
    await page.route('**/functions/v1/support', r => r.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'Too many' }) }));
    await page.click('#sfSend');
    await expect(page.locator('#sfStatus')).toContainText('several messages in a short time');
    await expect(page.locator('#sfStatus a[href^="mailto:trackmyreceipt@gmail.com"]')).toBeVisible();
    // no connection
    await page.route('**/functions/v1/support', r => r.abort());
    await page.click('#sfSend');
    await expect(page.locator('#sfStatus')).toContainText("couldn't be sent just now");
    await expect(page.locator('#sfMessage')).toHaveValue('Please add a desert map with quicksand.');
    await expect(page.locator('#sfSend')).toBeEnabled();
  });
});

// ---------- admin page ----------
async function seed(be) {
  await be.db.insertRequest({ email: 'first@example.com', topic: 'purchase', message: 'Restore did not work on my new iPad.', device: { ua: 'iPad', lang: 'en-GB' }, source: 'ios', status: 'done', mail_status: 'sent' });
  be.tick(3600e3);
  await be.db.insertRequest({ email: 'second@example.com', topic: 'bug', message: '<img src=x onerror="window.__pwned=1"> crash when the Titan spawns', device: { ua: 'Mozilla/5.0 (Linux; Android 15)', screen: '412x915@2.6' }, source: 'android', status: 'new', mail_status: 'failed', mail_error: 'Sign-in failed: 535 Bad credentials' });
  be.tick(3600e3);
  await be.db.insertRequest({ email: 'third@example.com', topic: 'idea', message: 'More maps please!\nAnd a snow mode.', device: {}, source: 'web', status: 'new', mail_status: 'off' });
}
async function signIn(page, email = 'boss@example.com', password = 'admin-pass') {
  await page.fill('#siEmail', email); await page.fill('#siPass', password); await page.click('#siBtn');
}

test.describe('admin page', () => {
  test('sign in, read new messages (shown as text, never as page code), sort them and delete one', async ({ page }) => {
    const be = backend({ connect: fakeSmtp().connect });
    await seed(be);
    const net = await routeBackend(page, be);
    await page.goto('/admin.html');
    await expect(page.locator('#signin')).toBeVisible();
    await signIn(page, 'boss@example.com', 'wrong');
    await expect(page.locator('#siStatus')).toHaveText('Wrong email or password.');
    await expect(page.locator('#siPass')).toHaveValue('');
    await signIn(page);
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#whoEmail')).toHaveText('boss@example.com');
    await expect(page.locator('#newBadge')).toHaveText('2');
    await expect(page.locator('#mailOffNote')).toBeVisible(); // email isn't set up yet
    const items = page.locator('#list .item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('third@example.com'); // newest first
    await expect(items.nth(1)).toContainText('email failed');
    await items.nth(1).click();
    await expect(page.locator('#dMessage')).toHaveText('<img src=x onerror="window.__pwned=1"> crash when the Titan spawns');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    await expect(page.locator('#dMail')).toContainText('Email failed: Sign-in failed: 535');
    await expect(page.locator('#dSource')).toContainText('Android app');
    await expect(page.locator('#dReply')).toHaveAttribute('href', /^mailto:second@example\.com\?subject=Re%3A%20Your%20Neon%20Tanks%20message/);
    // opening a new message marks it Open
    await expect(page.locator('#detail .seg [data-s="open"]')).toHaveAttribute('aria-pressed', 'true');
    expect(be.rows.find(r => r.email === 'second@example.com').status).toBe('open');
    await expect(page.locator('#newBadge')).toHaveText('1');
    await page.click('#detail .seg [data-s="done"]');
    await expect(page.locator('#detail .seg [data-s="done"]')).toHaveAttribute('aria-pressed', 'true');
    expect(be.rows.find(r => r.email === 'second@example.com').status).toBe('done');
    // the Done filter shows both finished ones
    await page.click('.chip[data-f="done"]');
    await expect(items).toHaveCount(2);
    // delete asks first, in the page
    await items.filter({ hasText: 'first@example.com' }).click();
    await page.click('#dDelete');
    await expect(page.locator('#dConfirm')).toBeVisible();
    await page.click('#dDeleteNo');
    expect(be.rows).toHaveLength(3);
    await page.click('#dDelete'); await page.click('#dDeleteYes');
    await expect(page.locator('#listStatus')).toHaveText('Message deleted.');
    expect(be.rows.map(r => r.email).sort()).toEqual(['second@example.com', 'third@example.com']);
    await expect(items).toHaveCount(1);
    // still signed in after a reload, and a link straight to one message opens it
    const id = be.rows.find(r => r.email === 'third@example.com').id;
    await page.goto(`/admin.html#${id}`);
    await expect(page.locator('#dMessage')).toHaveText('More maps please!\nAnd a snow mode.');
    await page.click('#signOut');
    await expect(page.locator('#signin')).toBeVisible();
    await page.reload();
    await expect(page.locator('#signin')).toBeVisible();
    expect(net.stray).toEqual([]);
  });

  test('an account without the admin flag gets no messages', async ({ page }) => {
    const be = backend({ connect: fakeSmtp().connect });
    await seed(be);
    const net = await routeBackend(page, be);
    await page.goto('/admin.html');
    await signIn(page, 'someone@example.com', 'pw');
    await expect(page.locator('#denied')).toBeVisible();
    await expect(page.locator('#deniedEmail')).toHaveText('someone@example.com');
    expect(net.calls.map(c => c.action)).toEqual(['whoami']);
    await page.click('#deniedOut');
    await expect(page.locator('#signin')).toBeVisible();
  });

  test('email settings: port 465 is fixed, the password is never shown again, and the test email reports back', async ({ page }) => {
    const smtp = fakeSmtp(), be = backend({ connect: smtp.connect });
    const net = await routeBackend(page, be);
    await page.goto('/admin.html#settings');
    await signIn(page);
    await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('.fixed')).toHaveText('465 · SSL/TLS from the start');
    await expect(page.locator('#smPassHint')).toHaveText('No password saved yet.');
    // turning email on without the details
    await page.check('#smEnabled');
    await page.click('#smSave');
    await expect(page.locator('#smStatus')).toHaveText(/check the highlighted fields/i);
    await expect(page.locator('#smHostErr')).toBeVisible(); await expect(page.locator('#smPassErr')).toBeVisible();
    await page.fill('#smHost', 'smtp.gmail.com');
    await page.fill('#smUser', 'support@tanksarenabattle.com');
    await page.fill('#smPass', 'abcd efgh ijkl mnop');
    await page.fill('#smFrom', 'support@tanksarenabattle.com');
    await page.fill('#smFromName', 'Neon Tanks Support');
    await page.fill('#smTo', 'inbox@example.com');
    await page.click('#smTest');
    await expect(page.locator('#smStatus')).toHaveText(/save your changes first/i);
    await page.click('#smSave');
    await expect(page.locator('#smStatus')).toContainText('Saved. New messages will be emailed to you.');
    await expect(page.locator('#smPass')).toHaveValue('');
    await expect(page.locator('#smPass')).toHaveAttribute('placeholder', '•••••••• (saved)');
    expect(be.password).toBe('abcd efgh ijkl mnop');
    expect(be.settings).toMatchObject({ smtp_enabled: true, smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_security: 'ssl' });
    expect(await page.content()).not.toContain('abcd efgh');
    await expect(page.locator('#mailWarn')).toBeHidden();
    await page.click('#smTest');
    await expect(page.locator('#smStatus')).toHaveText('Test email sent to inbox@example.com. Check that inbox (and its spam folder).');
    expect(smtp.sent).toHaveLength(1); expect(smtp.sent[0]).toMatchObject({ host: 'smtp.gmail.com', port: 465 });
    smtp.failAuth = true;
    await page.click('#smTest');
    await expect(page.locator('#smStatus')).toHaveText("The test email didn't go through: Sign-in failed: 535 5.7.8 Username and Password not accepted");
    // after a reload the password is still saved but not sent to the page
    await page.reload();
    await expect(page.locator('#smPassHint')).toContainText('A password is saved');
    const loads = net.calls.filter(c => c.action === 'get_settings');
    expect(loads.length).toBeGreaterThanOrEqual(2);
    expect(await page.content()).not.toContain('abcd efgh');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    test('the list and a message take turns, with a way back', async ({ page }) => {
      const be = backend({ connect: fakeSmtp().connect });
      await seed(be);
      await routeBackend(page, be);
      await page.goto('/admin.html');
      await signIn(page);
      await page.locator('#list .item').first().click();
      await expect(page.locator('#detail')).toBeVisible();
      await expect(page.locator('#list')).toBeHidden();
      await page.click('#back');
      await expect(page.locator('#list')).toBeVisible();
      await expect(page.locator('#detail')).toBeHidden();
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw).toBeLessThanOrEqual(390); // nothing sticks out sideways
    });
  });
});
