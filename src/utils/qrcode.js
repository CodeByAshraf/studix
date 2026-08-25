// src/utils/qrcode.js
// Pure JavaScript QR Code generator — no dependencies
// Implements QR Code Version 1-10, Error Correction Level M
// Returns a 2D boolean matrix (true = dark module)

// ── Reed-Solomon GF(256) arithmetic ─────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 285;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) { return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
function gfPow(a, b) { return GF_EXP[(GF_LOG[a] * b) % 255]; }
function gfDiv(a, b) { if (a === 0) return 0; return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255]; }

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const t = [1, gfPow(2, i)];
    const np = new Array(poly.length + t.length - 1).fill(0);
    for (let j = 0; j < poly.length; j++)
      for (let k = 0; k < t.length; k++)
        np[j + k] ^= gfMul(poly[j], t[k]);
    poly = np;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen  = rsGeneratorPoly(ecLen);
  const msg  = [...data, ...new Array(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++)
        msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}

// ── QR version / capacity tables (EC level M) ───────────────
// [version]: { dataBytes, ecBytes, blocks, cap }
const QR_VERSIONS = {
  1:  { dataBytes: 16, ecBytes: 10, blocks:[[1,16,10]], cap: 14 },
  2:  { dataBytes: 28, ecBytes: 16, blocks:[[1,28,16]], cap: 26 },
  3:  { dataBytes: 44, ecBytes: 26, blocks:[[2,22,13]], cap: 42 },
  4:  { dataBytes: 64, ecBytes: 36, blocks:[[2,32,18]], cap: 62 },
  5:  { dataBytes: 86, ecBytes: 48, blocks:[[2,43,24]], cap: 84 },
  6:  { dataBytes:108, ecBytes: 64, blocks:[[4,27,16]], cap:106 },
  7:  { dataBytes:124, ecBytes: 72, blocks:[[4,31,18]], cap:122 },
  8:  { dataBytes:154, ecBytes: 88, blocks:[[2,38,22],[2,39,22]], cap:152 },
  9:  { dataBytes:182, ecBytes:110, blocks:[[3,36,20],[2,37,20]], cap:180 },
  10: { dataBytes:216, ecBytes:130, blocks:[[4,43,24],[1,44,24]], cap:213 },
};

function getVersion(len) {
  for (let v = 1; v <= 10; v++) {
    if (QR_VERSIONS[v].cap >= len) return v;
  }
  return 10; // truncate if too long
}

// ── Encode bytes (byte mode) ─────────────────────────────────
function encodeData(text, version) {
  const bytes = new TextEncoder().encode(text);
  const info  = QR_VERSIONS[version];
  const bitStream = [];

  const push = (val, bits) => {
    for (let i = bits - 1; i >= 0; i--) bitStream.push((val >> i) & 1);
  };

  push(0b0100, 4);                  // byte mode indicator
  push(bytes.length, 8);             // character count
  bytes.forEach(b => push(b, 8));   // data
  push(0, 4);                        // terminator

  // Pad to byte boundary
  while (bitStream.length % 8 !== 0) bitStream.push(0);

  // Pad bytes
  const padBytes = [0xEC, 0x11];
  let bi = 0;
  while (bitStream.length < info.dataBytes * 8) {
    push(padBytes[bi++ % 2], 8);
  }

  // Convert to byte array
  const data = [];
  for (let i = 0; i < bitStream.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bitStream[i + j] || 0);
    data.push(b);
  }
  return data.slice(0, info.dataBytes);
}

function interleaveAndEC(data, version) {
  const blocks = QR_VERSIONS[version].blocks;
  const codewords = [];
  let offset = 0;

  // Split data into blocks and compute EC
  const blockData = [];
  const blockEC   = [];
  for (const [count, total, ec] of blocks) {
    const dataLen = total - ec;
    for (let i = 0; i < count; i++) {
      const d = data.slice(offset, offset + dataLen);
      blockData.push(d);
      blockEC.push(rsEncode(d, ec));
      offset += dataLen;
    }
  }

  // Interleave data
  const maxData = Math.max(...blockData.map(b => b.length));
  for (let i = 0; i < maxData; i++)
    for (const b of blockData) if (i < b.length) codewords.push(b[i]);

  // Interleave EC
  const maxEC = Math.max(...blockEC.map(b => b.length));
  for (let i = 0; i < maxEC; i++)
    for (const b of blockEC) if (i < b.length) codewords.push(b[i]);

  return codewords;
}

