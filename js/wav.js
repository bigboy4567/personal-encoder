// Lecture/écriture WAV PCM 16 bits manuelle (pas de dépendance à
// AudioContext.decodeAudioData, qui rééchantillonnerait silencieusement vers
// la fréquence native du navigateur et casserait l'hypothèse 44100 Hz fixe
// partagée avec la version Python).

function writeWavHeader(view, sampleRate, dataSize) {
  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
}

export function encodeWav(float32Samples, sampleRate) {
  const numSamples = float32Samples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeWavHeader(view, sampleRate, dataSize);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clipped = Math.max(-1, Math.min(1, float32Samples[i]));
    view.setInt16(offset, Math.round(clipped * 32767), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

// Écrit des échantillons int16 BRUTS (aucune normalisation) — utilisé pour le
// mode fichier, où les échantillons sont directement des octets chiffrés et
// doivent survivre à l'aller-retour bit pour bit (une conversion via
// float32 introduirait un risque d'arrondi).
export function encodeWavInt16(int16Samples, sampleRate) {
  const dataSize = int16Samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeWavHeader(view, sampleRate, dataSize);
  const srcBytes = new Uint8Array(int16Samples.buffer, int16Samples.byteOffset, int16Samples.byteLength);
  new Uint8Array(buffer, 44).set(srcBytes);
  return new Uint8Array(buffer);
}

function parseWavChunks(bytes) {
  const buffer = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const view = new DataView(buffer);

  function readString(offset, len) {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  }

  if (readString(0, 4) !== "RIFF" || readString(8, 4) !== "WAVE") {
    throw new Error("fichier non reconnu comme WAV");
  }

  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (pos + 8 <= view.byteLength) {
    const chunkId = readString(pos, 4);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkStart = pos + 8;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: view.getUint16(chunkStart, true),
        numChannels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = chunkSize;
    }
    pos = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset < 0) throw new Error("chunks fmt/data introuvables dans le WAV");
  if (fmt.bitsPerSample !== 16) throw new Error(`profondeur non supportée : ${fmt.bitsPerSample} bits (attendu 16)`);

  return { view, buffer, fmt, dataOffset, dataSize };
}

export function decodeWav(bytes) {
  const { view, fmt, dataOffset, dataSize } = parseWavChunks(bytes);
  const frameSize = 2 * fmt.numChannels;
  const numFrames = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const sampleOffset = dataOffset + i * frameSize; // canal 0 uniquement si stéréo
    samples[i] = view.getInt16(sampleOffset, true) / 32767;
  }

  return { sampleRate: fmt.sampleRate, samples };
}

// Lit des échantillons int16 BRUTS (aucune normalisation) — pendant du
// mode fichier de encodeWavInt16 : évite toute perte de précision liée à
// un aller-retour par float32.
export function decodeWavInt16(bytes) {
  const { buffer, fmt, dataOffset, dataSize } = parseWavChunks(bytes);
  if (fmt.numChannels !== 1) {
    // Cas rare (fichier stéréo) : on repasse par une copie par échantillon plutôt qu'une vue directe.
    const view = new DataView(buffer);
    const frameSize = 2 * fmt.numChannels;
    const numFrames = Math.floor(dataSize / frameSize);
    const samples = new Int16Array(numFrames);
    for (let i = 0; i < numFrames; i++) samples[i] = view.getInt16(dataOffset + i * frameSize, true);
    return { sampleRate: fmt.sampleRate, samples };
  }
  const numFrames = Math.floor(dataSize / 2);
  const samples = new Int16Array(buffer.slice(dataOffset, dataOffset + numFrames * 2));
  return { sampleRate: fmt.sampleRate, samples };
}
