// Reed-Solomon GF(256), port fidèle de la bibliothèque Python "reedsolo"
// (mêmes paramètres : prim=0x11d, generator=2, fcr=0, c_exp=8) afin qu'un
// message protégé côté Python soit corrigeable côté navigateur et vice-versa.
// Référence de l'algorithme original : https://github.com/tomerfiliba-org/reedsolomon

export class ReedSolomonError extends Error {}

const FIELD_CHARAC = 255;
const PRIM = 0x11d;
const GENERATOR = 2;

const gfExp = new Uint8Array(FIELD_CHARAC * 2);
const gfLog = new Uint8Array(FIELD_CHARAC + 1);

function gfMultNoLUT(x, y, prim) {
  let r = 0;
  while (y) {
    if (y & 1) r ^= x;
    y >>= 1;
    x <<= 1;
    if (prim > 0 && (x & 0x100)) x ^= prim;
  }
  return r;
}

(function initTables() {
  let x = 1;
  for (let i = 0; i < FIELD_CHARAC; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x = gfMultNoLUT(x, GENERATOR, PRIM);
  }
  for (let i = FIELD_CHARAC; i < FIELD_CHARAC * 2; i++) {
    gfExp[i] = gfExp[i - FIELD_CHARAC];
  }
})();

function mod255(n) {
  return ((n % FIELD_CHARAC) + FIELD_CHARAC) % FIELD_CHARAC;
}

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return gfExp[gfLog[x] + gfLog[y]];
}

function gfDiv(x, y) {
  if (y === 0) throw new ReedSolomonError("division by zero");
  if (x === 0) return 0;
  return gfExp[mod255(gfLog[x] + FIELD_CHARAC - gfLog[y])];
}

function gfPow(x, power) {
  return gfExp[mod255(gfLog[x] * power)];
}

function gfInverse(x) {
  return gfExp[mod255(FIELD_CHARAC - gfLog[x])];
}

function polyScale(p, x) {
  const r = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i++) r[i] = gfMul(p[i], x);
  return r;
}

function polyAdd(p, q) {
  const r = new Uint8Array(Math.max(p.length, q.length));
  r.set(p, r.length - p.length);
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}

function polyMul(p, q) {
  const r = new Uint8Array(p.length + q.length - 1);
  const lp = new Int16Array(p.length).fill(-1);
  for (let i = 0; i < p.length; i++) if (p[i] !== 0) lp[i] = gfLog[p[i]];
  for (let j = 0; j < q.length; j++) {
    const qj = q[j];
    if (qj === 0) continue;
    const lq = gfLog[qj];
    for (let i = 0; i < p.length; i++) {
      if (lp[i] !== -1) r[i + j] ^= gfExp[lp[i] + lq];
    }
  }
  return r;
}

function polyEval(poly, x) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) y = gfMul(y, x) ^ poly[i];
  return y;
}

function polyDiv(dividend, divisor) {
  const msgOut = Uint8Array.from(dividend);
  for (let i = 0; i < dividend.length - (divisor.length - 1); i++) {
    const coef = msgOut[i];
    if (coef !== 0) {
      for (let j = 1; j < divisor.length; j++) {
        if (divisor[j] !== 0) msgOut[i + j] ^= gfMul(divisor[j], coef);
      }
    }
  }
  const separator = msgOut.length - (divisor.length - 1);
  return [msgOut.slice(0, separator), msgOut.slice(separator)];
}

function rsGeneratorPoly(nsym) {
  let g = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) {
    g = polyMul(g, new Uint8Array([1, gfPow(GENERATOR, i)]));
  }
  return g;
}

export function rsEncodeMsg(msgIn, nsym) {
  const gen = rsGeneratorPoly(nsym);
  const msgOut = new Uint8Array(msgIn.length + nsym);
  msgOut.set(msgIn, 0);
  const lgen = new Uint8Array(gen.length);
  for (let j = 0; j < gen.length; j++) lgen[j] = gfLog[gen[j]];

  for (let i = 0; i < msgIn.length; i++) {
    const coef = msgOut[i];
    if (coef !== 0) {
      const lcoef = gfLog[coef];
      for (let j = 1; j < gen.length; j++) {
        msgOut[i + j] ^= gfExp[lcoef + lgen[j]];
      }
    }
  }
  msgOut.set(msgIn, 0);
  return msgOut;
}

function rsCalcSyndromes(msg, nsym) {
  const synd = new Uint8Array(nsym + 1);
  for (let i = 0; i < nsym; i++) synd[i + 1] = polyEval(msg, gfPow(GENERATOR, i));
  return synd;
}

function rsFindErrataLocator(ePos) {
  let eLoc = new Uint8Array([1]);
  for (const i of ePos) {
    const term = polyAdd(new Uint8Array([1]), new Uint8Array([gfPow(GENERATOR, i), 0]));
    eLoc = polyMul(eLoc, term);
  }
  return eLoc;
}

function rsFindErrorEvaluator(synd, errLoc, nsym) {
  const product = polyMul(synd, errLoc);
  const divisor = new Uint8Array(nsym + 2);
  divisor[0] = 1;
  const [, remainder] = polyDiv(product, divisor);
  return remainder;
}

