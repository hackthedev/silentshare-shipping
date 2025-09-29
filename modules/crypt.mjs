import { promises as fs } from "fs";
import crypto from "crypto";

const KEY_FILE = "./privatekey.json";

function canonicalize(x) {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(canonicalize);
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = canonicalize(x[k]);
    return out;
}

export function stableStringify(obj) {
    return JSON.stringify(canonicalize(obj));
}

async function ensureKeyPair() {
    try {
        const raw = await fs.readFile(KEY_FILE, "utf8");
        const { privateKey } = JSON.parse(raw);
        crypto.createPrivateKey(privateKey);
        const pubKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
        return { privateKey, publicKey: pubKey.toString() };
    } catch {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" }
        });
        await fs.writeFile(KEY_FILE, JSON.stringify({ privateKey }, null, 2), { encoding: "utf8", mode: 0o600 });
        return { privateKey, publicKey };
    }
}

export async function getPrivateKey() {
    const { privateKey } = await ensureKeyPair();
    return privateKey;
}

export async function getPublicKey() {
    const { publicKey } = await ensureKeyPair();
    return publicKey;
}

export async function encrypt(data, recipient) {
    const plaintext = typeof data === "string" ? data : stableStringify(data);

    let aesKey;
    let envelope = { method: "" };

    if (recipient.includes("BEGIN PUBLIC KEY") || recipient.includes("BEGIN RSA PUBLIC KEY")) {
        // → RSA-Variante
        aesKey = crypto.randomBytes(32);
        envelope.method = "rsa";
        envelope.encKey = crypto.publicEncrypt(
            { key: recipient, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
            aesKey
        ).toString("base64");
    } else {
        // → Passwort-Variante (PBKDF2)
        const salt = crypto.randomBytes(16);
        aesKey = crypto.pbkdf2Sync(recipient, salt, 100000, 32, "sha256");
        envelope.method = "password";
        envelope.salt = salt.toString("base64");
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        ...envelope,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64")
    };
}

export async function decrypt(envelope, password = null) {
    let aesKey;

    if (envelope.method === "rsa") {
        const priv = await getPrivateKey();
        aesKey = crypto.privateDecrypt(
            { key: priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
            Buffer.from(envelope.encKey, "base64")
        );
    } else if (envelope.method === "password") {
        if (!password) throw new Error("Password required for password-based decryption");
        aesKey = crypto.pbkdf2Sync(
            password,
            Buffer.from(envelope.salt, "base64"),
            100000,
            32,
            "sha256"
        );
    } else {
        throw new Error("Unsupported envelope method");
    }

    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const txt = dec.toString("utf8");

    try {
        return JSON.parse(txt);
    } catch {
        return txt;
    }
}


export async function signData(data) {
    const priv = await getPrivateKey();
    const signer = crypto.createSign("SHA256");
    const payload = typeof data === "string" ? data : stableStringify(data);
    signer.update(payload, "utf8");
    signer.end();
    return signer.sign(priv, "base64");
}

export function verifyData(data, signature, publicKey) {
    const verifier = crypto.createVerify("SHA256");
    const payload = typeof data === "string" ? data : stableStringify(data);
    verifier.update(payload, "utf8");
    verifier.end();
    return verifier.verify(publicKey, signature, "base64");
}
