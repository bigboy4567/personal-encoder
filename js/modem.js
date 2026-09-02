// Modulation / démodulation FSK, port fidèle de core/modem.py. Mêmes
// constantes de timing et mêmes seuils de détection, pour produire un signal
// audio strictement compatible avec la version Python (et réciproquement).

import { CHUNK_ECC_LEN, chunkDataLengths } from "./ecc.js";

export const SAMPLE_RATE = 44100;
export const SYMBOL_DURATION = 0.005;
export const MARKER_DURATION = 0.15;
export const GUARD_SILENCE = 0.05;
export const RAMP_FRACTION = 0.15;
export const LENGTH_FIELD_LEN = 4;
export const LENGTH_FIELD_REPEATS = 3;

const MARKER_DETECT_THRESHOLD = 0.25;
// Pas et fenêtre proportionnels à SYMBOL_DURATION (mêmes ratios qu'à l'origine) :
// une fenêtre plus large qu'un symbole décale systématiquement le curseur de
// lecture des symboles suivants (débordement sur la frontière silence/marqueur).
const MARKER_SCAN_STEP = SYMBOL_DURATION * 0.25;
const MARKER_SCAN_WINDOW = SYMBOL_DURATION * 1.25;

export class DemodulationError extends Error {}

function raisedCosineEnvelope(nSamples, rampSamples) {
  const env = new Float32Array(nSamples).fill(1);
  if (rampSamples > 0) {
    for (let i = 0; i < rampSamples; i++) {
      const v = 0.5 * (1 - Math.cos((Math.PI * i) / (rampSamples - 1 || 1)));
      env[i] *= v;
      env[nSamples - 1 - i] *= v;
    }
  }
  return env;
}

function tone(freqs, duration, amplitude = 0.8) {
  const nSamples = Math.floor(duration * SAMPLE_RATE);
  const signal = new Float32Array(nSamples);
  for (const f of freqs) {
    const w = (2 * Math.PI * f) / SAMPLE_RATE;
    for (let n = 0; n < nSamples; n++) signal[n] += Math.sin(w * n);
  }
  for (let n = 0; n < nSamples; n++) signal[n] /= freqs.length;
  const rampSamples = Math.floor(nSamples * RAMP_FRACTION);
  const env = raisedCosineEnvelope(nSamples, rampSamples);
  for (let n = 0; n < nSamples; n++) signal[n] *= env[n] * amplitude;
  return signal;
}

function byteToNibbles(b) {
  return [(b >> 4) & 0x0f, b & 0x0f];
}

function nibblesToByte(hi, lo) {
  return ((hi & 0x0f) << 4) | (lo & 0x0f);
}

