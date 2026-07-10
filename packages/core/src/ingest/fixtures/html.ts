// Fixtures de HTML con JSON-LD y OpenGraph en las formas CAÓTICAS del mundo real
// (HEADLINE 2 del brief). Co-locados en core. Cada constante documenta la variante
// messy que ejercita.

/** JSON-LD "limpio-ish": un único bloque con `Product`, `offers` OBJETO, `price`
 *  NUMBER, `image` ARRAY de strings, `brand` OBJETO `{name}`, `aggregateRating`. */
export const HTML_JSONLD_SIMPLE = `<!doctype html>
<html><head>
<title>Ceramic Mug</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Handmade Ceramic Mug",
  "description": "A cozy 350ml stoneware mug.",
  "brand": { "@type": "Brand", "name": "ClayCo" },
  "image": ["https://img.example/mug-a.jpg", "https://img.example/mug-b.jpg"],
  "offers": { "@type": "Offer", "price": 28, "priceCurrency": "EUR", "availability": "https://schema.org/InStock" },
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.7", "reviewCount": "213" }
}
</script>
</head><body><h1>Handmade Ceramic Mug</h1></body></html>`;

/** El caso MESSY del brief a la vez:
 *  - VARIOS bloques ld+json (BreadcrumbList + Organization + Product): elegir el Product.
 *  - `@graph` array-wrapping: el Product anidado en `{"@graph":[...]}`.
 *  - `offers` como ARRAY de ofertas; `price` como STRING ("29.99").
 *  - `image` como STRING ÚNICA.
 *  - `@type` como ARRAY (`["Product","IndividualProduct"]`).
 *  - `brand` como STRING. */
export const HTML_JSONLD_GRAPH_MESSY = `<!doctype html>
<html><head>
<title>Trail Backpack</title>
<script type="application/ld+json">
{ "@context":"https://schema.org", "@type":"BreadcrumbList",
  "itemListElement":[{"@type":"ListItem","position":1,"name":"Home"}] }
</script>
<script type='application/ld+json'>
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "name": "OutdoorCo", "url": "https://outdoor.example" },
    {
      "@type": ["Product", "IndividualProduct"],
      "name": "Trail Backpack 30L",
      "description": "Weatherproof daypack.",
      "brand": "OutdoorCo",
      "image": "https://img.example/backpack.jpg",
      "offers": [
        { "@type": "Offer", "price": "29.99", "priceCurrency": "USD" },
        { "@type": "Offer", "price": "34.99", "priceCurrency": "CAD" }
      ]
    }
  ]
}
</script>
</head><body></body></html>`;

/** JSON-LD con `image` como OBJETO `ImageObject` (`{url}`) y como array de objetos;
 *  `offers` con `price` ausente pero `lowPrice` presente (AggregateOffer-ish). Verifica
 *  que el parser extrae imágenes-objeto y cae a lowPrice. */