// ── Matrix building ──────────────────────────────────────────
function makeMatrix(version) {
  const size = version * 4 + 17;
  return { size, data: new Array(size * size).fill(-1) };
}

function setModule(m, r, c, v) {
  if (r >= 0 && r < m.size && c >= 0 && c < m.size) m.data[r * m.size + c] = v;
}

function getModule(m, r, c) { return m.data[r * m.size + c]; }

function addFinderPattern(m, row, col) {
  for (let r = -1; r <= 7; r++)
    for (let c = -1; c <= 7; c++) {
      const v = r === -1 || r === 7 || c === -1 || c === 7 || (r >= 2 && r <= 4 && c >= 2 && c <= 4) ? 1 : 0;
      setModule(m, row + r, col + c, v);
    }
}

function addTimingPatterns(m) {
  for (let i = 8; i < m.size - 8; i++) {
    setModule(m, 6, i, i % 2 === 0 ? 1 : 0);
    setModule(m, i, 6, i % 2 === 0 ? 1 : 0);
  }
}

function addAlignmentPatterns(m, version) {
  const positions = {
    1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],
    8:[6,24,42],9:[6,26,46],10:[6,28,50],
  };
  const pts = positions[version] || [];
  for (const r of pts)
    for (const c of pts) {
      if ((r === 6 && c === 6) || (r === 6 && c === pts[pts.length-1]) || (r === pts[pts.length-1] && c === 6)) continue;
      setModule(m, r, c, 1);
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const v = Math.abs(dr) === 2 || Math.abs(dc) === 2 ? 1 : dr === 0 && dc === 0 ? 1 : 0;
          setModule(m, r+dr, c+dc, v);
        }
    }
}

function reserveFormatInfo(m) {
  for (let i = 0; i <= 8; i++) {
    if (getModule(m, 8, i) === -1) setModule(m, 8, i, -2);
    if (getModule(m, i, 8) === -1) setModule(m, i, 8, -2);
  }
  setModule(m, 8, m.size - 8, -2);
  for (let i = m.size - 7; i < m.size; i++) {
    setModule(m, 8, i, -2);
    setModule(m, i, 8, -2);
  }
  setModule(m, m.size - 8, 8, 1); // dark module
}

function placeDataBits(m, codewords) {
  let bit = 0;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);

  let up = true;
  for (let col = m.size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < m.size; i++) {
      const row = up ? m.size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (getModule(m, row, c) === -1) {
          setModule(m, row, c, bit < bits.length ? bits[bit++] : 0);
        }
      }
    }
    up = !up;
  }
}

const FORMAT_STRINGS = {
  // EC=M (10), mask 0-7
  0: 0b101010000010010, 1: 0b101000100100101,
  2: 0b101111001111100, 3: 0b101101101001011,
  4: 0b100010111111001, 5: 0b100000011001110,
  6: 0b100111110010111, 7: 0b100101010100000,
};

