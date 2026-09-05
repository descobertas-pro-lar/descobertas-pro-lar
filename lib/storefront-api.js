const http = require('node:http');
const { discoverProducts, STOREFRONT_SLUG } = require('./magalu-storefront');

const DEFAULT_QUERIES = [
  'gadget cozinha',
  'organizador cozinha criativo',
  'utensilio cozinha eletrico',
  'organizador multifuncional casa',
  'gadget casa inteligente',
  'organizador giratorio cozinha',
  'luminaria led decoracao casa',
  'dispenser automatico banheiro',
  'utilidades domesticas criativas',
];

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function createAppServer({ discover = discoverProducts } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== '/api/products') {
      return sendJson(response, 404, { error: 'Not found' });
    }

    const maxPrice = Number(url.searchParams.get('maxPrice') ?? 99.99);
    const minPrice = Number(url.searchParams.get('minPrice') ?? 10);
    const limit = Number(url.searchParams.get('limit') ?? 9);
    const queries = (url.searchParams.get('queries') ?? DEFAULT_QUERIES.join(','))
      .split(',')
      .map((query) => query.trim())
      .filter(Boolean);

    if (!Number.isFinite(maxPrice) || maxPrice > 99.99 || maxPrice <= 0) {
      return sendJson(response, 400, { error: 'maxPrice must be between 0 and 99.99' });
    }
    if (!Number.isFinite(minPrice) || minPrice < 0 || minPrice > maxPrice) {
      return sendJson(response, 400, { error: 'minPrice must be between 0 and maxPrice' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return sendJson(response, 400, { error: 'limit must be an integer between 1 and 50' });
    }
    if (queries.length === 0) {
      return sendJson(response, 400, { error: 'at least one query is required' });
    }

    try {
      const products = await discover({ queries, minPrice, maxPrice, limit });
      return sendJson(response, 200, {
        storefront: STOREFRONT_SLUG,
        filters: { queries, minPrice, maxPrice, limit },
        count: products.length,
        products,
      });
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  });
}

module.exports = { DEFAULT_QUERIES, createAppServer };
