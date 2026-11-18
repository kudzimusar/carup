const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_END = Buffer.from('0000000049454e44ae426082', 'hex');

function hasJpegScan(buffer) {
  const end = buffer.length - 2;
  let frame = false;
  for (let offset = 2; offset + 3 < end;) {
    if (buffer[offset++] !== 0xff) return false;
    while (offset < end && buffer[offset] === 0xff) offset++;
    if (offset + 2 >= end) return false;
    const marker = buffer[offset++];
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > end) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (size < 8 || !buffer.readUInt16BE(offset + 3) || !buffer.readUInt16BE(offset + 5)) return false;
      frame = true;
    }
    if (marker === 0xda) return frame && size >= 6 && offset + size < end;
    offset += size;
  }
  return false;
}

// Check the file envelope before storage or provider access. Neither the
// extension nor these checks establish that an image depicts an identity document.
export function evidenceImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9 && hasJpegScan(buffer)) return 'image/jpeg';

  if (buffer.length >= 57 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
      && buffer.readUInt32BE(8) === 13 && buffer.toString('ascii', 12, 16) === 'IHDR'
      && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0
      && buffer.subarray(-12).equals(PNG_END)) {
    let hasImageData = false;
    for (let offset = 33; offset < buffer.length - 12;) {
      if (offset + 12 > buffer.length - 12) return null;
      const size = buffer.readUInt32BE(offset);
      if (offset + 12 + size > buffer.length - 12) return null;
      if (size > 0 && buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT') hasImageData = true;
      offset += 12 + size;
    }
    return hasImageData ? 'image/png' : null;
  }

  if (buffer.length >= 22 && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.readUInt32LE(4) === buffer.length - 8 && buffer.toString('ascii', 8, 12) === 'WEBP'
      && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))) {
    let hasImageData = false;
    for (let offset = 12; offset < buffer.length;) {
      if (offset + 8 > buffer.length) return null;
      const size = buffer.readUInt32LE(offset + 4);
      const next = offset + 8 + size + size % 2;
      if (next > buffer.length) return null;
      const kind = buffer.toString('ascii', offset, offset + 4);
      if ((kind === 'VP8 ' && size >= 10) || (kind === 'VP8L' && size >= 5) || (kind === 'ANMF' && size > 16)) hasImageData = true;
      offset = next;
    }
    return hasImageData ? 'image/webp' : null;
  }
  return null;
}
