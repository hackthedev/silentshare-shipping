// rateLimit.mjs
export function rateLimit({windowMs = 60_000, ipLimit = 30, sigLimit = 120, trustProxy = true}) {
    const ipMap = new Map();
    const sigMap = new Map();
    const triggeredIp = new Map();
    const callbacks = [];
    const now = () => Date.now();

    function normalizeIp(req) {
        if (trustProxy) {
            const xf = req.headers['x-forwarded-for'];
            if (typeof xf === 'string' && xf.length) {
                const first = xf.split(',')[0].trim();
                if (first) return first;
            }
        }
        return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    }

    function touch(map, key, limit) {
        const t = now();
        let rec = map.get(key);
        if (!rec || t >= rec.resetAt) {
            rec = {count: 0, resetAt: t + windowMs};
            map.set(key, rec);
        }
        rec.count++;
        return {
            ok: rec.count <= limit,
            remaining: Math.max(0, limit - rec.count),
            resetAt: rec.resetAt,
            count: rec.count
        };
    }

    function cleanupExpired(map) {
        const t = now();
        for (const [k, v] of map) if (v.resetAt <= t) map.delete(k);
    }

    function emitTrigger(info) {
        if (!callbacks.length) return;
        setImmediate(() => {
            for (const cb of callbacks) {
                try { cb(info); } catch (_) {}
            }
        });
    }

    function middleware(req, res, next) {
        try {
            if (Math.random() < 0.01) {
                cleanupExpired(ipMap);
                cleanupExpired(sigMap);
                cleanupExpired(triggeredIp);
            }
        } catch (_) {}

        const ip = normalizeIp(req);
        const sig = `${req.method} ${req.path}`;

        const ipRes = touch(ipMap, ip, ipLimit);
        const sigRes = touch(sigMap, sig, sigLimit);

        res.set('X-RateLimit-IP-Limit', String(ipLimit));
        res.set('X-RateLimit-IP-Remaining', String(ipRes.remaining));
        res.set('X-RateLimit-IP-Reset', String(Math.ceil((ipRes.resetAt - now()) / 1000)));
        res.set('X-RateLimit-Signature-Limit', String(sigLimit));
        res.set('X-RateLimit-Signature-Remaining', String(sigRes.remaining));
        res.set('X-RateLimit-Signature-Reset', String(Math.ceil((sigRes.resetAt - now()) / 1000)));

        const infoBase = {
            ts: new Date().toISOString(),
            ip,
            signature: sig,
            method: req.method,
            path: req.path,
            userAgent: req.headers['user-agent'] || null,
            headers: { range: req.headers.range || null, referer: req.headers.referer || req.headers.referrer || null }
        };

        if (!ipRes.ok) {
            const prev = triggeredIp.get(ip);
            if (!prev || now() >= prev.resetAt) {
                triggeredIp.set(ip, { resetAt: ipRes.resetAt });
                emitTrigger({ ...infoBase, blockedBy: 'ip', counts: { ip: ipRes.count } });
            }
            return res.status(429).json({ type: 'error', code: 'rate_limited', blockedBy: 'ip', ip, signature: sig });
        }

        if (!sigRes.ok) {
            return res.status(429).json({ type: 'error', code: 'rate_limited', blockedBy: 'signature', ip, signature: sig });
        }

        req.rateLimit = { ip, signature: sig };
        next();
    }

    middleware.onTrigger = (cb) => {
        if (typeof cb === 'function') callbacks.push(cb);
    };

    return middleware;
}
