/**
 * 构建包装脚本。
 *
 * 默认行为与 `wxt build` 一致。
 * 当环境变量 S3_AUTO_UPLOAD=true 时，构建完成后会自动 zip 并上传产物到 S3/OSS，
 * 最后打印公开访问链接（需配置 S3_PUBLIC_URL）。
 */

import { execSync } from 'node:child_process';
import { uploadArtifacts } from './upload.js';

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  return value.toLowerCase() === 'true' || value === '1';
}

function run(command: string): void {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit' });
}

async function main() {
  run('wxt build');

  const autoUpload = parseBoolean(process.env.S3_AUTO_UPLOAD);
  if (!autoUpload) {
    console.log('\n构建完成。未开启 S3_AUTO_UPLOAD，跳过上传。');
    return;
  }

  run('wxt zip');
  const results = await uploadArtifacts();

  console.log('\n构建并上传完成：');
  for (const result of results) {
    console.log(`  key: ${result.key}`);
    if (result.publicUrl) {
      console.log(`  url: ${result.publicUrl}`);
    }
  }
}

main().catch((err) => {
  console.error('\n构建失败：', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
