import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'wxt';
import viteTsconfigPaths from 'vite-tsconfig-paths';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

function getGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function formatBuildTime(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

const baseVersion = pkg.version;
const versionName = `${baseVersion}-${getGitHash()}-${formatBuildTime()}`;

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  outDir: 'dist',
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    version: baseVersion,
    version_name: versionName,
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions: ['https://*/*'],
  },
  runner: {
    // 开发时启动 Chromium，默认开启扩展页
    startUrls: ['https://example.com'],
  },
  vite: () => ({
    plugins: [viteTsconfigPaths()],
  }),
});
