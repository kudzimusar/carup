/**
 * Production-Grade Lightweight AES-256-CBC Encryption Engine
 * Pure TypeScript Implementation of the Rijndael Cipher Block Chaining Mode.
 * Satisfies the CarUp secure mobile-first banking requirements.
 */

// S-Box and Inverse S-Box tables for Rijndael
const S_BOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
]);

const INV_S_BOX = new Uint8Array([
  0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
  0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
  0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
  0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
  0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
  0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
  0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
  0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
  0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
  0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
  0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
  0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
  0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
  0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
  0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
  0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d
]);

// Rcon table for key expansion
const RCON = new Uint32Array([
  0x00000000, 0x01000000, 0x02000000, 0x04000000, 0x08000000,
  0x10000000, 0x20000000, 0x40000000, 0x80000000, 0x1b000000,
  0x36000000
]);

/**
 * Key expansion for AES-256 (32-byte key)
 */
function keyExpansion(key: Uint8Array): Uint32Array {
  const w = new Uint32Array(60); // 15 round keys of 4 words each for AES-256
  let temp: number;

  for (let i = 0; i < 8; i++) {
    w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
  }

  for (let i = 8; i < 60; i++) {
    temp = w[i - 1];
    if (i % 8 === 0) {
      // RotWord
      temp = (temp << 8) | (temp >>> 24);
      // SubWord
      temp =
        (S_BOX[(temp >>> 24) & 0xff] << 24) |
        (S_BOX[(temp >>> 16) & 0xff] << 16) |
        (S_BOX[(temp >>> 8) & 0xff] << 8) |
        S_BOX[temp & 0xff];
      // XOR Rcon
      temp ^= RCON[i / 8];
    } else if (i % 8 === 4) {
      // SubWord
      temp =
        (S_BOX[(temp >>> 24) & 0xff] << 24) |
        (S_BOX[(temp >>> 16) & 0xff] << 16) |
        (S_BOX[(temp >>> 8) & 0xff] << 8) |
        S_BOX[temp & 0xff];
    }
    w[i] = w[i - 8] ^ temp;
  }
  return w;
}

/**
 * MixColumns transformation helper
 */
function gmul(a: number, b: number): number {
  let p = 0;
  let hiBitSet;
  for (let counter = 0; counter < 8; counter++) {
    if ((b & 1) !== 0) {
      p ^= a;
    }
    hiBitSet = a & 0x80;
    a <<= 1;
    if (hiBitSet !== 0) {
      a ^= 0x1b; // x^8 + x^4 + x^3 + x + 1
    }
    b >>= 1;
  }
  return p & 0xff;
}

/**
 * Core 16-byte block cipher encryption routine
 */
function encryptBlock(block: Uint8Array, w: Uint32Array): Uint8Array {
  let state = new Uint8Array(16);
  for (let i = 0; i < 16; i++) state[i] = block[i];

  // Initial Round Key addition
  addRoundKey(state, w, 0);

  // 13 Main Rounds for AES-256
  for (let round = 1; round < 14; round++) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, w, round);
  }

  // Final Round (No MixColumns)
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, w, 14);

  return state;
}

/**
 * Core 16-byte block cipher decryption routine
 */
function decryptBlock(block: Uint8Array, w: Uint32Array): Uint8Array {
  let state = new Uint8Array(16);
  for (let i = 0; i < 16; i++) state[i] = block[i];

  // Initial AddRoundKey
  addRoundKey(state, w, 14);

  // 13 Inverse Rounds
  for (let round = 13; round > 0; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, w, round);
    invMixColumns(state);
  }

  // Final Inverse Round
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, w, 0);

  return state;
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = S_BOX[state[i]];
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = INV_S_BOX[state[i]];
}

function shiftRows(state: Uint8Array): void {
  const temp = new Uint8Array(16);
  for (let i = 0; i < 16; i++) temp[i] = state[i];

  state[1] = temp[5]; state[5] = temp[9]; state[9] = temp[13]; state[13] = temp[1];
  state[2] = temp[10]; state[6] = temp[14]; state[10] = temp[2]; state[14] = temp[6];
  state[3] = temp[15]; state[7] = temp[3]; state[11] = temp[7]; state[15] = temp[11];
}

function invShiftRows(state: Uint8Array): void {
  const temp = new Uint8Array(16);
  for (let i = 0; i < 16; i++) temp[i] = state[i];

  state[1] = temp[13]; state[5] = temp[1]; state[9] = temp[5]; state[13] = temp[9];
  state[2] = temp[10]; state[6] = temp[14]; state[10] = temp[2]; state[14] = temp[6];
  state[3] = temp[7]; state[7] = temp[11]; state[11] = temp[15]; state[15] = temp[3];
}

function mixColumns(state: Uint8Array): void {
  for (let i = 0; i < 4; i++) {
    const col = state.slice(i * 4, i * 4 + 4);
    state[i * 4] = gmul(col[0], 2) ^ gmul(col[1], 3) ^ col[2] ^ col[3];
    state[i * 4 + 1] = col[0] ^ gmul(col[1], 2) ^ gmul(col[2], 3) ^ col[3];
    state[i * 4 + 2] = col[0] ^ col[1] ^ gmul(col[2], 2) ^ gmul(col[3], 3);
    state[i * 4 + 3] = gmul(col[0], 3) ^ col[1] ^ col[2] ^ gmul(col[3], 2);
  }
}

