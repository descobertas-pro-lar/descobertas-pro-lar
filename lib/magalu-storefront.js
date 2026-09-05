const STOREFRONT_SLUG = 'magazinedescobertaslar';
const STOREFRONT_BASE = `https://www.magazinevoce.com.br/${STOREFRONT_SLUG}/`;

function buildSearchUrl(query, { page = 1 } = {}) {
  const normalized = String(query).trim();
  if (!normalized) throw new Error('query is required');
  const url = new URL(`busca/${encodeURIComponent(normalized)}/`, STOREFRONT_BASE);
  url.searchParams.set('page', String(page));
  url.searchParams.set('sortOrientation', 'desc');
  url.searchParams.set('sortType', 'soldQuantity');
  return url;
}

function parseProductsFromHtml(html, query = '') {
  const products = [];
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html).matchAll(scriptPattern)) {
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    for (const node of nodes) {
      if (node?.['@type'] !== 'Product') continue;
      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      const url = offer?.url;
      if (!url || !url.startsWith(STOREFRONT_BASE)) continue;
      products.push({
        sku: String(node.sku ?? ''),
        name: String(node.name ?? ''),
        brand: typeof node.brand === 'string' ? node.brand : String(node.brand?.name ?? ''),
        price: Number(offer.price),
        image: Array.isArray(node.image) ? node.image[0] : String(node.image ?? ''),
        url,
        rating: Number(node.aggregateRating?.ratingValue ?? 0),
        reviewCount: Number(node.aggregateRating?.reviewCount ?? node.aggregateRating?.ratingCount ?? 0),
        query,
        inStock: String(offer.availability ?? '').toLowerCase().includes('instock'),
      });
    }
  }
  return products;
}

// Products matching these patterns are plain household staples with low
// share/save/comment potential on social media (Reels/TikTok). Hard-excluded
// even if they're cheap, in stock, and well reviewed.
const BORING_PATTERNS = [
  /\bcolher(es)?\b/,
  /\bgarfo(s)?\b/,
  /\bfaca(s)?\b(?!.*\b(eletrica|eletrico|automatica|multiuso|dobravel|retratil)\b)/,
  /\bpano(s)?\s+de\s+prato\b/,
  /\besponja(s)?\b(?!.*\b(magica|eletrica|giratoria)\b)/,
  /\bsaco(s)?\s+de\s+lixo\b/,
  /\bprendedor(es)?\s+de\s+roupa\b(?!.*\b(criativo|formato|divertido)\b)/,
  /\bvassoura(s)?\b(?!.*\b(magica|eletrica|giratoria|automatica)\b)/,
  /\brodo(s)?\b(?!.*\b(eletrico|giratorio|automatico)\b)/,
  /\bbalde(s)?\b(?!.*\b(espremedor|giratorio|automatico)\b)/,
  /\bguardanapo(s)?\b/,
  /\btoalha(s)?\s+de\s+m[ae]o\b/,
  /\bpegador(es)?\s+de\s+macarrao\b/,
];

// Products that fall outside the home/kitchen/organization niche entirely
// (books, toys, apparel, etc). The account is about home gadgets, not general
// merchandise, even if such items show up in a broad storefront search.
const OFF_NICHE_PATTERNS = [
  /\blivro(s)?\b/,
  /\bjogo(s)?\s+(educativo|de tabuleiro|infantil|infantis)\b/,
  /\bbrinquedo(s)?\b/,
  /\bjenga\b/,
  /\bquebra\s*cabeca(s)?\b/,
  /\bcamiseta(s)?\b/,
  /\bboneca(s)?\b/,
];

function isOffNiche(product) {
  const title = normalizedTitle(product);
  return OFF_NICHE_PATTERNS.some((pattern) => pattern.test(title));
}

function isBoring(product) {
  const title = normalizedTitle(product);
  return BORING_PATTERNS.some((pattern) => pattern.test(title));
}

// Words that tend to signal "wow factor" / shareability on social feeds:
// novelty shape, automation, gadget-y mechanisms, visual payoff. Each match
// adds a bonus on top of the rating/review score.
const VIRAL_KEYWORDS = [
  'gadget', 'automatic', 'automatico', 'automatica', 'eletrico', 'eletrica',
  'led', 'usb', 'recarregavel', 'retratil', 'dobravel', 'giratorio', 'giratoria',
  'multifuncional', 'multiuso', 'inteligente', 'sensor', 'dispenser',
  'anti derramamento', 'anti gotejamento', 'articulad', 'expansiv', 'portatil',
  'mini', 'silicone', 'magico', 'magica', '360', 'a vacuo', 'compacto',
  'dobravel', 'ajustavel', 'removivel', 'transparente', 'digital',
];

