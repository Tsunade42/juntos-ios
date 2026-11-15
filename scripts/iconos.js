// Genera assets/icon.png (1024, sin transparencia, como exige Apple) y assets/splash.png. Sin dependencias.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, hgt, pixel) { // pixel(x,y) -> [r,g,b]
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Logo de Juntos: degradado turquesa→índigo, dos anillos y un "play". Diseño en cuadrícula de 64.
function logoPixel(size, ox = 0, oy = 0, scale = size / 64, bg = null) {
  const ring = (X, Y, cx, cy) => Math.abs(Math.hypot(X - cx, Y - cy) - 13) <= 2.1;
  const tri = (X, Y) => X >= 29 && X <= 39 && Math.abs(Y - 32) <= 6.5 * (1 - (X - 29) / 10);
  return (x, y) => {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const X = (x + dx - ox) / scale, Y = (y + dy - oy) / scale;
      const inside = X >= 0 && Y >= 0 && X <= 64 && Y <= 64;
      let R, G, B;
      if (!inside && bg) [R, G, B] = bg;
      else { const t = Math.max(0, Math.min(1, (X + Y) / 128)); R = 0x2d + (0x63 - 0x2d) * t; G = 0xd4 + (0x66 - 0xd4) * t; B = 0xbf + (0xf1 - 0xbf) * t; }
      if (inside && (ring(X, Y, 24, 32) || ring(X, Y, 40, 32) || tri(X, Y))) { R = R * 0.08 + 255 * 0.92; G = G * 0.08 + 255 * 0.92; B = B * 0.08 + 255 * 0.92; }
      r += R; g += G; b += B;
    }
    return [r / 4, g / 4, b / 4];
  };
}
const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png(1024, 1024, logoPixel(1024)));



console.log('Íconos listos en', out);
