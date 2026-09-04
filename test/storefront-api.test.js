const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppServer } = require('../lib/storefront-api');

test('GET /api/products returns storefront products with explicit filters', async (t) => {
  let received;
  const discover = async (options) => {
    received = options;
    return [{ sku: 'abc', name: 'Organizador', price: 39.9 }];
  };
  const server = createAppServer({ discover });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/products?maxPrice=49.99&limit=9&queries=potes,organizador`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(received.queries, ['potes', 'organizador']);
  assert.equal(received.maxPrice, 49.99);
  assert.equal(received.limit, 9);
  assert.equal(body.count, 1);
  assert.equal(body.storefront, 'magazinedescobertaslar');
  assert.deepEqual(body.products, [{ sku: 'abc', name: 'Organizador', price: 39.9 }]);
});

test('GET /api/products rejects a price above the below-R$50 promise', async (t) => {
  const server = createAppServer({ discover: async () => [] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/products?maxPrice=50`);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /49\.99/);
});
