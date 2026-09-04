const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STOREFRONT_BASE,
  buildSearchUrl,
  parseProductsFromHtml,
  discoverProducts,
} = require('../lib/magalu-storefront');

test('buildSearchUrl keeps every search inside Gui storefront', () => {
  const url = buildSearchUrl('potes herméticos', { page: 2 });
  assert.ok(url.href.startsWith(STOREFRONT_BASE));
  assert.match(url.pathname, /\/magazinedescobertaslar\/busca\/potes%20herm%C3%A9ticos\//);
  assert.equal(url.searchParams.get('page'), '2');
});

test('parseProductsFromHtml reads product JSON-LD and rejects products outside storefront', () => {
  const html = `
    <script type="application/ld+json" data-testid="jsonld-script">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Product","name":"Organizador de pia","image":"https://img/1.jpeg","brand":"Casa","sku":"abc","aggregateRating":{"ratingValue":"4.8","reviewCount":"120"},"offers":{"price":"39.90","priceCurrency":"BRL","availability":"http://schema.org/InStock","url":"https://www.magazinevoce.com.br/magazinedescobertaslar/organizador-de-pia/p/abc/ud/udpi/"}},
        {"@type":"Product","name":"Link genérico","image":"https://img/2.jpeg","sku":"bad","offers":{"price":"20.00","priceCurrency":"BRL","availability":"http://schema.org/InStock","url":"https://www.magazineluiza.com.br/link-generico/p/bad/"}}
      ]}
    </script>`;

  const products = parseProductsFromHtml(html, 'organizador');
  assert.equal(products.length, 1);
  assert.deepEqual(products[0], {
    sku: 'abc',
    name: 'Organizador de pia',
    brand: 'Casa',
    price: 39.9,
    image: 'https://img/1.jpeg',
    url: 'https://www.magazinevoce.com.br/magazinedescobertaslar/organizador-de-pia/p/abc/ud/udpi/',
    rating: 4.8,
    reviewCount: 120,
    query: 'organizador',
    inStock: true,
  });
});

function productHtml(products) {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': products.map((product) => ({
      '@type': 'Product',
      name: product.name,
      image: `https://img/${product.sku}.jpeg`,
      brand: 'Casa',
      sku: product.sku,
      aggregateRating: product.rating ? {
        ratingValue: String(product.rating),
        reviewCount: String(product.reviewCount),
      } : undefined,
      offers: {
        price: String(product.price),
        priceCurrency: 'BRL',
        availability: 'http://schema.org/InStock',
        url: `${STOREFRONT_BASE}${product.sku}/p/${product.sku}/ud/test/`,
      },
    })),
  })}</script>`;
}

test('discoverProducts filters, deduplicates and ranks affordable storefront products', async () => {
  const requested = [];
  const pages = {
    potes: productHtml([
      { sku: 'popular', name: 'Potes herméticos', price: 39.9, rating: 4.8, reviewCount: 120 },
      { sku: 'expensive', name: 'Kit caro', price: 55, rating: 5, reviewCount: 999 },
    ]),
    organizador: productHtml([
      { sku: 'popular', name: 'Potes herméticos duplicado', price: 39.9, rating: 4.8, reviewCount: 120 },
      { sku: 'useful', name: 'Organizador de pia', price: 29.9, rating: 4.2, reviewCount: 8 },
      { sku: 'junk', name: 'Parafuso avulso', price: 0.5, rating: 5, reviewCount: 1000 },
    ]),
  };
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const query = decodeURIComponent(new URL(url).pathname.split('/busca/')[1].split('/')[0]);
    return { ok: true, status: 200, text: async () => pages[query] };
  };

  const products = await discoverProducts({
    queries: ['potes', 'organizador'],
    limit: 2,
    minPrice: 10,
    maxPrice: 49.99,
    fetchImpl,
  });

  assert.equal(products.length, 2);
  assert.deepEqual(products.map((product) => product.sku), ['popular', 'useful']);
  assert.ok(requested.every((url) => url.startsWith(STOREFRONT_BASE)));
});

test('discoverProducts requests Magalu sequentially to avoid storefront rate limits', async () => {
  let active = 0;
  let peak = 0;
  const fetchImpl = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true, status: 200, text: async () => productHtml([]) };
  };

  await discoverProducts({ queries: ['potes', 'cozinha', 'banheiro'], fetchImpl });
  assert.equal(peak, 1);
});

test('discoverProducts fills results across queries before repeating a category', async () => {
  const pages = {
    potes: productHtml([
      { sku: 'pot-1', name: 'Potes top', price: 39.9, rating: 5, reviewCount: 1000 },
      { sku: 'pot-2', name: 'Potes segundo', price: 39.9, rating: 4.9, reviewCount: 900 },
    ]),
    banheiro: productHtml([
      { sku: 'bath-1', name: 'Organizador banheiro', price: 29.9, rating: 4, reviewCount: 10 },
    ]),
  };
  const fetchImpl = async (url) => {
    const query = decodeURIComponent(new URL(url).pathname.split('/busca/')[1].split('/')[0]);
    return { ok: true, status: 200, text: async () => pages[query] };
  };

  const products = await discoverProducts({ queries: ['potes', 'banheiro'], limit: 2, fetchImpl });
  assert.deepEqual(products.map((product) => product.sku), ['pot-1', 'bath-1']);
});

test('discoverProducts removes duplicate listings with the same normalized title', async () => {
  const html = productHtml([
    { sku: 'one', name: 'Conjunto 5 Potes Vidro Hermético', price: 47.92, rating: 4.7, reviewCount: 3000 },
    { sku: 'two', name: 'Conjunto 5 Potes Vidro Hermetico', price: 46.9, rating: 4.7, reviewCount: 3000 },
  ]);
  const products = await discoverProducts({
    queries: ['potes'],
    limit: 9,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }),
  });
  assert.equal(products.length, 1);
});

test('discoverProducts defaults to a strict below-R$50 ceiling', async () => {
  const html = productHtml([
    { sku: 'edge-50', name: 'Tapete de R$50', price: 50, rating: 5, reviewCount: 1000 },
    { sku: 'under-50', name: 'Lixeira de R$49,99', price: 49.99, rating: 4.5, reviewCount: 100 },
  ]);
  const products = await discoverProducts({
    queries: ['casa'],
    limit: 9,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }),
  });
  assert.deepEqual(products.map((product) => product.sku), ['under-50']);
});

test('discoverProducts rejects an explicit price ceiling above R$49,99', async () => {
  await assert.rejects(
    discoverProducts({ queries: ['casa'], maxPrice: 50, fetchImpl: async () => ({ ok: true }) }),
    /maxPrice must not exceed 49\.99/,
  );
});

test('discoverProducts replaces a repeated product family with a different product type', async () => {
  const pages = {
    potes: productHtml([
      { sku: 'pot-1', name: 'Jogo 4 Potes de Vidro Hermético 640ml', price: 47.92, rating: 4.8, reviewCount: 4000 },
    ]),
    utilidades: productHtml([
      { sku: 'pot-2', name: 'Jogo 6 Potes Redondos de Vidro 180ml', price: 33.22, rating: 4.9, reviewCount: 2000 },
      { sku: 'bowl-1', name: 'Conjunto de Bowls com Tampa Hermética', price: 39.9, rating: 4.8, reviewCount: 1000 },
      { sku: 'tapete-1', name: 'Tapete Antiderrapante para Cozinha', price: 29.9, rating: 4.6, reviewCount: 500 },
    ]),
  };
  const fetchImpl = async (url) => {
    const query = decodeURIComponent(new URL(url).pathname.split('/busca/')[1].split('/')[0]);
    return { ok: true, status: 200, text: async () => pages[query] };
  };

  const products = await discoverProducts({
    queries: ['potes', 'utilidades'],
    limit: 2,
    fetchImpl,
  });

  assert.deepEqual(products.map((product) => product.sku), ['pot-1', 'tapete-1']);
});

test('discoverProducts treats food-container synonyms as the same family', async () => {
  const pages = {
    recipientes: productHtml([
      { sku: 'container-1', name: 'Kit Recipientes Herméticos para Alimentos', price: 39.9, rating: 4.9, reviewCount: 1000 },
    ]),
    utilidades: productHtml([
      { sku: 'container-2', name: 'Conjunto Vasilhas para Mantimentos', price: 34.9, rating: 4.8, reviewCount: 800 },
      { sku: 'tapete-1', name: 'Tapete Antiderrapante para Cozinha', price: 29.9, rating: 4.6, reviewCount: 500 },
    ]),
  };
  const fetchImpl = async (url) => {
    const query = decodeURIComponent(new URL(url).pathname.split('/busca/')[1].split('/')[0]);
    return { ok: true, status: 200, text: async () => pages[query] };
  };

  const products = await discoverProducts({
    queries: ['recipientes', 'utilidades'],
    limit: 2,
    fetchImpl,
  });

  assert.deepEqual(products.map((product) => product.sku), ['container-1', 'tapete-1']);
});

test('discoverProducts does not merge unrelated products with generic opening words', async () => {
  const pages = {
    vasos: productHtml([
      { sku: 'vaso-1', name: 'Conjunto Decorativo para Mesa com Vasos', price: 39.9, rating: 4.8, reviewCount: 500 },
    ]),
    retratos: productHtml([
      { sku: 'retrato-1', name: 'Conjunto Decorativo para Mesa com Porta-Retratos', price: 34.9, rating: 4.7, reviewCount: 400 },
    ]),
  };
  const fetchImpl = async (url) => {
    const query = decodeURIComponent(new URL(url).pathname.split('/busca/')[1].split('/')[0]);
    return { ok: true, status: 200, text: async () => pages[query] };
  };

  const products = await discoverProducts({
    queries: ['vasos', 'retratos'],
    limit: 2,
    fetchImpl,
  });

  assert.deepEqual(products.map((product) => product.sku), ['vaso-1', 'retrato-1']);
});

test('discoverProducts does not treat every recipiente or vasilha as food storage', async () => {
  const pages = {
    potes: productHtml([
      { sku: 'food-1', name: 'Kit Potes Herméticos para Alimentos', price: 39.9, rating: 4.8, reviewCount: 500 },
    ]),
    jardim: productHtml([
      { sku: 'plant-1', name: 'Vasilha Decorativa para Plantas e Jardim', price: 34.9, rating: 4.7, reviewCount: 400 },
    ]),
  };
  const fetchImpl = async (url) => {
    const query = decodeURIComponent(new URL(url).pathname.split('/busca/')[1].split('/')[0]);
    return { ok: true, status: 200, text: async () => pages[query] };
  };

  const products = await discoverProducts({
    queries: ['potes', 'jardim'],
    limit: 2,
    fetchImpl,
  });

  assert.deepEqual(products.map((product) => product.sku), ['food-1', 'plant-1']);
});
