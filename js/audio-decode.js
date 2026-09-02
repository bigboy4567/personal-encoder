// Décodage audio "tolérant" : accepte n'importe quel format lisible par le
// navigateur (wav, mp3, webm/opus d'un enregistrement micro, etc.) et le
// convertit en Float32Array mono à 44100 Hz, en s'appuyant sur
// decodeAudioData du navigateur (qui rééchantillonne automatiquement vers la
// fréquence du contexte audio fourni).

import { SAMPLE_RATE } from "./modem.js";

export async function decodeAnyAudioTo44100(arrayBuffer) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(1, 1, SAMPLE_RATE);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  return audioBuffer.getChannelData(0).slice();
}
