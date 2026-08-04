// ---------- Conversion de devise (affichage + paiement PayPal) ----------
//
// Principe : tous les prix de base sont en EUR (source unique de verite dans
// pricing.json / site-pricing.json), et c'est la devise affichee par defaut a tout
// visiteur dont le pays n'est pas reconnu ou n'a pas de devise locale utilisable.
// Pour l'affichage, on convertit vers la devise locale du visiteur UNIQUEMENT si
// cette devise est acceptee par PayPal ET si un taux de change est disponible.
// Le cas du dollar americain (USD) utilise un taux fixe defini ci-dessous plutot que
// l'API de taux de change en direct, pour un affichage stable independant des
// fluctuations du marche (ne pas exposer ce mecanisme publiquement sur le site).
//
// Le paiement PayPal reel utilise TOUJOURS le meme calcul que l'affichage (une seule
// source de verite cote serveur), pour eviter tout ecart entre le prix montre au
// visiteur et le montant reellement facture.

// Taux de conversion fixe EUR -> USD (1 EUR = X USD). A ajuster manuellement de temps
// en temps si besoin (proche du taux de marche reel), mais volontairement non relie a
// l'API de taux en direct : garantit un affichage/facturation USD stable et previsible.
const FIXED_EUR_TO_USD_RATE = 1.15;

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
  // Etats-Unis : traite a part via un taux fixe (voir FIXED_EUR_TO_USD_RATE), pas
  // l'API de taux en direct.
  US: 'USD',
};

const RATES_URL = 'https://open.er-api.com/v6/latest/EUR';
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
    console.error('Erreur recuperation taux de change (fallback EUR):', err.message);
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

// Convertit un objet de montants de base EUR (ex: { starter: 490, growth: 990 }) vers
// la devise locale si possible. Retourne toujours une forme homogene :
// { currency, symbol, symbolPosition, converted, amounts }
async function convertAmounts(baseAmounts, countryCode) {
  const localCurrency = resolveLocalCurrency(countryCode);

  // Pays inconnu, ou devise locale non utilisable : on reste sur la devise de base
  // du site (EUR), sans conversion.
  if (!localCurrency || localCurrency === 'EUR') {
    return { currency: 'EUR', symbol: '€', symbolPosition: 'after', converted: false, amounts: baseAmounts };
  }

  // Cas USD : taux fixe, pas d'appel a l'API de taux de change en direct.
  if (localCurrency === 'USD') {
    const converted = {};
    Object.keys(baseAmounts).forEach((key) => {
      converted[key] = Math.round(baseAmounts[key] * FIXED_EUR_TO_USD_RATE * 100) / 100;
    });
    return { currency: 'USD', symbol: '$', symbolPosition: 'before', converted: true, amounts: converted };
  }

  // Autres devises PayPal : conversion via l'API de taux de change en direct (base EUR).
  const rates = await getRates();
  const rate = rates && typeof rates[localCurrency] === 'number' ? rates[localCurrency] : null;

  if (!rate) {
    // Taux indisponible : on ne bloque jamais l'affichage, on retombe sur l'EUR.
    return { currency: 'EUR', symbol: '€', symbolPosition: 'after', converted: false, amounts: baseAmounts };
  }

  const converted = {};
  Object.keys(baseAmounts).forEach((key) => {
    const raw = baseAmounts[key] * rate;
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
