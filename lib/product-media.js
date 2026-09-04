const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*,video/*,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

function parseNextData(html) {
  const match = String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Product page is missing __NEXT_DATA__');
  return JSON.parse(match[1]);
}

function normalizeMediaUrl(value, width = 800, height = 800) {
  return String(value).replace('{w}', String(width)).replace('{h}', String(height));
}

function extensionFor(url, contentType, fallback) {
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  const typedExtension = byType[String(contentType).split(';')[0].toLowerCase()];
  if (typedExtension) return typedExtension;
  const pathname = new URL(url).pathname;
  const extension = path.extname(pathname).toLowerCase();
  if (/^\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)$/.test(extension)) return extension;
  return fallback;
}

async function saveUrl(url, destinationBase, fetchImpl, fallbackExtension) {
  const response = await fetchImpl(url, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`Media download failed (${response.status}) for ${url}`);
  const extension = extensionFor(url, response.headers.get('content-type'), fallbackExtension);
  const destination = `${destinationBase}${extension}`;
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return destination;
}

function mediaUrl(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.contentUrl || value.url || value.src || value.videoUrl || '';
}

function isDirectVideoUrl(url) {
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);
}

async function downloadWithYtDlp({ url, destinationBase }) {
  const { stdout } = await execFileAsync('yt-dlp', [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--format', 'bv*+ba/b',
    '--output', `${destinationBase}.%(ext)s`,
    '--print', 'after_move:filepath',
    url,
  ], { maxBuffer: 1024 * 1024 });
  const destination = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!destination) throw new Error(`yt-dlp did not return a file path for ${url}`);
  return destination;
}

async function downloadProductMedia({
  product,
  outputDir,
  fetchImpl = fetch,
  videoDownloader = downloadWithYtDlp,
} = {}) {
  if (!product?.url) throw new Error('product.url is required');
  if (!outputDir) throw new Error('outputDir is required');

  const response = await fetchImpl(product.url, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`Product page failed (${response.status}) for ${product.url}`);
  const nextData = parseNextData(await response.text());
  const pageProduct = nextData?.props?.pageProps?.data?.product;
  if (!pageProduct) throw new Error(`Product data not found for ${product.sku || product.url}`);

  await fs.mkdir(outputDir, { recursive: true });
  const imageUrls = [...new Set((pageProduct.media?.images || []).map((url) => normalizeMediaUrl(url)))];
  const images = [];
  const imageErrors = [];
  for (let index = 0; index < imageUrls.length; index += 1) {
    const url = imageUrls[index];
    try {
      images.push(await saveUrl(
        url,
        path.join(outputDir, `image-${String(index + 1).padStart(2, '0')}`),
        fetchImpl,
        '.jpg',
      ));
    } catch (error) {
      imageErrors.push({ url, error: error.message });
    }
  }

  const videos = [];
  const videoErrors = [];
  const videoUrls = [...new Set((pageProduct.media?.videos || []).map(mediaUrl).filter(Boolean))];
  for (let index = 0; index < videoUrls.length; index += 1) {
    const url = videoUrls[index];
    const destinationBase = path.join(outputDir, `video-${String(index + 1).padStart(2, '0')}`);
    try {
      videos.push(isDirectVideoUrl(url)
        ? await saveUrl(url, destinationBase, fetchImpl, '.mp4')
        : await videoDownloader({ url, destinationBase }));
    } catch (error) {
      videoErrors.push({ url, error: error.message });
    }
  }

  return { images, imageErrors, videos, videoErrors };
}

async function downloadTop9Media({
  products,
  outputDir,
  fetchImpl = fetch,
  videoDownloader = downloadWithYtDlp,
} = {}) {
  if (!Array.isArray(products)) throw new Error('products must be an array');
  if (!outputDir) throw new Error('outputDir is required');

  await fs.mkdir(outputDir, { recursive: true });
  const downloadedProducts = [];
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const safeId = String(product.sku || `product-${index + 1}`).replace(/[^a-z0-9_-]+/gi, '-');
    const productDir = path.join(outputDir, `${String(index + 1).padStart(2, '0')}-${safeId}`);
    let media;
    try {
      media = await downloadProductMedia({
        product,
        outputDir: productDir,
        fetchImpl,
        videoDownloader,
      });
    } catch (error) {
      media = {
        images: [],
        imageErrors: [],
        videos: [],
        videoErrors: [],
        error: error.message,
      };
    }
    downloadedProducts.push({ ...product, media });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    count: downloadedProducts.length,
    products: downloadedProducts,
  };
  await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

module.exports = {
  downloadProductMedia,
  downloadTop9Media,
  normalizeMediaUrl,
  parseNextData,
};
