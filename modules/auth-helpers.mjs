import jwt from "jsonwebtoken";
import { JWT_SECRET, dbQuery } from "./sql.mjs";

export function getTokenFromHeader(req){
    const hdr = req.headers?.authorization || "";
    return hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
}

export function findTokenInReq(req){
    if (!req) return null;
    const header = getTokenFromHeader(req);

    if (header) return header;
    if (req.query && (req.query.token || req.query.t)) return req.query.token || req.query.t;
    if (req.params && req.params.token) return req.params.token;
    return null;
}

export function verifyJwtToken(token){
    if (!token) return null;
    try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

export async function getUserFromToken(token){
    if (!token) return null;
    const decoded = verifyJwtToken(token);

    if (!decoded || !decoded.id) return null;
    let id = decoded.id;

    if (typeof id === "string" && /^\d+$/.test(id)) id = Number(id);

    if (typeof id === "bigint") {
        const n = Number(id);
        id = Number.isSafeInteger(n) ? n : String(id);
    }
    return { id, role: decoded.role || "user" };
}

export async function isAdminUserId(userId){
    if (!userId) return false;
    const rows = await dbQuery("SELECT role FROM users WHERE id = ?", [userId]);
    const row = Array.isArray(rows) ? rows[0] : (rows && rows.rows && rows.rows[0]) || null;
    return row?.role === "admin";
}

export async function authFromRequest(req){
    if (!req) return null;
    if (req.user && req.user.id) return req.user;

    const token = findTokenInReq(req);
    if (!token) return null;

    const user = await getUserFromToken(token);
    if (!user) return null;

    req.user = user;
    return user;
}

export async function isAuth(req){
    return !!(await authFromRequest(req));
}

export async function isAdmin(req){
    const user = await authFromRequest(req);
    if (!user) return false;
    return await isAdminUserId(user.id);
}
