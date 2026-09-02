// Encodage de fichiers (jusqu'à 100 Mo) en .wav — port fidèle de core/filemode.py.
//
// Contrairement au mode texte (modulation FSK, pensé pour de courts messages),
// un fichier volumineux est bien trop gros pour être modulé en tonalités dans
// un temps raisonnable. Comme la robustesse au bruit n'est plus un objectif
// (fichier transféré tel quel, pas diffusé), on écrit directement les octets
// chiffrés comme échantillons PCM bruts — le .wav reste un vrai conteneur
// audio nécessitant ce logiciel pour être décodé, mais l'encodage est quasi
// instantané quelle que soit la taille du fichier.
//
// Format du flux (avant écriture PCM) :
//   MAGIC(4) = "PEF1" | blob_len(4, big-endian) | blob
//   blob = salt(16) || nonce(12) || ciphertext_et_tag  (voir crypto.js)
//   déchiffré = compressed_flag(1) | filename_len(2, big-endian) | filename (UTF-8) | payload
//   payload = contenu du fichier compressé en gzip si compressed_flag=1, sinon tel quel
//   (la compression n'est appliquée que si elle réduit effectivement la taille —
//   inutile sur un fichier déjà compressé comme un .jpg ou un .zip)
// Un octet de bourrage à zéro est ajouté à la fin si le flux total est de
// longueur impaire (2 octets par échantillon PCM 16 bits).

import { encrypt, decrypt } from "./crypto.js";

const MAGIC = new Uint8Array([0x50, 0x45, 0x46, 0x31]); // "PEF1"
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 Mo

export class FileDecodeError extends Error {}

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

async function gzipCompress(bytes) {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function gzipDecompress(bytes) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export async function encodeFile(filename, fileBytes, passphrase, onProgress = () => {}) {
  if (fileBytes.length > MAX_FILE_SIZE) {
    throw new Error(`fichier trop volumineux : ${fileBytes.length} octets (max ${MAX_FILE_SIZE})`);
  }

  const filenameBytes = new TextEncoder().encode(filename);
  if (filenameBytes.length > 0xffff) throw new Error("nom de fichier trop long");

  onProgress("compression");
  const compressed = await gzipCompress(fileBytes);
  let compressedFlag, payload;
  if (compressed.length < fileBytes.length) {
    compressedFlag = 1;
    payload = compressed;
  } else {
    compressedFlag = 0;
    payload = fileBytes;
  }

  const filenameLen = new Uint8Array(2);
  new DataView(filenameLen.buffer).setUint16(0, filenameBytes.length, false);

  const plaintext = concatBytes(new Uint8Array([compressedFlag]), filenameLen, filenameBytes, payload);

  onProgress("chiffrement");
  const blob = await encrypt(passphrase, plaintext);

  const blobLen = new Uint8Array(4);
  new DataView(blobLen.buffer).setUint32(0, blob.length, false);

  onProgress("encodage");
  let wire = concatBytes(MAGIC, blobLen, blob);
  if (wire.length % 2 !== 0) wire = concatBytes(wire, new Uint8Array([0]));

  // Vue directe des octets comme échantillons PCM 16 bits (little-endian, comme le format WAV natif)
  return new Int16Array(wire.buffer, wire.byteOffset, wire.length / 2);
}

// Le magic est écrit en clair (avant chiffrement) : cette détection est donc
// fiable indépendamment de la passphrase fournie, et permet de choisir
// automatiquement le bon mode de décodage sans que l'utilisateur ait à le
// préciser lui-même.
export function isFileModeAudio(pcmInt16) {
  if (pcmInt16.length < 2) return false;
  const bytes = new Uint8Array(pcmInt16.buffer, pcmInt16.byteOffset, 4);
  return MAGIC.every((b, i) => bytes[i] === b);
}

export async function decodeFile(pcmInt16, passphrase, onProgress = () => {}) {
  const wire = new Uint8Array(pcmInt16.buffer, pcmInt16.byteOffset, pcmInt16.length * 2);

  if (wire.length < 8 || !MAGIC.every((b, i) => wire[i] === b)) {
    throw new FileDecodeError(
      "ce fichier audio n'a pas été reconnu comme un fichier encodé (mauvais mode : essaie le décodage texte ?)"
    );
  }
  const blobLen = new DataView(wire.buffer, wire.byteOffset + 4, 4).getUint32(0, false);
  const blob = wire.slice(8, 8 + blobLen);
  if (blob.length !== blobLen) {
    throw new FileDecodeError(`flux tronqué : ${blob.length}/${blobLen} octets reçus`);
  }

  onProgress("dechiffrement");
  const plaintext = await decrypt(passphrase, blob); // lève DecryptionError si la passphrase est fausse

  if (plaintext.length < 3) throw new FileDecodeError("en-tête manquant");
  const compressedFlag = plaintext[0];
  const filenameLen = new DataView(plaintext.buffer, plaintext.byteOffset + 1, 2).getUint16(0, false);
  const filename = new TextDecoder().decode(plaintext.slice(3, 3 + filenameLen));
  const payload = plaintext.slice(3 + filenameLen);

  onProgress("decompression");
  const fileBytes = compressedFlag === 1 ? await gzipDecompress(payload) : payload;
  return { filename, fileBytes };
}
