// sign-verify.mjs
import { signData, verifyData } from './crypt.mjs';

function getByPath(root, path) {
    if (!path) return root;
    const re = /([^.\[\]]+)|\[(\d+)\]/g;
    const parts = [];
    let m;
    while ((m = re.exec(path)) !== null) parts.push(m[1] !== undefined ? m[1] : Number(m[2]));
    let cur = root;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function cloneWithoutSig(obj, sigField = 'sig') {
    if (obj == null || typeof obj !== 'object') return obj;
    let copy;
    if (typeof structuredClone === 'function') {
        try { copy = structuredClone(obj); } catch { copy = JSON.parse(JSON.stringify(obj)); }
    } else {
        copy = JSON.parse(JSON.stringify(obj));
    }
    if (copy && Object.prototype.hasOwnProperty.call(copy, sigField)) delete copy[sigField];
    return copy;
}

export async function signJson(targetOrRoot, path) {
    const sigField = 'sig';
    let target = path ? getByPath(targetOrRoot, path) : targetOrRoot;
    if (target == null) {
        if (path) return false;
        throw new TypeError('target required');
    }
    if (Array.isArray(target)) {
        const out = [];
        for (const item of target) {
            if (item == null || typeof item !== 'object') { out.push(null); continue; }
            if (Object.prototype.hasOwnProperty.call(item, sigField)) { out.push(item[sigField]); continue; }
            const payload = cloneWithoutSig(item, sigField);
            const s = await signData(payload);
            item[sigField] = s;
            out.push(s);
        }
        return out;
    }
    if (typeof target === 'object') {
        if (Object.prototype.hasOwnProperty.call(target, sigField)) return target[sigField];
        const payload = cloneWithoutSig(target, sigField);
        const s = await signData(payload);
        target[sigField] = s;
        return s;
    }
    throw new TypeError('target must be object or array');
}

export async function verifyJson(targetOrRoot, publicKeyOrGetter, path) {
    const sigField = 'sig';
    let target = path ? getByPath(targetOrRoot, path) : targetOrRoot;
    if (target == null) {
        if (path) return false;
        throw new TypeError('target required');
    }
    if (Array.isArray(target)) {
        const out = [];
        for (const item of target) {
            if (item == null || typeof item !== 'object') { out.push(false); continue; }
            if (!Object.prototype.hasOwnProperty.call(item, sigField)) { out.push(false); continue; }
            const signature = item[sigField];
            let pub = publicKeyOrGetter;
            if (typeof publicKeyOrGetter === 'function') pub = await publicKeyOrGetter(item, targetOrRoot);
            if (!pub) { out.push(false); continue; }
            const payload = cloneWithoutSig(item, sigField);
            out.push(Boolean(verifyData(payload, signature, pub)));
        }
        return out;
    }
    if (typeof target === 'object') {
        if (!Object.prototype.hasOwnProperty.call(target, sigField)) return false;
        const signature = target[sigField];
        let pub = publicKeyOrGetter;
        if (typeof publicKeyOrGetter === 'function') pub = await publicKeyOrGetter(target, targetOrRoot);
        if (!pub) return false;
        const payload = cloneWithoutSig(target, sigField);
        return Boolean(verifyData(payload, signature, pub));
    }
    throw new TypeError('target must be object or array');
}