function viralityBonus(product) {
  const title = normalizedTitle(product);
  let hits = 0;
  for (const keyword of VIRAL_KEYWORDS) {
    if (title.includes(keyword)) hits += 1;
  }
  return Math.min(hits, 4) * 15;
}

function productScore(product) {
  return (product.rating * 20) + (Math.log10(product.reviewCount + 1) * 12) + viralityBonus(product);
}

function normalizedTitle(product) {
  return product.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PRODUCT_FAMILY_PATTERNS = [
  ['food-containers', /\b(pote|potes|porta mantimento|porta mantimentos|marmita|marmitas)\b|\b(recipiente|recipientes|vasilha|vasilhas)\b.*\b(alimento|alimentos|mantimento|mantimentos|comida|cozinha|hermetic[oa]s?)\b|\b(alimento|alimentos|mantimento|mantimentos|comida|cozinha|hermetic[oa]s?)\b.*\b(recipiente|recipientes|vasilha|vasilhas)\b|\b(bowl|bowls|tigela|tigelas)\b.*\b(tampa|hermetic[oa]s?)\b/],
  ['rotating-organizer', /\b(organizador|bandeja)\b.*\bgiratori[oa]s?\b/],
  ['tiered-organizer', /\b(organizador|fruteira)\b.*\b(2|3|dois|tres)\s+andares\b|\bfruteira\b/],
  ['corner-organizer', /\borganizador\b.*\bcanto\b/],
  ['shelf', /\b(estante|prateleira|prateleiras)\b/],
  ['utensils', /\b(utensilio|utensilios|talher|talheres|espatula|concha)\b/],
  ['wall-clock', /\brelogio\b/],
  ['rug', /\btapete\b/],
  ['trash-bin', /\blixeira\b/],
  ['dish-rack', /\bescorredor\b/],
  ['laundry', /\b(varal|cesto de roupa|prendedor de roupa)\b/],
  ['cleaning-tool', /\b(mop|vassoura|rodo|escova de limpeza)\b/],
  ['hanger-hook', /\b(cabide|cabides|gancho|ganchos)\b/],
  ['bottle', /\b(garrafa|squeeze)\b/],
  ['cutting-board', /\btabua\b.*\bcorte\b/],
];

function productFamily(product) {
  const title = normalizedTitle(product);
  const match = PRODUCT_FAMILY_PATTERNS.find(([, pattern]) => pattern.test(title));
  return match ? match[0] : null;
}

async function discoverProducts({
  queries,
  limit = 9,
  minPrice = 10,
  maxPrice = 99.99,
  fetchImpl = fetch,
} = {}) {
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error('queries must be a non-empty array');
  }
  if (!Number.isFinite(maxPrice) || maxPrice > 99.99) {
    throw new Error('maxPrice must not exceed 99.99');
  }

  const batches = [];
  for (const query of queries) {
    const url = buildSearchUrl(query);
    const response = await fetchImpl(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'pt-BR,pt;q=0.9',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`Magalu search failed (${response.status}) for ${query}`);
    batches.push(parseProductsFromHtml(await response.text(), query));
  }

  const candidateBatches = batches.map((batch) => batch
    .filter((product) => (
      product.inStock
      && Number.isFinite(product.price)
      && product.price >= minPrice
      && product.price <= maxPrice
      && !isBoring(product)
      && !isOffNiche(product)
    ))
    .sort((a, b) => productScore(b) - productScore(a) || a.price - b.price));

  const selected = [];
  const usedIds = new Set();
  const usedTitles = new Set();
  const usedFamilies = new Set();
  const cursors = candidateBatches.map(() => 0);
  while (selected.length < limit) {
    let added = false;
    for (let index = 0; index < candidateBatches.length; index += 1) {
      const batch = candidateBatches[index];
      while (cursors[index] < batch.length) {
        const product = batch[cursors[index]];
        cursors[index] += 1;
        const id = product.sku || product.url;
        const title = normalizedTitle(product);
        const family = productFamily(product);
        if (!usedIds.has(id) && !usedTitles.has(title) && (!family || !usedFamilies.has(family))) {
          usedIds.add(id);
          usedTitles.add(title);
          if (family) usedFamilies.add(family);
          selected.push({ ...product, family });
          added = true;
          break;
        }
      }
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
}

module.exports = {
  STOREFRONT_SLUG,
  STOREFRONT_BASE,
  buildSearchUrl,
  parseProductsFromHtml,
  discoverProducts,
};
