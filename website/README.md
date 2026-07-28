# Scheer 官网

无构建步骤的静态站点，可直接部署到 Cloudflare Workers。

```bash
cd website
npx wrangler dev
npx wrangler deploy
```

页面内容位于 `public/index.html`。部署前可按需修改 `wrangler.toml` 中的 Worker 名称。

页面会按浏览器语言显示简中、英语或西班牙语，也可在导航栏手动切换。运行
`node check-i18n.mjs` 可检查翻译键是否齐全。
