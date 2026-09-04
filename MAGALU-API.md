# Magalu Storefront Product API

Local, read-only product discovery for **Gui's affiliate storefront only**:

`https://www.magazinevoce.com.br/magazinedescobertaslar/`

It never converts product links to the generic Magalu domain. Results are filtered to in-stock products between R$10 and R$49.99, deduplicated and diversified across home-related searches.

## Find the current Top 9

```bash
cd ~/descobertas-bio
npm run magalu:find
```

The command returns JSON with nine products, including:

- name, brand, and product family
- current price
- rating and review count
- affiliate-store URL
- search category that found it
- downloaded image and video paths

Each run creates `media/top9/<timestamp>/` with one folder per product and a `manifest.json`. It downloads every gallery image at 800×800 and uses `yt-dlp` plus FFmpeg for supported videos. Inaccessible files are recorded under `imageErrors` or `videoErrors`, and product-page failures under `media.error`, without aborting the remaining batch.

Selection enforces one item per recognized semantic product family. Different SKUs or titles do not count as diverse when they are functionally the same known type, such as `potes` and food-context `recipientes`/`vasilhas` mapping to food containers. Unclassified products are not merged from generic opening words; they require the final name-and-image review described in the skill.

It exits with an error if fewer than nine qualifying products are found.

## Start the local API

```bash
cd ~/descobertas-bio
npm run magalu:api
```

Default endpoint:

`http://127.0.0.1:4177/api/products`

Example:

```bash
curl 'http://127.0.0.1:4177/api/products?limit=9&maxPrice=49.99&queries=potes,organizador%20cozinha,organizador%20banheiro'
```

Parameters:

- `limit`: 1–50, default 9
- `minPrice`: default 10
- `maxPrice`: maximum 49.99; higher values are rejected
- `queries`: comma-separated storefront searches

## Tests

```bash
npm test
```

Coverage includes:

- storefront-only URL enforcement
- JSON-LD product extraction
- price and stock filtering
- duplicate removal by SKU and normalized title
- semantic product-family diversity, including different titles for the same functional type
- search-category diversification
- sequential requests to avoid Magalu's 429 rate limit
- image and supported-video downloads with manifest output
- API validation and responses

## Operational note

This uses Magalu's public storefront pages, not an official affiliate API. The searches run sequentially because parallel requests triggered HTTP 429 during live testing. If Magalu changes its page markup, update the JSON-LD parser and its tests before changing the live workflow.