function rsCorrectErrata(msgIn, synd, errPos) {
  const msg = Uint8Array.from(msgIn);
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  const errLoc = rsFindErrataLocator(coefPos);
  const syndRev = Uint8Array.from(synd).reverse();
  let errEval = rsFindErrorEvaluator(syndRev, errLoc, errLoc.length - 1);
  errEval = Uint8Array.from(errEval).reverse();

  const X = coefPos.map((cp) => gfPow(GENERATOR, -(FIELD_CHARAC - cp)));

  const E = new Uint8Array(msg.length);
  for (let i = 0; i < X.length; i++) {
    const Xi = X[i];
    const XiInv = gfInverse(Xi);
    let errLocPrime = 1;
    for (let j = 0; j < X.length; j++) {
      if (j !== i) errLocPrime = gfMul(errLocPrime, 1 ^ gfMul(XiInv, X[j]));
    }
    if (errLocPrime === 0) {
      throw new ReedSolomonError("Forney algorithm failed: errata locator prime is 0");
    }
    const errEvalRev = Uint8Array.from(errEval).reverse();
    let y = polyEval(errEvalRev, XiInv);
    y = gfMul(gfPow(Xi, 1), y);
    const magnitude = gfDiv(y, errLocPrime);
    E[errPos[i]] = magnitude;
  }
  return polyAdd(msg, E);
}

function rsFindErrorLocator(synd, nsym) {
  let errLoc = new Uint8Array([1]);
  let oldLoc = new Uint8Array([1]);
  const syndShift = synd.length > nsym ? synd.length - nsym : 0;

  for (let i = 0; i < nsym; i++) {
    const K = i + syndShift;
    let delta = synd[K];
    for (let j = 1; j < errLoc.length; j++) {
      delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[K - j]);
    }
    const shifted = new Uint8Array(oldLoc.length + 1);
    shifted.set(oldLoc, 0);
    oldLoc = shifted;

    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, gfInverse(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }

  let start = 0;
  while (start < errLoc.length - 1 && errLoc[start] === 0) start++;
  errLoc = errLoc.slice(start);
  const errs = errLoc.length - 1;
  if (errs * 2 > nsym) throw new ReedSolomonError("Too many errors to correct");
  return errLoc;
}

function rsFindErrors(errLocReversed, nmess) {
  const errs = errLocReversed.length - 1;
  const errPos = [];
  for (let i = 0; i < nmess; i++) {
    if (polyEval(errLocReversed, gfPow(GENERATOR, i)) === 0) {
      errPos.push(nmess - 1 - i);
    }
  }
  if (errPos.length !== errs) {
    throw new ReedSolomonError("Too many (or few) errors found by Chien search");
  }
  return errPos;
}

export function rsCorrectMsg(msgIn, nsym) {
  if (msgIn.length > FIELD_CHARAC) throw new ReedSolomonError("message too long");
  const msgOut = Uint8Array.from(msgIn);
  const synd = rsCalcSyndromes(msgOut, nsym);
  if (synd.every((v) => v === 0)) {
    return msgOut.slice(0, msgOut.length - nsym);
  }

  const fsynd = synd.slice(1);
  const errLoc = rsFindErrorLocator(fsynd, nsym);
  const errLocRev = Uint8Array.from(errLoc).reverse();
  const errPos = rsFindErrors(errLocRev, msgOut.length);

  const corrected = rsCorrectErrata(msgOut, synd, errPos);
  const synd2 = rsCalcSyndromes(corrected, nsym);
  if (!synd2.every((v) => v === 0)) throw new ReedSolomonError("Could not correct message");
  return corrected.slice(0, corrected.length - nsym);
}

// ---- Découpage en blocs, identique à core/ecc.py ----

export const CHUNK_DATA_LEN = 223;
export const CHUNK_ECC_LEN = 32;

export function chunkDataLengths(payloadLen) {
  if (payloadLen <= 0) throw new Error("payloadLen doit être positif");
  const numChunks = Math.ceil(payloadLen / CHUNK_DATA_LEN);
  const lengths = new Array(numChunks - 1).fill(CHUNK_DATA_LEN);
  lengths.push(payloadLen - CHUNK_DATA_LEN * (numChunks - 1));
  return lengths;
}

export function protect(payload) {
  const lengths = chunkDataLengths(payload.length);
  const chunks = [];
  let offset = 0;
  for (const length of lengths) {
    const chunk = payload.slice(offset, offset + length);
    offset += length;
    chunks.push(rsEncodeMsg(chunk, CHUNK_ECC_LEN));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function unprotect(encoded, payloadLen) {
  const lengths = chunkDataLengths(payloadLen);
  const out = new Uint8Array(payloadLen);
  let outPos = 0;
  let offset = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    const blockLen = length + CHUNK_ECC_LEN;
    const block = encoded.slice(offset, offset + blockLen);
    offset += blockLen;
    if (block.length < blockLen) {
      throw new ReedSolomonError(`flux tronqué au bloc ${i} : ${block.length}/${blockLen} octets reçus`);
    }
    const decodedChunk = rsCorrectMsg(block, CHUNK_ECC_LEN);
    out.set(decodedChunk, outPos);
    outPos += decodedChunk.length;
  }
  return out;
}
