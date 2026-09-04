#!/usr/bin/env node
const path = require('node:path');
const { discoverProducts, STOREFRONT_SLUG } = require('../lib/magalu-storefront');
const { downloadTop9Media } = require('../lib/product-media');
const { DEFAULT_QUERIES } = require('../lib/storefront-api');

async function main() {
  const generatedAt = new Date().toISOString();
  const products = await discoverProducts({
    queries: DEFAULT_QUERIES,
    minPrice: 10,
    maxPrice: 49.99,
    limit: 9,
  });
  const outputDir = path.resolve(
    __dirname,
    '..',
    'media',
    'top9',
    generatedAt.replace(/[:.]/g, '-'),
  );
  const mediaManifest = await downloadTop9Media({ products, outputDir });

  console.log(JSON.stringify({
    storefront: STOREFRONT_SLUG,
    generatedAt,
    count: products.length,
    outputDir,
    products: mediaManifest.products,
  }, null, 2));

  if (products.length < 9) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
