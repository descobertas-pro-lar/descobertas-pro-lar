const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { downloadProductMedia, downloadTop9Media } = require('../lib/product-media');

function productPage({ images = [], videos = [] }) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { data: { product: { id: 'sku-1', media: { images, videos } } } } },
  })}</script>`;
}

async function startServer(t, routes) {
  const server = http.createServer((request, response) => {
    const route = routes[request.url];
    if (!route) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': route.type });
    response.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('downloadProductMedia saves every product image at high resolution', async (t) => {
  const base = await startServer(t, {
    '/product': { type: 'text/html', body: '' },
    '/800x800/one.jpeg': { type: 'image/jpeg', body: 'image-one' },
    '/800x800/two.png': { type: 'image/png', body: 'image-two' },
  });
  const html = productPage({
    images: [`${base}/{w}x{h}/one.jpeg`, `${base}/{w}x{h}/two.png`],
  });
  const fetchImpl = async (url, options) => {
    if (String(url) === `${base}/product`) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fetch(url, options);
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-media-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadProductMedia({
    product: { sku: 'sku-1', name: 'Produto teste', url: `${base}/product` },
    outputDir,
    fetchImpl,
  });

  assert.equal(result.images.length, 2);
  assert.equal(await fs.readFile(result.images[0], 'utf8'), 'image-one');
  assert.equal(await fs.readFile(result.images[1], 'utf8'), 'image-two');
  assert.match(result.images[0], /image-01\.jpg$/);
});

test('downloadProductMedia names files from the returned content type', async (t) => {
  const base = await startServer(t, {
    '/800x800/photo.jpeg': { type: 'image/webp', body: 'webp-image' },
  });
  const html = productPage({ images: [`${base}/{w}x{h}/photo.jpeg`] });
  const fetchImpl = async (url, options) => {
    if (String(url) === `${base}/product`) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fetch(url, options);
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-media-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadProductMedia({
    product: { sku: 'sku-1', name: 'Produto teste', url: `${base}/product` },
    outputDir,
    fetchImpl,
  });

  assert.match(result.images[0], /image-01\.webp$/);
});

test('downloadProductMedia records unavailable images without aborting the batch', async (t) => {
  const base = await startServer(t, {});
  const blockedUrl = `${base}/{w}x{h}/blocked.jpg`;
  const html = productPage({ images: [blockedUrl] });
  const fetchImpl = async (url) => {
    if (String(url) === `${base}/product`) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('blocked', { status: 403 });
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-media-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadProductMedia({
    product: { sku: 'sku-1', name: 'Produto teste', url: `${base}/product` },
    outputDir,
    fetchImpl,
  });

  assert.deepEqual(result.images, []);
  assert.deepEqual(result.imageErrors, [{
    url: `${base}/800x800/blocked.jpg`,
    error: `Media download failed (403) for ${base}/800x800/blocked.jpg`,
  }]);
});

test('downloadProductMedia saves every available product video', async (t) => {
  const base = await startServer(t, {
    '/video-one.mp4': { type: 'video/mp4', body: 'video-one' },
    '/video-two.webm': { type: 'video/webm', body: 'video-two' },
  });
  const html = productPage({
    videos: [`${base}/video-one.mp4`, { contentUrl: `${base}/video-two.webm` }],
  });
  const fetchImpl = async (url, options) => {
    if (String(url) === `${base}/product`) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fetch(url, options);
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-media-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadProductMedia({
    product: { sku: 'sku-1', name: 'Produto teste', url: `${base}/product` },
    outputDir,
    fetchImpl,
  });

  assert.equal(result.videos.length, 2);
  assert.equal(await fs.readFile(result.videos[0], 'utf8'), 'video-one');
  assert.equal(await fs.readFile(result.videos[1], 'utf8'), 'video-two');
  assert.match(result.videos[1], /video-02\.webm$/);
});

test('downloadProductMedia uses a media extractor for YouTube embeds', async (t) => {
  const base = await startServer(t, {});
  const html = productPage({ videos: ['https://www.youtube.com/embed/video-id'] });
  const fetchImpl = async (url) => {
    if (String(url) === `${base}/product`) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    throw new Error('YouTube embeds must not be saved as HTML');
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-media-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  let extractedUrl;
  const videoDownloader = async ({ url, destinationBase }) => {
    extractedUrl = url;
    const destination = `${destinationBase}.mp4`;
    await fs.writeFile(destination, 'real-video');
    return destination;
  };

  const result = await downloadProductMedia({
    product: { sku: 'sku-1', name: 'Produto teste', url: `${base}/product` },
    outputDir,
    fetchImpl,
    videoDownloader,
  });

  assert.equal(extractedUrl, 'https://www.youtube.com/embed/video-id');
  assert.equal(await fs.readFile(result.videos[0], 'utf8'), 'real-video');
});

test('downloadProductMedia records unavailable videos without aborting the batch', async (t) => {
  const base = await startServer(t, {});
  const blockedUrl = 'https://ugc-magalu-videos.magazineluiza.com.br/embed/blocked';
  const html = productPage({ videos: [blockedUrl] });
  const fetchImpl = async (url) => {
    if (String(url) === `${base}/product`) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    throw new Error('unexpected direct fetch');
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-media-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadProductMedia({
    product: { sku: 'sku-1', name: 'Produto teste', url: `${base}/product` },
    outputDir,
    fetchImpl,
    videoDownloader: async () => { throw new Error('unsupported video host'); },
  });

  assert.deepEqual(result.videos, []);
  assert.deepEqual(result.videoErrors, [{ url: blockedUrl, error: 'unsupported video host' }]);
});

test('downloadTop9Media creates one folder per product and writes a manifest', async (t) => {
  const base = await startServer(t, {
    '/800x800/one.jpg': { type: 'image/jpeg', body: 'one' },
    '/800x800/two.jpg': { type: 'image/jpeg', body: 'two' },
  });
  const pages = {
    [`${base}/product-1`]: productPage({ images: [`${base}/{w}x{h}/one.jpg`] }),
    [`${base}/product-2`]: productPage({ images: [`${base}/{w}x{h}/two.jpg`] }),
  };
  const fetchImpl = async (url, options) => {
    if (pages[String(url)]) {
      return new Response(pages[String(url)], { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fetch(url, options);
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-batch-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadTop9Media({
    products: [
      { sku: 'sku-1', name: 'Primeiro produto', url: `${base}/product-1` },
      { sku: 'sku-2', name: 'Segundo produto', url: `${base}/product-2` },
    ],
    outputDir,
    fetchImpl,
  });

  assert.equal(result.products.length, 2);
  assert.match(result.products[0].media.images[0], /01-sku-1\/image-01\.jpg$/);
  assert.match(result.products[1].media.images[0], /02-sku-2\/image-01\.jpg$/);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.products.length, 2);
});

test('downloadTop9Media writes a complete manifest when a product page fails', async (t) => {
  const base = await startServer(t, {
    '/800x800/good.jpg': { type: 'image/jpeg', body: 'good' },
  });
  const goodPage = productPage({ images: [`${base}/{w}x{h}/good.jpg`] });
  const fetchImpl = async (url, options) => {
    if (String(url) === `${base}/broken`) return new Response('blocked', { status: 403 });
    if (String(url) === `${base}/good`) {
      return new Response(goodPage, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return fetch(url, options);
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'top9-batch-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await downloadTop9Media({
    products: [
      { sku: 'broken', name: 'Produto bloqueado', url: `${base}/broken` },
      { sku: 'good', name: 'Produto válido', url: `${base}/good` },
    ],
    outputDir,
    fetchImpl,
  });

  assert.equal(result.products.length, 2);
  assert.match(result.products[0].media.error, /Product page failed \(403\)/);
  assert.equal(result.products[1].media.images.length, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.products.length, 2);
});
