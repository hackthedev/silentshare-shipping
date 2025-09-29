import jwt from "jsonwebtoken";
import Logger from "./logger.mjs";
import {dbQuery, JWT_EXPIRES_IN, JWT_SECRET} from "./sql.mjs";
import bcrypt from "bcrypt";
import {terminalRegisterUser} from "./terminalCommands/terminalRegisterUser.mjs";
import {terminalSetUserRole} from "./terminalCommands/terminalSetUserRole.mjs";
import {terminalListUsers} from "./terminalCommands/terminalListIUsers.mjs";
import {terminalDeleteUser} from "./terminalCommands/terminalDeleteUser.mjs";
import {terminalChangePassword} from "./terminalCommands/terminalChangePassword.mjs";

export let versionCode = 100;

export function makeid(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

export function _normalizeBigInt(x) {
    if (x === null || x === undefined) return x;
    if (typeof x === "bigint") {
        const n = Number(x);
        return Number.isSafeInteger(n) ? n : String(x);
    }
    if (Array.isArray(x)) return x.map(_normalizeBigInt);
    if (typeof x === "object") {
        const out = {};
        for (const k of Object.keys(x)) out[k] = _normalizeBigInt(x[k]);
        return out;
    }
    return x;
}

export function sanitizeForJson(value) {
    if (value === null || value === undefined) return value;

    if (value instanceof Date) return value.toISOString();

    if (typeof value === "bigint") {
        const n = Number(value);
        if (Number.isSafeInteger(n)) return n;
        return value.toString();
    }

    if (Buffer && Buffer.isBuffer && Buffer.isBuffer(value)) {
        return value.toString("base64");
    }

    if (Array.isArray(value)) return value.map(sanitizeForJson);

    if (typeof value === "object") {
        const out = {};
        for (const k of Object.keys(value)) out[k] = sanitizeForJson(value[k]);
        return out;
    }

    return value;
}

export function signToken(payload) {
    const p = _normalizeBigInt(payload);
    return jwt.sign(p, JWT_SECRET, {expiresIn: JWT_EXPIRES_IN});
}

export function extractHost(url){
    if(!url) return null;
    const s = String(url).trim();

    const looksLikeBareIPv6 = !s.includes('://') && !s.includes('/') && s.includes(':') && /^[0-9A-Fa-f:.]+$/.test(s);
    const withProto = looksLikeBareIPv6 ? `https://[${s}]` : (s.includes('://') ? s : `https://${s}`);

    try {
        const u = new URL(withProto);
        const host = u.hostname; // IPv6 returned without brackets
        const port = u.port;
        if (host.includes(':')) {
            return port ? `[${host}]:${port}` : host;
        }
        return port ? `${host}:${port}` : host;
    } catch (e) {
        const re = /^(?:https?:\/\/)?(?:[^@\/\n]+@)?([^:\/?#]+)(?::(\d+))?(?:[\/?#]|$)/i;
        const m = s.match(re);
        if (!m) return null;
        const hostname = m[1].replace(/^\[(.*)\]$/, '$1');
        const port = m[2];
        if (hostname.includes(':')) return port ? `[${hostname}]:${port}` : hostname;
        return port ? `${hostname}:${port}` : hostname;
    }
}

export async function handleTerminalCommands(command, args) {
    try {
        if (command === "register") {
            return terminalRegisterUser(args);
        }
        if (command === "role") {
            return terminalSetUserRole(args);
        }
        if (command === "users") {
            return terminalListUsers(args);
        }
        if (command === "delete") {
            return terminalDeleteUser(args);
        }
        if (command === "password") {
            return terminalChangePassword(args);
        }
    }
    catch (e){
        Logger.error(e);
    }
}