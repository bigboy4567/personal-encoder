// Dérive, à partir d'une passphrase, les paramètres du protocole audio
// (fréquences de données + fréquences de marqueur). Port fidèle de
// core/keyderive.py : mêmes constantes, même HMAC-SHA256 en mode compteur,
// même mélange Fisher-Yates, pour produire EXACTEMENT les mêmes fréquences
// que la version Python à partir de la même passphrase.

const BAND_MIN_HZ = 1200.0;
const BAND_MAX_HZ = 9000.0;
const NUM_DATA_TONES = 16;
const NUM_MARKER_TONES = 2;

async function importHmacKey(keyBytes) {
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function keystream(hmacKey, info, nBytes) {
  const out = new Uint8Array(Math.ceil(nBytes / 32) * 32);
  let offset = 0;
  let counter = 0;
  while (offset < out.length) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false);
    const data = concatBytes(info, counterBytes);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data));
    out.set(sig, offset);
    offset += 32;
    counter += 1;
  }
  return out.slice(0, nBytes);
}

async function shuffledIndices(hmacKey, info, n) {
  const indices = Array.from({ length: n }, (_, i) => i);
  const rndBytes = await keystream(hmacKey, info, n * 4);
  const view = new DataView(rndBytes.buffer, rndBytes.byteOffset, rndBytes.byteLength);
  for (let i = n - 1; i > 0; i--) {
    const r = view.getUint32(i * 4, false) % (i + 1);
    [indices[i], indices[r]] = [indices[r], indices[i]];
  }
  return indices;
}

export async function deriveParams(passphrase) {
  const keyBytes = new TextEncoder().encode(passphrase);
  const hmacKey = await importHmacKey(keyBytes);

  const totalSlots = NUM_DATA_TONES + NUM_MARKER_TONES;
  const step = (BAND_MAX_HZ - BAND_MIN_HZ) / (totalSlots - 1);
  const slotFreqs = Array.from({ length: totalSlots }, (_, i) => BAND_MIN_HZ + i * step);

  const order = await shuffledIndices(
    hmacKey,
    new TextEncoder().encode("personal-encoder-freq-shuffle-v1"),
    totalSlots
  );
  const shuffled = order.map((i) => slotFreqs[i]);

  return {
    dataFreqs: shuffled.slice(0, NUM_DATA_TONES),
    markerFreqs: [shuffled[NUM_DATA_TONES], shuffled[NUM_DATA_TONES + 1]],
  };
}