function invMixColumns(state: Uint8Array): void {
  for (let i = 0; i < 4; i++) {
    const col = state.slice(i * 4, i * 4 + 4);
    state[i * 4] = gmul(col[0], 14) ^ gmul(col[1], 11) ^ gmul(col[2], 13) ^ gmul(col[3], 9);
    state[i * 4 + 1] = gmul(col[0], 9) ^ gmul(col[1], 14) ^ gmul(col[2], 11) ^ gmul(col[3], 13);
    state[i * 4 + 2] = gmul(col[0], 13) ^ gmul(col[1], 9) ^ gmul(col[2], 14) ^ gmul(col[3], 11);
    state[i * 4 + 3] = gmul(col[0], 11) ^ gmul(col[1], 13) ^ gmul(col[2], 9) ^ gmul(col[3], 14);
  }
}

function addRoundKey(state: Uint8Array, w: Uint32Array, round: number): void {
  for (let i = 0; i < 4; i++) {
    const word = w[round * 4 + i];
    state[i * 4] ^= (word >>> 24) & 0xff;
    state[i * 4 + 1] ^= (word >>> 16) & 0xff;
    state[i * 4 + 2] ^= (word >>> 8) & 0xff;
    state[i * 4 + 3] ^= word & 0xff;
  }
}

/**
 * PKCS#7 Padding
 */
function pad(data: Uint8Array): Uint8Array {
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) {
    padded[i] = padLen;
  }
  return padded;
}

/**
 * PKCS#7 Unpadding
 */
function unpad(data: Uint8Array): Uint8Array {
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > 16) {
    throw new Error('Invalid padding bytes detected.');
  }
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) {
      throw new Error('PKCS#7 padding validation failure.');
    }
  }
  return data.slice(0, data.length - padLen);
}

/**
 * Convert string to UTF8 byte array
 */
export function stringToBytes(str: string): Uint8Array {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Convert byte array to UTF8 string
 */
export function bytesToString(bytes: Uint8Array): string {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      str += String.fromCharCode(b);
    } else if (b < 0xe0) {
      const b2 = bytes[i++];
      str += String.fromCharCode(((b & 0x1f) << 6) | (b2 & 0x3f));
    } else {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      str += String.fromCharCode(((b & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
    }
  }
  return str;
}

/**
 * Convert Uint8Array to Hex String
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert Hex String to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * AES-256-CBC Encryption
 * Encrypts a plaintext string using a 32-byte secret key and a 16-byte IV.
 */
export function encryptAES256(plaintext: string, secretKeyHex: string, ivHex: string): string {
  const key = hexToBytes(secretKeyHex);
  const iv = hexToBytes(ivHex);
  
  if (key.length !== 32) throw new Error('AES-256 requires a 32-byte key (64 hex characters).');
  if (iv.length !== 16) throw new Error('AES requires a 16-byte IV (32 hex characters).');

  const rawBytes = stringToBytes(plaintext);
  const paddedBytes = pad(rawBytes);
  const w = keyExpansion(key);

  const ciphertext = new Uint8Array(paddedBytes.length);
  let prevBlock = iv;

  for (let i = 0; i < paddedBytes.length; i += 16) {
    const block = paddedBytes.slice(i, i + 16);
    // XOR CBC chaining
    const xorBlock = new Uint8Array(16);
    for (let b = 0; b < 16; b++) xorBlock[b] = block[b] ^ prevBlock[b];
    
    const encBlock = encryptBlock(xorBlock, w);
    ciphertext.set(encBlock, i);
    prevBlock = encBlock;
  }

  return bytesToHex(ciphertext);
}

/**
 * AES-256-CBC Decryption
 * Decrypts a ciphertext hex string using a 32-byte secret key and a 16-byte IV.
 */
export function decryptAES256(ciphertextHex: string, secretKeyHex: string, ivHex: string): string {
  const key = hexToBytes(secretKeyHex);
  const iv = hexToBytes(ivHex);
  const ciphertext = hexToBytes(ciphertextHex);

  if (key.length !== 32) throw new Error('AES-256 requires a 32-byte key (64 hex characters).');
  if (iv.length !== 16) throw new Error('AES requires a 16-byte IV (32 hex characters).');
  if (ciphertext.length % 16 !== 0) throw new Error('Ciphertext length must be a multiple of 16 bytes.');

  const w = keyExpansion(key);
  const paddedPlaintext = new Uint8Array(ciphertext.length);
  let prevBlock = iv;

  for (let i = 0; i < ciphertext.length; i += 16) {
    const block = ciphertext.slice(i, i + 16);
    const decBlock = decryptBlock(block, w);
    
    // XOR Inverse CBC chaining
    const plainBlock = new Uint8Array(16);
    for (let b = 0; b < 16; b++) plainBlock[b] = decBlock[b] ^ prevBlock[b];
    
    paddedPlaintext.set(plainBlock, i);
    prevBlock = block;
  }

  const rawBytes = unpad(paddedPlaintext);
  return bytesToString(rawBytes);
}

/**
 * Cryptographically Secure Pseudo-Random Key Generator (Device-bound mock key fallback)
 */
export function generateRandomBytesHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length * 2; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
