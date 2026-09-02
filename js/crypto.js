// Chiffrement du message avec la passphrase, via la Web Crypto API native
// du navigateur. Port de core/crypto.py : PBKDF2-HMAC-SHA256 (210 000
// itérations) pour dériver une clé AES-256, puis AES-GCM (nonce 12 octets,
// tag 128 bits accolé au chiffré, comme le fait `cryptography` côté Python).

export const SALT_LEN = 16;
export const NONCE_LEN = 12;
export const KEY_LEN_BITS = 256;
export const PBKDF2_ITERATIONS = 210_000;

export class DecryptionError extends Error {}

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LEN_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(passphrase, plaintextBytes) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintextBytes)
  );

  const blob = new Uint8Array(SALT_LEN + NONCE_LEN + ciphertext.length);
  blob.set(salt, 0);
  blob.set(nonce, SALT_LEN);
  blob.set(ciphertext, SALT_LEN + NONCE_LEN);
  return blob;
}

export async function decrypt(passphrase, blob) {
  if (blob.length < SALT_LEN + NONCE_LEN) {
    throw new DecryptionError("bloc chiffré trop court");
  }
  const salt = blob.slice(0, SALT_LEN);
  const nonce = blob.slice(SALT_LEN, SALT_LEN + NONCE_LEN);
  const ciphertext = blob.slice(SALT_LEN + NONCE_LEN);
  const key = await deriveKey(passphrase, salt);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
    return new Uint8Array(plaintext);
  } catch (err) {
    throw new DecryptionError("passphrase incorrecte ou audio corrompu");
  }
}
