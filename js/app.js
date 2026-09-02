import { deriveParams } from "./keyderive.js";
import { encrypt, decrypt, DecryptionError } from "./crypto.js";
import { protect, unprotect, ReedSolomonError } from "./ecc.js";
import { modulate, demodulate, SAMPLE_RATE, DemodulationError } from "./modem.js";
import { encodeWav, decodeWav, encodeWavInt16, decodeWavInt16 } from "./wav.js";
import { decodeAnyAudioTo44100 } from "./audio-decode.js";
import { generatePassphrase } from "./passgen.js";
import { encodeFile, decodeFile, isFileModeAudio, FileDecodeError, MAX_FILE_SIZE } from "./filemode.js";

async function encodeMessage(message, passphrase) {
  const blob = await encrypt(passphrase, new TextEncoder().encode(message));
  const encodedPayload = protect(blob);
  const params = await deriveParams(passphrase);
  return modulate(encodedPayload, blob.length, params);
}

async function decodeMessage(samples, passphrase) {
  const params = await deriveParams(passphrase);
  const { encodedPayload, payloadLen } = demodulate(samples, params);
  const blob = unprotect(encodedPayload, payloadLen);
  const plaintext = await decrypt(passphrase, blob);
  return new TextDecoder().decode(plaintext);
}

function friendlyError(err) {
  if (err instanceof DemodulationError) return err.message;
  if (err instanceof ReedSolomonError) return "Correction d'erreurs impossible : " + err.message;
  if (err instanceof FileDecodeError) return err.message;
  if (err instanceof DecryptionError) return err.message;
  return "Erreur inattendue : " + err.message;
}

function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// ---- Onglets ----
const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".panel");
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

// ---- Encodage (passphrase générée automatiquement via le prix du BTC) ----
const encForm = document.getElementById("encode-form");
const encMessage = document.getElementById("encode-message");
const encTextFields = document.getElementById("encode-text-fields");
const encFileFields = document.getElementById("encode-file-fields");
const encFileInput = document.getElementById("encode-file-input");
const encFileInfo = document.getElementById("encode-file-info");
const encStatus = document.getElementById("encode-status");
const encResult = document.getElementById("encode-result");
const encAudio = document.getElementById("encode-audio");
const encDownload = document.getElementById("encode-download");
const encDuration = document.getElementById("encode-duration");
const passgenValue = document.getElementById("passgen-value");
const passgenCopy = document.getElementById("passgen-copy");

function currentEncodeMode() {
  return document.querySelector('input[name="encode-mode"]:checked').value;
}

document.querySelectorAll('input[name="encode-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const isFile = currentEncodeMode() === "file";
    encTextFields.hidden = isFile;
    encFileFields.hidden = !isFile;
    encMessage.required = !isFile;
    encFileInput.required = isFile;
    encStatus.textContent = "";
    encResult.hidden = true;
  });
});

encFileInput.addEventListener("change", () => {
  const file = encFileInput.files[0];
  if (!file) {
    encFileInfo.textContent = "";
    return;
  }
  encFileInfo.textContent = `${file.name} — ${formatBytes(file.size)}`;
  if (file.size > MAX_FILE_SIZE) {
    encFileInfo.textContent += ` — trop volumineux (max ${formatBytes(MAX_FILE_SIZE)})`;
    encFileInfo.classList.add("error-text");
  } else {
    encFileInfo.classList.remove("error-text");
  }
});

encForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = currentEncodeMode();
  const file = encFileInput.files[0];

  if (mode === "text" && !encMessage.value) return;
  if (mode === "file" && !file) return;
  if (mode === "file" && file.size > MAX_FILE_SIZE) {
    encStatus.textContent = `Erreur : fichier trop volumineux (max ${formatBytes(MAX_FILE_SIZE)}).`;
    return;
  }

  encStatus.textContent = "Génération de la passphrase (prix du BTC)…";
  encResult.hidden = true;
  await new Promise((r) => setTimeout(r, 10)); // laisse le DOM se rafraîchir avant le calcul bloquant

  try {
    const passphrase = await generatePassphrase();
    let wavBytes, durationLabel, downloadName;

    if (mode === "text") {
      encStatus.textContent = "Chiffrement et modulation en cours…";
      const audio = await encodeMessage(encMessage.value, passphrase);
      wavBytes = encodeWav(audio, SAMPLE_RATE);
      durationLabel = `Durée : ${(audio.length / SAMPLE_RATE).toFixed(1)} s`;
      downloadName = "message.wav";
    } else {
      encStatus.textContent = "Chiffrement du fichier…";
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const pcm = await encodeFile(file.name, fileBytes, passphrase);
      wavBytes = encodeWavInt16(pcm, SAMPLE_RATE);
      durationLabel = `${formatBytes(fileBytes.length)} encodés`;
      downloadName = `${file.name}.wav`;
    }

    const blob = new Blob([wavBytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);

    passgenValue.textContent = passphrase;
    encAudio.src = url;
    encDownload.href = url;
    encDownload.download = downloadName;
    encDuration.textContent = durationLabel;
    encStatus.textContent = "";
    encResult.hidden = false;
  } catch (err) {
    encStatus.textContent = "Erreur : " + err.message;
  }
});

passgenCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(passgenValue.textContent);
    const original = passgenCopy.textContent;
    passgenCopy.textContent = "Copié !";
    setTimeout(() => (passgenCopy.textContent = original), 1500);
  } catch {
    passgenCopy.textContent = "Copie impossible";
  }
});

// ---- Décodage : fichier audio uploadé (mode texte/fichier détecté automatiquement) ----
const decForm = document.getElementById("decode-form");
const decFile = document.getElementById("decode-file");
const decKey = document.getElementById("decode-key");
const decStatus = document.getElementById("decode-status");
const decResult = document.getElementById("decode-result");
const decFileResult = document.getElementById("decode-file-result");
const decFileName = document.getElementById("decode-file-name");
const decFileDownload = document.getElementById("decode-file-download");

decForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = decFile.files[0];
  const passphrase = decKey.value;
  if (!file || !passphrase) return;

  decStatus.textContent = "Analyse du fichier audio…";
  decResult.hidden = true;
  decFileResult.hidden = true;
  await new Promise((r) => setTimeout(r, 10));

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Le magic du mode fichier est écrit en clair : cette détection ne dépend
    // pas de la passphrase, donc fiable même si la passphrase saisie est fausse.
    let isFile = false;
    let int16Samples = null;
    try {
      int16Samples = decodeWavInt16(new Uint8Array(arrayBuffer)).samples;
      isFile = isFileModeAudio(int16Samples);
    } catch {
      // pas un WAV lisible tel quel -> on tentera le mode texte plus bas
    }

    if (isFile) {
      const { filename, fileBytes } = await decodeFile(int16Samples, passphrase);
      const blob = new Blob([fileBytes]);
      const url = URL.createObjectURL(blob);
      decFileName.textContent = `${filename} (${formatBytes(fileBytes.length)})`;
      decFileDownload.href = url;
      decFileDownload.download = filename;
      decFileResult.hidden = false;
    } else {
      let samples;
      try {
        const parsed = decodeWav(new Uint8Array(arrayBuffer));
        samples = parsed.sampleRate === SAMPLE_RATE ? parsed.samples : await decodeAnyAudioTo44100(arrayBuffer.slice(0));
      } catch {
        samples = await decodeAnyAudioTo44100(arrayBuffer.slice(0));
      }
      const text = await decodeMessage(samples, passphrase);
      decResult.textContent = text;
      decResult.hidden = false;
    }
    decStatus.textContent = "";
  } catch (err) {
    decStatus.textContent = friendlyError(err);
  }
});

// ---- Décodage : micro (mode texte uniquement) ----
const recordBtn = document.getElementById("record-btn");
const recordStatus = document.getElementById("record-status");
const decKeyMic = document.getElementById("decode-key-mic");
const decResultMic = document.getElementById("decode-result-mic");

let mediaRecorder = null;
let recordedChunks = [];

recordBtn.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  const passphrase = decKeyMic.value;
  if (!passphrase) {
    recordStatus.textContent = "Entre d'abord ta passphrase.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recordBtn.textContent = "Enregistrer depuis le micro";
      recordStatus.textContent = "Décodage de l'enregistrement…";
      decResultMic.hidden = true;
      try {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        const samples = await decodeAnyAudioTo44100(arrayBuffer);
        const text = await decodeMessage(samples, passphrase);
        decResultMic.textContent = text;
        decResultMic.hidden = false;
        recordStatus.textContent = "";
      } catch (err) {
        recordStatus.textContent = friendlyError(err);
      }
    };
    mediaRecorder.start();
    recordBtn.textContent = "Arrêter l'enregistrement";
    recordStatus.textContent = "Enregistrement en cours…";
  } catch (err) {
    recordStatus.textContent = "Impossible d'accéder au micro : " + err.message;
  }
});
