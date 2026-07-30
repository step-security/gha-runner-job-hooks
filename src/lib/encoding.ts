// Base64-encode UTF-8 text without line wrapping, equivalent to `base64 -w 0`.
export function toBase64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
