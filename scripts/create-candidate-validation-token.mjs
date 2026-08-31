import { createHmac, randomBytes } from "node:crypto";

const secret = process.env.CANDIDATE_VALIDATION_SECRET;
const ttlSeconds = Number.parseInt(process.env.CANDIDATE_VALIDATION_TTL_SECONDS ?? "300", 10);

if (!secret) throw new Error("CANDIDATE_VALIDATION_SECRET is required");
if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) throw new Error("CANDIDATE_VALIDATION_TTL_SECONDS must be between 1 and 900");

const payload = {
  action: "candidate-vision-validation",
  exp: Date.now() + ttlSeconds * 1000,
  nonce: randomBytes(24).toString("base64url"),
};
const data = `${payload.action}:${payload.exp}:${payload.nonce}`;
const sig = createHmac("sha256", secret).update(data).digest("hex");
process.stdout.write(Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url"));
