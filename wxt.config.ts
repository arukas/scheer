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
  return `${year}${month}${day}-${hour}${minute}`;
}

const baseVersion = pkg.version;
const versionName = `${baseVersion}-${getGitHash()}-${formatBuildTime()}`;

// 固定 Extension ID 用的 manifest key（公钥 base64，见 docs/development.md）。
// 通过环境变量注入（npm run build 会加载 .env.local）；未配置时保持现状构建，ID 不固定。
const extensionKey = process.env.SCHEER_EXTENSION_KEY;

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  outDir: 'dist',
  manifest: ({ browser }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    version: baseVersion,
    version_name: versionName,
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions: ['https://*/*'],
    // 以下为 Chrome 专属（外部配置导入功能不支持 Firefox）：
    // - 只暴露 bridge.html 给任意 HTTP/HTTPS 页面（详见 Chrome_Extension_Import_Integration_Guide.md）
    // - manifest key 用于固定 Extension ID
    ...(browser !== 'firefox'
      ? {
          web_accessible_resources: [
            {
              resources: ['bridge.html'],
              matches: ['http://*/*', 'https://*/*'],
            },
          ],
          ...(extensionKey ? { key: extensionKey } : {}),
        }
      : {}),
  }),
  runner: {
    // 开发时启动 Chromium，默认开启扩展页
    startUrls: ['https://example.com'],
  },
  vite: () => ({
    plugins: [viteTsconfigPaths()],
    build: {
      // 关闭 modulepreload 提示：MV3 扩展页面中的 <link rel="modulepreload">
      // 会被 Chrome 以 "cross-world extension resource mismatch" 拒绝并打出警告，
      // 预加载本就用不上，关掉即可消除警告。
      modulePreload: false,
    },
  }),
});
