/**
 * 上传构建产物到 S3 或 S3 兼容对象存储（如阿里云 OSS、MinIO、Cloudflare R2）。
 *
 * 配置通过环境变量读取：
 * - S3_ENDPOINT: 必填，如 https://oss-cn-hangzhou.aliyuncs.com
 * - S3_REGION: 必填，如 cn-hangzhou
 * - S3_BUCKET: 必填
 * - S3_ACCESS_KEY_ID: 必填
 * - S3_SECRET_ACCESS_KEY: 必填
 * - S3_PATH_PREFIX: 可选，默认 scheer
 * - S3_UPLOAD_DIR: 可选，是否同时上传 dist/chrome-mv3/，true/false，默认 false
 * - S3_FORCE_PATH_STYLE: 可选，MinIO 等需要，true/false，默认 false
 * - S3_PUBLIC_URL: 可选，用于生成公开访问链接，如 https://cdn.example.com
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { readFile } from 'node:fs/promises';

export interface UploadConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  uploadDir: boolean;
  forcePathStyle: boolean;
  publicUrl?: string;
}

export interface UploadResult {
  key: string;
  filePath: string;
  publicUrl?: string;
}

function env(key: string, required = false, defaultValue?: string): string | undefined {
  const value = process.env[key] ?? defaultValue;
  if (required && !value) {
    throw new Error(`缺少必需的环境变量：${key}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): UploadConfig {
  return {
    endpoint: env('S3_ENDPOINT', true)!,
    region: env('S3_REGION', true)!,
    bucket: env('S3_BUCKET', true)!,
    accessKeyId: env('S3_ACCESS_KEY_ID', true)!,
    secretAccessKey: env('S3_SECRET_ACCESS_KEY', true)!,
    prefix: env('S3_PATH_PREFIX', false, 'scheer')!,
    uploadDir: parseBoolean(env('S3_UPLOAD_DIR', false), false),
    forcePathStyle: parseBoolean(env('S3_FORCE_PATH_STYLE', false), false),
    publicUrl: env('S3_PUBLIC_URL', false),
  };
}

function createS3Client(config: UploadConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  });
}

export function findLatestZip(distDir: string): string | null {
  const entries = readdirSync(distDir, { withFileTypes: true });
  const zips = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-chrome.zip'))
    .map((entry) => {
      const path = join(distDir, entry.name);
      return { path, name: entry.name, mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return zips[0]?.path ?? null;
}

export async function getVersion(): Promise<string> {
  const pkgPath = join(process.cwd(), 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
  return pkg.version ?? '0.0.0';
}

export function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, '');
}

export function buildObjectKey(prefix: string, version: string, filename: string): string {
  const normalized = normalizePrefix(prefix);
  return normalized ? `${normalized}/${version}/${filename}` : `${version}/${filename}`;
}

export function buildPublicUrl(publicUrlBase: string | undefined, key: string): string | undefined {
  if (!publicUrlBase) return undefined;
  const base = publicUrlBase.replace(/\/+$/, '');
  return `${base}/${key}`;
}

function getContentType(filePath: string): string {
  const map: Record<string, string> = {
    '.zip': 'application/zip',
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.webmanifest': 'application/manifest+json',
  };
  return map[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string
): Promise<void> {
  const body = createReadStream(filePath);
  const contentType = getContentType(filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

async function uploadDirectory(
  client: S3Client,
  bucket: string,
  prefix: string,
  version: string,
  dirPath: string
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  const normalizedPrefix = normalizePrefix(prefix);

  function walk(currentPath: string): string[] {
    const result: string[] = [];
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        result.push(...walk(fullPath));
      } else {
        result.push(fullPath);
      }
    }
    return result;
  }

  const files = walk(dirPath);
  for (const filePath of files) {
    const relativePath = relative(dirPath, filePath);
    const key = normalizedPrefix
      ? `${normalizedPrefix}/${version}/chrome-mv3/${relativePath}`
      : `${version}/chrome-mv3/${relativePath}`;
    await uploadFile(client, bucket, key, filePath);
    results.push({ key, filePath });
  }

  return results;
}

export async function uploadArtifacts(config?: UploadConfig): Promise<UploadResult[]> {
  const resolvedConfig = config ?? loadConfig();
  const client = createS3Client(resolvedConfig);
  const version = await getVersion();

  const results: UploadResult[] = [];
  const distDir = join(process.cwd(), 'dist');
  const zipPath = findLatestZip(distDir);
  if (!zipPath) {
    throw new Error(`在 ${distDir} 下未找到 *-chrome.zip 文件，请先运行 npm run zip`);
  }

  const zipName = zipPath.split('/').pop()!;
  const zipKey = buildObjectKey(resolvedConfig.prefix, version, zipName);

  console.log(`上传 zip: ${zipPath} -> s3://${resolvedConfig.bucket}/${zipKey}`);
  await uploadFile(client, resolvedConfig.bucket, zipKey, zipPath);
  results.push({
    key: zipKey,
    filePath: zipPath,
    publicUrl: buildPublicUrl(resolvedConfig.publicUrl, zipKey),
  });
  console.log('✓ zip 上传完成');

  if (resolvedConfig.uploadDir) {
    const dirPath = join(distDir, 'chrome-mv3');
    console.log(`上传目录: ${dirPath}`);
    const dirResults = await uploadDirectory(
      client,
      resolvedConfig.bucket,
      resolvedConfig.prefix,
      version,
      dirPath
    );
    for (const result of dirResults) {
      result.publicUrl = buildPublicUrl(resolvedConfig.publicUrl, result.key);
    }
    results.push(...dirResults);
    console.log(`✓ 目录上传完成，共 ${dirResults.length} 个文件`);
  }

  return results;
}

async function main() {
  const results = await uploadArtifacts();

  console.log('\n上传结果：');
  for (const result of results) {
    console.log(`  key: ${result.key}`);
    if (result.publicUrl) {
      console.log(`  url: ${result.publicUrl}`);
    }
  }
}

if (process.argv[1]?.endsWith('upload.ts')) {
  main().catch((err) => {
    console.error('上传失败：', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
