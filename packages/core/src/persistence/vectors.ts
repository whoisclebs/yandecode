export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

export function blobToVector(b: Buffer): Float32Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}
