// Fixtures del endpoint Shopify `{handle}.json` con las formas del mundo real
// (research §1.5). Co-locados en core: los parsers son puros ⇒ se importan directo,
// sin msw ni el subpath de fixtures de test-utils (ese llega en T1.4). El shape
// reproduce el contrato público real de Shopify: `product.{title, body_html, vendor,
// product_type, tags, variants:[{price}], images:[{src, alt}]}`.

/** Producto Shopify típico: precio STRING (así lo sirve Shopify), varias variantes,
 *  varias imágenes con alt, body_html con markup. */
export const SHOPIFY_PRODUCT_JSON = {
  product: {
    id: 123456789,
    title: 'Wool Runner - Natural Black',
    handle: 'wool-runner',
    body_html:
      '<p>Our <strong>lightest, most breathable</strong> everyday shoe.</p><ul><li>Merino wool upper</li></ul>',
    vendor: 'Allbirds',
    product_type: 'Shoes',
    tags: ['wool', 'sustainable', 'everyday'],
    // OJO (forma REAL): el `{handle}.json` público de Shopify NO expone la moneda
    // (es shop-level, ausente de este endpoint) ni un `price_currency` per-variant.
    // El fast path deja `currency` en null; obtenerla exigiría un fetch shop-level
    // (fuera de alcance de T1.3). Reproducimos la forma real: solo `price` (string).
    variants: [
      { id: 1, title: 'US 8', price: '110.00', available: true },
      { id: 2, title: 'US 9', price: '110.00', available: true },
      { id: 3, title: 'US 10', price: '110.00', available: false },
    ],
    images: [
      { id: 11, src: 'https://cdn.shopify.com/s/files/wool-runner-1.jpg', alt: 'Side view' },
      { id: 12, src: 'https://cdn.shopify.com/s/files/wool-runner-2.jpg', alt: null },
    ],
  },
};

/** Producto SIN variantes reales: la única variante es el placeholder "Default Title"
 *  de Shopify. El parser NO debe listarlo como variante significativa, pero SÍ debe
 *  tomar su precio (aquí como NUMBER, defensivo — algunas integraciones lo devuelven así). */
export const SHOPIFY_DEFAULT_TITLE_JSON = {
  product: {
    title: 'Single Variant Candle',
    body_html: 'A candle.',
    vendor: 'Waxwork',
    variants: [{ id: 9, title: 'Default Title', price: 24.5 }],
    images: [{ src: 'https://cdn.shopify.com/candle.jpg' }],
  },
};

/** Cuerpo que NO es un producto Shopify (p. ej. una página de error servida como
 *  JSON, o `/products.json` catálogo en vez de `{handle}.json`): sin `product` →
 *  el parser devuelve null (fuente ausente, no error). */
export const SHOPIFY_NOT_A_PRODUCT_JSON = {
  errors: 'Not Found',
};
