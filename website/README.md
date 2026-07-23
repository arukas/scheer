# Scheer 官网

无构建步骤的静态站点，可直接部署到 Cloudflare Workers。

```bash
cd website
npx wrangler dev
npx wrangler deploy
```

页面内容位于 `public/index.html`。部署前可按需修改 `wrangler.toml` 中的 Worker 名称。
