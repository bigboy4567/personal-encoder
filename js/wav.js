// Lecture/écriture WAV PCM 16 bits manuelle (pas de dépendance à
// AudioContext.decodeAudioData, qui rééchantillonnerait silencieusement vers
// la fréquence native du navigateur et casserait l'hypothèse 44100 Hz fixe
// partagée avec la version Python).

export function encodeWav(float32Samples, sampleRate) {
  const numSamples = float32Samples.length;
  const byteRate = sampleRate * 2;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

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
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clipped = Math.max(-1, Math.min(1, float32Samples[i]));
    view.setInt16(offset, Math.round(clipped * 32767), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function decodeWav(bytes) {
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

  const bytesPerSample = 2;
  const frameSize = bytesPerSample * fmt.numChannels;
  const numFrames = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const sampleOffset = dataOffset + i * frameSize; // canal 0 uniquement si stéréo
    samples[i] = view.getInt16(sampleOffset, true) / 32767;
  }

  return { sampleRate: fmt.sampleRate, samples };
}
