/**
 * 商品采集分发器
 *
 * 按平台把当前页面转换为 CreateProductPayload。
 */

import { createLogger } from './logger';
import type { CreateProductPayload, PlatformKey } from './schema';
import { extractShopifyProduct } from './extractors/shopify';
import { extractShoplineProduct } from './extractors/shopline';
import { extractNewshopProduct } from './extractors/newshop';
import { extractJsonLdProduct } from './extractors/jsonld';

const log = createLogger('shared/extract');

export async function extractProduct(
  url: string,
  platform: PlatformKey,
  doc: Document
): Promise<CreateProductPayload> {
  switch (platform) {
    case 'shopify':
      return extractShopifyProduct(url);
    case 'shopline':
      try {
        return await extractShoplineProduct(url);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.warn('ShopLine API 采集失败，回退到 JSON-LD', { error });
        return extractJsonLdProduct(url, 'shopline', doc);
      }
    case 'newshop':
      return extractNewshopProduct(url);
    case 'shopbase':
    case 'shoplazza':
    case 'xshoppy':
    case 'tiktok':
    case 'wordpress':
    case 'shadowshop':
      throw new Error(`平台 ${platform} 识别成功，但采集器尚未实现`);
    default:
      throw new Error(`暂不支持平台：${platform}`);
  }
}
