// ════════════════════════════════════════════════════════════════
// YARAM — Schema.org JSON-LD markup pour cartes Gmail
// ════════════════════════════════════════════════════════════════
//
// Une fois yaram.app whitelist par Google (formulaire Schema.org),
// ces blocs JSON-LD font apparaitre les jolies cartes en haut des
// emails dans Gmail (comme Apple Store, Amazon, etc.) :
//   - "Livraison prévue le dim. 7 juin"
//   - boutons "Afficher la commande" / "Évaluer le magasin"
//
// Avant whitelist, le markup est juste ignoré (no-op safe).
// Apres whitelist (~2-4 semaines après application Google), les
// cartes apparaissent automatiquement.
//
// Doc : https://developers.google.com/gmail/markup/reference/order
// ════════════════════════════════════════════════════════════════

const MERCHANT = {
  '@type': 'Organization',
  name: 'YARAM',
  url: 'https://yaram.app',
};

/**
 * Order confirmation : "Commande #DIA-XXX en cours · Livraison prévue le 7 juin"
 */
export function schemaOrderConfirmation({ orderId, items, total, deliveryDate, customerName }) {
  return {
    '@context': 'http://schema.org',
    '@type': 'Order',
    merchant: MERCHANT,
    orderNumber: orderId,
    orderStatus: 'http://schema.org/OrderProcessing',
    priceCurrency: 'XOF',
    price: String(total),
    acceptedOffer: (items || []).map((it) => ({
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Product',
        name: it.name,
        image: it.img || undefined,
      },
      price: String(it.price || 0),
      priceCurrency: 'XOF',
      eligibleQuantity: {
        '@type': 'QuantitativeValue',
        value: it.qty || 1,
      },
    })),
    url: `https://yaram.app/order/${orderId}`,
    potentialAction: {
      '@type': 'ViewAction',
      target: `https://yaram.app/order/${orderId}`,
      name: 'Suivre ma commande',
    },
    customer: customerName ? { '@type': 'Person', name: customerName } : undefined,
    orderDelivery: deliveryDate ? {
      '@type': 'ParcelDelivery',
      expectedArrivalUntil: deliveryDate,
      carrier: { '@type': 'Organization', name: 'YARAM Livraison' },
    } : undefined,
  };
}

/**
 * Shipping : "Ton livreur en route · ETA 15 min"
 */
export function schemaShippingUpdate({ orderId, livreurName, eta, items }) {
  return {
    '@context': 'http://schema.org',
    '@type': 'ParcelDelivery',
    deliveryAddress: undefined, // ne pas exposer l'adresse dans le payload
    expectedArrivalFrom: eta?.from,
    expectedArrivalUntil: eta?.until,
    carrier: { '@type': 'Organization', name: livreurName || 'YARAM Livraison' },
    itemShipped: (items || []).map((it) => ({
      '@type': 'Product',
      name: it.name,
      image: it.img || undefined,
    })),
    trackingNumber: orderId,
    trackingUrl: `https://yaram.app/order/${orderId}`,
    partOfOrder: {
      '@type': 'Order',
      merchant: MERCHANT,
      orderNumber: orderId,
      orderStatus: 'http://schema.org/OrderInTransit',
    },
    potentialAction: {
      '@type': 'TrackAction',
      target: `https://yaram.app/order/${orderId}`,
      name: 'Suivre en direct',
    },
  };
}

/**
 * Delivered : "Commande livrée · Évalue-nous"
 */
export function schemaDelivered({ orderId, items, total }) {
  return {
    '@context': 'http://schema.org',
    '@type': 'Order',
    merchant: MERCHANT,
    orderNumber: orderId,
    orderStatus: 'http://schema.org/OrderDelivered',
    priceCurrency: 'XOF',
    price: String(total || 0),
    acceptedOffer: (items || []).map((it) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Product', name: it.name, image: it.img || undefined },
      price: String(it.price || 0),
      priceCurrency: 'XOF',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: it.qty || 1 },
    })),
    url: `https://yaram.app/order/${orderId}`,
    potentialAction: [
      { '@type': 'ViewAction', target: `https://yaram.app/order/${orderId}`, name: 'Voir la commande' },
      { '@type': 'ReviewAction', target: `https://yaram.app/order/${orderId}/review`, name: 'Évaluer le magasin' },
    ],
  };
}

/**
 * Helper : wrap un schema JSON-LD dans une balise <script> safe pour HTML email.
 * Insère le résultat dans le <head> du mail compilé par MJML.
 */
export function renderJsonLd(schema) {
  if (!schema) return '';
  // On clean les undefined recursivement pour ne pas polluer le JSON
  const clean = JSON.parse(JSON.stringify(schema));
  const jsonStr = JSON.stringify(clean).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${jsonStr}</script>`;
}