function applyMask(m, mask) {
  const mat = { size: m.size, data: [...m.data] };
  for (let r = 0; r < mat.size; r++)
    for (let c = 0; c < mat.size; c++) {
      const v = mat.data[r * mat.size + c];
      if (v < 0) continue;
      const invert = [
        (r + c) % 2 === 0,
        r % 2 === 0,
        c % 3 === 0,
        (r + c) % 3 === 0,
        (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        r * c % 2 + r * c % 3 === 0,
        (r * c % 2 + r * c % 3) % 2 === 0,
        (r * c % 3 + (r + c) % 2) % 2 === 0,
      ][mask];
      if (invert) mat.data[r * mat.size + c] ^= 1;
    }
  return mat;
}

function writeFormatInfo(m, mask) {
  const fmt = FORMAT_STRINGS[mask];
  const bits = [];
  for (let i = 14; i >= 0; i--) bits.push((fmt >> i) & 1);

  const positions = [
    [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]],
    [[m.size-1,8],[m.size-2,8],[m.size-3,8],[m.size-4,8],[m.size-5,8],[m.size-6,8],[m.size-7,8],[8,m.size-8],[8,m.size-7],[8,m.size-6],[8,m.size-5],[8,m.size-4],[8,m.size-3],[8,m.size-2],[8,m.size-1]],
  ];
  for (let i = 0; i < 15; i++) {
    setModule(m, positions[0][i][0], positions[0][i][1], bits[i]);
    setModule(m, positions[1][i][0], positions[1][i][1], bits[i]);
  }
}

function countPenalty(m) {
  let p = 0;
  const s = m.size;
  const g = (r, c) => m.data[r * s + c];
  // Rule 1
  for (let r = 0; r < s; r++) {
    let run = 1;
    for (let c = 1; c < s; c++) { if (g(r,c)===g(r,c-1)) { run++; if(run===5)p+=3; else if(run>5)p++; } else run=1; }
  }
  for (let c = 0; c < s; c++) {
    let run = 1;
    for (let r = 1; r < s; r++) { if (g(r,c)===g(r-1,c)) { run++; if(run===5)p+=3; else if(run>5)p++; } else run=1; }
  }
  // Rule 2
  for (let r = 0; r < s-1; r++) for (let c = 0; c < s-1; c++) if (g(r,c)===g(r+1,c)&&g(r,c)===g(r,c+1)&&g(r,c)===g(r+1,c+1)) p+=3;
  // Rule 4
  let dark = 0; m.data.forEach(v => { if (v === 1) dark++; });
  const pct = (dark / (s * s)) * 100;
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

// ── Public API ───────────────────────────────────────────────
/**
 * generateQR(text) → { matrix: boolean[], size: number }
 * matrix[row*size+col] === true  → dark module
 */
export function generateQR(text) {
  if (!text) return null;
  const version = getVersion(text.length);
  const data     = encodeData(text, version);
  const codewords= interleaveAndEC(data, version);

  // Build matrix
  const m = makeMatrix(version);
  addFinderPattern(m, 0, 0);
  addFinderPattern(m, 0, m.size - 7);
  addFinderPattern(m, m.size - 7, 0);
  addTimingPatterns(m);
  addAlignmentPatterns(m, version);
  reserveFormatInfo(m);
  placeDataBits(m, codewords);

  // Choose best mask
  let bestMask = 0, bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const mt = applyMask(m, mask);
    writeFormatInfo(mt, mask);
    const pen = countPenalty(mt);
    if (pen < bestPenalty) { bestPenalty = pen; bestMask = mask; }
  }

  const final = applyMask(m, bestMask);
  writeFormatInfo(final, bestMask);

  return {
    size:   final.size,
    matrix: final.data.map(v => v === 1),
  };
}

/**
 * qrToSVG(text, options) → SVG string
 */
export function qrToSVG(text, { size = 160, fg = '#000000', bg = '#ffffff', quiet = 4 } = {}) {
  const qr = generateQR(text);
  if (!qr) return '';

  const moduleSize = (size - quiet * 2 * (size / (qr.size + quiet * 2))) / qr.size;
  const total      = qr.size * moduleSize + quiet * 2 * moduleSize;
  const off        = quiet * moduleSize;

  let rects = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.matrix[r * qr.size + c]) {
        const x = (off + c * moduleSize).toFixed(2);
        const y = (off + r * moduleSize).toFixed(2);
        const w = (moduleSize + 0.1).toFixed(2); // slight overlap to avoid gaps
        rects += `<rect x="${x}" y="${y}" width="${w}" height="${w}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${total.toFixed(2)}" width="${size}" height="${size}">
<rect width="100%" height="100%" fill="${bg}"/>
<g fill="${fg}">${rects}</g>
</svg>`;
}