export const HTML_JSONLD_IMAGE_OBJECT = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"Product",
  "name":"Studio Lamp",
  "image":[{"@type":"ImageObject","url":"https://img.example/lamp-1.jpg","caption":"Front"},{"@type":"ImageObject","contentUrl":"https://img.example/lamp-2.jpg"}],
  "offers":{"@type":"AggregateOffer","lowPrice":"59.00","priceCurrency":"GBP"}
}
</script>
</head><body></body></html>`;

/** Página con un bloque ld+json MALFORMADO (JSON roto) seguido de uno válido: el
 *  parser ignora el roto y usa el bueno, sin abortar (HEADLINE 1). */
export const HTML_JSONLD_ONE_BLOCK_BROKEN = `<!doctype html>
<html><head>
<script type="application/ld+json">{ this is not valid json ,,, }</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Resilient Widget","offers":{"price":"9.99","priceCurrency":"USD"},"image":"https://img.example/widget.jpg"}
</script>
</head><body></body></html>`;

/** Página SOLO OpenGraph (sin JSON-LD): og:title, og:description, VARIAS og:image,
 *  y `product:price:amount` + `product:price:currency` presentes. */
export const HTML_OG_WITH_PRICE = `<!doctype html>
<html><head>
<meta property="og:title" content="Linen Shirt &amp; Co." />
<meta property="og:description" content="Breathable summer linen." />
<meta property="og:image" content="https://img.example/shirt-1.jpg" />
<meta property="og:image" content="https://img.example/shirt-2.jpg" />
<meta property="product:price:amount" content="49.90" />
<meta property="product:price:currency" content="EUR" />
</head><body></body></html>`;

/** Página SOLO OpenGraph SIN precio (el caso del brief: `product:price:amount`
 *  ausente, solo og:title/og:image). El parser devuelve título+imagen, price null. */
export const HTML_OG_NO_PRICE = `<!doctype html>
<html><head>
<meta name="og:title" content="Minimal Notebook">
<meta property="og:image" content="https://img.example/notebook.jpg">
</head><body></body></html>`;

/** Página con AMBOS JSON-LD y OG (para verificar precedencia JSON-LD > OG en el
 *  merge): el título/precio del JSON-LD deben ganar al de OG. */
export const HTML_JSONLD_AND_OG = `<!doctype html>
<html><head>
<meta property="og:title" content="OG Title (should lose)">
<meta property="og:image" content="https://img.example/og-only.jpg">
<meta property="product:price:amount" content="99.00">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"JSON-LD Title (should win)","offers":{"price":"12.00","priceCurrency":"USD"},"image":"https://img.example/jsonld.jpg"}
</script>
</head><body></body></html>`;

/** Página sin NINGUNA señal estructurada (ni JSON-LD Product, ni OG útil): ambos
 *  parsers devuelven null. El fast path debe producir un RawContent válido escaso. */
export const HTML_NO_SIGNAL = `<!doctype html>
<html><head><title>Plain page</title></head>
<body><p>Just some text, no structured data.</p></body></html>`;

/** FIX 2 — OpenGraph con un `>` DENTRO del valor entrecomillado del content
 *  (`Before > After`), HTML válido y común. El regex de <meta> debe tolerarlo y no
 *  tirar title/description/image en silencio. */
export const HTML_OG_GT_IN_CONTENT = `<!doctype html>
<html><head>
<meta property="og:title" content="Speed: Before > After transformation" />
<meta property="og:description" content="Compare 10 > 5 minutes with our tool." />
<meta property="og:image" content="https://img.example/before-after.jpg" />
<meta property="product:price:amount" content="19.00" />
</head><body></body></html>`;

/** FIX 3 — el Product NO está en la raíz ni en @graph, sino bajo
 *  `WebPage.mainEntity` (patrón SEO muy común). El parser debe descender a
 *  mainEntity para encontrarlo. */
export const HTML_JSONLD_MAINENTITY = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Product page",
  "mainEntity": {
    "@type": "Product",
    "name": "Nested Desk Lamp",
    "offers": { "@type": "Offer", "price": "42.00", "priceCurrency": "USD" },
    "image": "https://img.example/desk-lamp.jpg"
  }
}
</script>
</head><body></body></html>`;

/** FIX 3 (variante) — el Product envuelto en `itemListElement[].item` de un
 *  ItemList. El parser debe descender a cada `item`. */
export const HTML_JSONLD_ITEMLIST_ITEM = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "item": {
      "@type": "Product",
      "name": "Listed Kettle",
      "offers": { "@type": "Offer", "price": "35.50", "priceCurrency": "GBP" }
    } }
  ]
}
</script>
</head><body></body></html>`;

/** FIX 4 — el precio vive en `offers.priceSpecification.price` (shape documentado por
 *  Google/schema.org), no en `offers.price` directo. El parser debe caer a él. */
export const HTML_JSONLD_PRICESPEC = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Spec-Priced Blender",
  "offers": {
    "@type": "Offer",
    "priceSpecification": {
      "@type": "UnitPriceSpecification",
      "price": "79.99",
      "priceCurrency": "USD"
    }
  },
  "image": "https://img.example/blender.jpg"
}
</script>
</head><body></body></html>`;
