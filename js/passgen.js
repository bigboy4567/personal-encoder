// Génère une passphrase forte à partir du prix du BTC.
//
// Le prix (donnée publique) est converti en une suite de caractères à
// l'aspect aléatoire via SHA-256 — plutôt que d'apparaître en clair, il
// devient une partie de la clé au même titre que le suffixe. La vraie
// sécurité vient du suffixe, généré séparément par un aléa cryptographique
// local (crypto.getRandomValues) : même si quelqu'un devine le prix
// utilisé, il ne peut pas reconstituer la passphrase complète sans ce
// suffixe. Si l'API est injoignable, on se rabat silencieusement sur de
// l'aléa pur pour les deux parties.

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PRICE_PART_LEN = 8;
const SUFFIX_LEN = 16;

export class BtcPriceError extends Error {}

function formatDateForCoinGecko(date) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export async function fetchBtcPrice(date = null) {
  const url = date
    ? `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${formatDateForCoinGecko(date)}&localization=false`
    : "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

  let data;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    throw new BtcPriceError("impossible de récupérer le prix du BTC : " + err.message);
  }

  const price = date ? data?.market_data?.current_price?.usd : data?.bitcoin?.usd;
  if (typeof price !== "number") throw new BtcPriceError("réponse inattendue de l'API du prix du BTC");
  return price;
}

function randomChars(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function randomize(seedBytes, length) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", seedBytes));
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return out;
}

export async function generatePassphrase(date = null) {
  let priceSeed;
  try {
    const price = await fetchBtcPrice(date);
    priceSeed = new TextEncoder().encode(String(Math.round(price)));
  } catch {
    priceSeed = crypto.getRandomValues(new Uint8Array(8)); // hors-ligne : repli sur de l'aléa pur
  }

  const pricePart = await randomize(priceSeed, PRICE_PART_LEN);
  const suffix = randomChars(SUFFIX_LEN);
  return `${pricePart}-${suffix}`;
}