export function modulate(encodedPayload, payloadLen, params) {
  const lengthBytes = new Uint8Array(LENGTH_FIELD_LEN);
  new DataView(lengthBytes.buffer).setUint32(0, payloadLen, false);
  const headerBytes = new Uint8Array(LENGTH_FIELD_LEN * LENGTH_FIELD_REPEATS);
  for (let r = 0; r < LENGTH_FIELD_REPEATS; r++) headerBytes.set(lengthBytes, r * LENGTH_FIELD_LEN);

  const parts = [new Float32Array(Math.floor(GUARD_SILENCE * SAMPLE_RATE))];
  parts.push(tone(params.markerFreqs, MARKER_DURATION));

  for (const byteStream of [headerBytes, encodedPayload]) {
    for (const b of byteStream) {
      const [hi, lo] = byteToNibbles(b);
      parts.push(tone([params.dataFreqs[hi]], SYMBOL_DURATION));
      parts.push(tone([params.dataFreqs[lo]], SYMBOL_DURATION));
    }
  }
  parts.push(new Float32Array(Math.floor(GUARD_SILENCE * SAMPLE_RATE)));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function goertzelPower(samples, offset, length, freq, sampleRate) {
  if (length === 0) return 0;
  // Évalué à la fréquence exacte plutôt qu'arrondi au bin FFT le plus proche :
  // avec des fenêtres courtes (symboles très brefs), l'arrondi au bin entier
  // introduit une perte de précision ("scalloping") qui peut faire chuter la
  // puissance mesurée de façon significative si la fréquence ne tombe pas
  // pile sur un bin. Goertzel n'a pas besoin d'un k entier pour fonctionner.
  const w = (2 * Math.PI * freq) / sampleRate;
  const cosW = Math.cos(w);
  const coeff = 2 * cosW;
  let sPrev = 0;
  let sPrev2 = 0;
  for (let i = 0; i < length; i++) {
    const s = samples[offset + i] + coeff * sPrev - sPrev2;
    sPrev2 = sPrev;
    sPrev = s;
  }
  return sPrev2 * sPrev2 + sPrev * sPrev - coeff * sPrev * sPrev2;
}

function findMarkerStart(audio, params) {
  const step = Math.floor(MARKER_SCAN_STEP * SAMPLE_RATE);
  const window = Math.floor(MARKER_SCAN_WINDOW * SAMPLE_RATE);
  const [f1, f2] = params.markerFreqs;
  let pos = 0;
  let consecutiveHits = 0;
  const hitsNeeded = Math.max(1, Math.floor((MARKER_DURATION * 0.6) / MARKER_SCAN_STEP));

  while (pos + window <= audio.length) {
    let totalPower = 1e-9;
    for (let i = 0; i < window; i++) totalPower += audio[pos + i] * audio[pos + i];
    const p1 = goertzelPower(audio, pos, window, f1, SAMPLE_RATE);
    const p2 = goertzelPower(audio, pos, window, f2, SAMPLE_RATE);
    const ratio = (p1 + p2) / (totalPower * window);
    if (ratio > MARKER_DETECT_THRESHOLD) {
      consecutiveHits += 1;
      if (consecutiveHits >= hitsNeeded) return pos - (consecutiveHits - 1) * step;
    } else {
      consecutiveHits = 0;
    }
    pos += step;
  }
  throw new DemodulationError(
    "marqueur de synchronisation introuvable : mauvaise passphrase, audio non encodé, ou signal trop bruité"
  );
}

function readSymbol(audio, startSample, params) {
  const symbolSamples = Math.floor(SYMBOL_DURATION * SAMPLE_RATE);
  const rampSamples = Math.floor(symbolSamples * RAMP_FRACTION);
  const coreStart = startSample + rampSamples;
  const coreLen = symbolSamples - 2 * rampSamples;
  let best = 0;
  let bestPower = -1;
  for (let nibble = 0; nibble < params.dataFreqs.length; nibble++) {
    const p = goertzelPower(audio, coreStart, coreLen, params.dataFreqs[nibble], SAMPLE_RATE);
    if (p > bestPower) {
      bestPower = p;
      best = nibble;
    }
  }
  return best;
}

export function demodulate(audio, params) {
  const markerStart = findMarkerStart(audio, params);
  let cursor = markerStart + Math.floor(MARKER_DURATION * SAMPLE_RATE);
  const symbolSamples = Math.floor(SYMBOL_DURATION * SAMPLE_RATE);

  function readByte() {
    const hi = readSymbol(audio, cursor, params);
    cursor += symbolSamples;
    const lo = readSymbol(audio, cursor, params);
    cursor += symbolSamples;
    return nibblesToByte(hi, lo);
  }

  const lengthCandidates = [];
  for (let r = 0; r < LENGTH_FIELD_REPEATS; r++) {
    const bytes = new Uint8Array(LENGTH_FIELD_LEN);
    for (let i = 0; i < LENGTH_FIELD_LEN; i++) bytes[i] = readByte();
    lengthCandidates.push(bytes);
  }

  const lengthBytes = new Uint8Array(LENGTH_FIELD_LEN);
  for (let pos = 0; pos < LENGTH_FIELD_LEN; pos++) {
    const counts = new Map();
    for (const candidate of lengthCandidates) {
      const v = candidate[pos];
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = 0;
    let bestCount = -1;
    for (const [v, c] of counts) {
      if (c > bestCount) {
        best = v;
        bestCount = c;
      }
    }
    if (bestCount < Math.floor(LENGTH_FIELD_REPEATS / 2) + 1) {
      throw new DemodulationError("en-tête de longueur illisible (signal trop bruité)");
    }
    lengthBytes[pos] = best;
  }
  const payloadLen = new DataView(lengthBytes.buffer).getUint32(0, false);
  if (payloadLen <= 0) throw new DemodulationError("longueur de payload invalide (0)");

  const totalPayloadBytes = chunkDataLengths(payloadLen).reduce((n, l) => n + l + CHUNK_ECC_LEN, 0);
  const payload = new Uint8Array(totalPayloadBytes);
  for (let i = 0; i < totalPayloadBytes; i++) payload[i] = readByte();

  return { encodedPayload: payload, payloadLen };
}
