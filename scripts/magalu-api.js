#!/usr/bin/env node
const { createAppServer } = require('../lib/storefront-api');

const port = Number(process.env.PORT ?? 4177);
const server = createAppServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`Magalu storefront API: http://127.0.0.1:${port}/api/products`);
});
