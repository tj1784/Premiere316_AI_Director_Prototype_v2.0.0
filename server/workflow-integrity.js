import crypto from "crypto";

export function rawSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizedJsonSha256(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  return rawSha256(Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8"));
}

export function crlfJsonSha256(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  return rawSha256(Buffer.from(text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"), "utf8"));
}

export function jsonSha256Matches(expected, value) {
  const wanted = String(expected || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(wanted)) return false;
  return wanted === rawSha256(value)
    || wanted === normalizedJsonSha256(value)
    || wanted === crlfJsonSha256(value);
}
