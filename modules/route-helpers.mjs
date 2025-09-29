import {JWT_SECRET} from "./sql.mjs";
import jwt from "jsonwebtoken";
import {dbQuery} from "./sql.mjs";
import {getTokenFromHeader, getUserFromToken, isAdminUserId} from "./auth-helpers.mjs";

export const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);


export const requireAuth = asyncHandler(async (req, res, next) => {
    let token = getTokenFromHeader(req);
    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    req.user = user;
    next();
});

export const requireAdmin = asyncHandler(async (req, res, next) => {
    if (!req.user?.id) return res.status(401).json({ ok: false, error: "Unauthorized" });
    const ok = await isAdminUserId(req.user.id);
    if (!ok) return res.status(403).json({ ok: false, error: "Forbidden" });
    next();
});