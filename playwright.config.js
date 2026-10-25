import { defineConfig } from '@playwright/test';
// Behind an HTTP proxy (sandboxed CI), map a fake host to the local server and let it bypass the proxy.
const proxy = process.env.HTTPS_PROXY;
const host = proxy ? 'neon.test' : 'localhost';
export default defineConfig({
  testDir: 'tests',
  timeout: 45000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://${host}:8090/`,
    viewport: { width: 1280, height: 720 },
    launchOptions: proxy ? { proxy: { server: proxy, bypass: 'neon.test' }, args: ['--host-resolver-rules=MAP neon.test 127.0.0.1'] } : {},
  },
  webServer: { command: 'python3 -m http.server 8090 --directory public', port: 8090, reuseExistingServer: true, stdout: 'ignore', stderr: 'ignore' },
});
