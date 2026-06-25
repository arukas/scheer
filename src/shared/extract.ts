/**
 * 商品采集分发器
 *
 * 按平台把当前页面转换为 CreateProductPayload。
 */

import type { CreateProductPayload, PlatformKey } from './schema';
import { extractShopifyProduct } from './extractors/shopify';
import { extractJsonLdProduct } from './extractors/jsonld';

export async function extractProduct(
  url: string,
  platform: PlatformKey,
  doc: Document
): Promise<CreateProductPayload> {
  switch (platform) {
    case 'shopify':
      return extractShopifyProduct(url);
    case 'shopline':
      return extractJsonLdProduct(url, 'shopline', doc);
    case 'shopbase':
    case 'shoplazza':
    case 'xshoppy':
    case 'newshop':
    case 'tiktok':
      throw new Error(`平台 ${platform} 识别成功，但采集器尚未实现`);
    default:
      throw new Error(`暂不支持平台：${platform}`);
  }
}
