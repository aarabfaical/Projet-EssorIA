// ---------- Conversion de devise (affichage + paiement PayPal) ----------
//
// Principe : tous les prix de base restent en USD (source unique de verite dans
// pricing.json / site-pricing.json). Pour l'affichage, on convertit en devise locale
// du visiteur UNIQUEMENT si cette devise est acceptee par PayPal ET si le taux de
// change est disponible. Sinon, on affiche et on facture en USD sans conversion.
//
// Le paiement PayPal reel utilise TOUJOURS le meme calcul que l'affichage (une seule
// source de verite cote serveur), pour eviter tout ecart entre le prix montre au
// visiteur et le montant reellement facture.

// Devises actuellement acceptees par les comptes marchands PayPal (liste courante et
// stable a la redaction de ce fichier). A revalider dans le Dashboard PayPal si de
// nouvelles devises sont necessaires : https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/
const PAYPAL_SUPPORTED_CURRENCIES = new Set([
  'AUD', 'CAD', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY',
  'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD',
  'SEK', 'CHF', 'THB', 'USD',
]);

// Association pays (code ISO 3166-1 alpha-2, tel que renvoye par ipapi.co) -> devise locale.
// Tout pays absent de cette liste, ou dont la devise n'est pas dans la liste PayPal
// ci-dessus, reste facture/affiche en USD sans conversion.
const COUNTRY_TO_CURRENCY = {
  // Zone euro (+ pays lies a l'euro)
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR', FR: 'EUR',
  DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR',
  MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR',
  AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR', ME: 'EUR', XK: 'EUR',
  // Autres devises PayPal
  GB: 'GBP', CH: 'CHF', LI: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', HK: 'HKD', SG: 'SGD', MY: 'MYR', TH: 'THB', PH: 'PHP',
  TW: 'TWD', IL: 'ILS', MX: 'MXN', NO: 'NOK', SE: 'SEK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF',
};

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const RATES_TTL_MS = 6 * 60 * 60 * 1000; // 6h : suffisant pour des prix affiches, evite de spammer l'API gratuite.

let ratesCache = { rates: null, fetchedAt: 0 };

async function getRates() {
  const now = Date.now();
  if (ratesCache.rates && (now - ratesCache.fetchedAt) < RATES_TTL_MS) {
    return ratesCache.rates;
  }
  try {
    const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Reponse HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.rates) throw new Error('Reponse taux de change invalide');
    ratesCache = { rates: data.rates, fetchedAt: now };
    return data.rates;
  } catch (err) {
    console.error('Erreur recuperation taux de change (fallback USD):', err.message);
    // On garde un cache perime plutot que rien, si disponible ; sinon null (= pas de conversion).
    return ratesCache.rates || null;
  }
}

// Determine la devise locale d'un pays, uniquement si elle est utilisable pour le
// paiement PayPal. Retourne null si le pays est inconnu ou si sa devise n'est pas
// supportee (dans ce cas l'appelant doit rester en USD).
function resolveLocalCurrency(countryCode) {
  const code = (countryCode || '').toUpperCase();
  const currency = COUNTRY_TO_CURRENCY[code];
  if (!currency) return null;
  if (!PAYPAL_SUPPORTED_CURRENCIES.has(currency)) return null;
  return currency;
}

// Convertit un objet de montants USD (ex: { starter: 490, growth: 990 }) vers la devise
// locale si possible. Retourne toujours une forme homogene :
// { currency, symbol, symbolPosition, converted, amounts }
async function convertAmounts(usdAmounts, countryCode) {
  const localCurrency = resolveLocalCurrency(countryCode);

  if (!localCurrency || localCurrency === 'USD') {
    return { currency: 'USD', symbol: '$', symbolPosition: 'before', converted: false, amounts: usdAmounts };
  }

  const rates = await getRates();
  const rate = rates && typeof rates[localCurrency] === 'number' ? rates[localCurrency] : null;

  if (!rate) {
    // Taux indisponible : on ne bloque jamais l'affichage, on retombe sur l'USD.
    return { currency: 'USD', symbol: '$', symbolPosition: 'before', converted: false, amounts: usdAmounts };
  }

  const converted = {};
  Object.keys(usdAmounts).forEach((key) => {
    const raw = usdAmounts[key] * rate;
    // Arrondi a 2 decimales, sans decimales inutiles pour un montant rond.
    converted[key] = Math.round(raw * 100) / 100;
  });

  return {
    currency: localCurrency,
    symbol: localCurrency,
    symbolPosition: 'after',
    converted: true,
    amounts: converted,
  };
}

module.exports = {
  PAYPAL_SUPPORTED_CURRENCIES,
  COUNTRY_TO_CURRENCY,
  resolveLocalCurrency,
  convertAmounts,
  getRates,
};
