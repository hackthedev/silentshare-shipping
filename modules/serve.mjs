import {dbQuery} from "./sql.mjs";
import Logger from "./logger.mjs";
import {pipeline} from "stream/promises";
import path from "path";
import fs from "fs";

export function isValidHash(h) {
    return typeof h === 'string' && /^[a-fA-F0-9]{64}$/.test(h);
}


const normalizeSize = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') {
        const s = v.endsWith('n') ? v.slice(0, -1) : v;
        return s === '' ? null : Number(s);
    }
    return Number(v);
};

export async function listResources(lastId = 0, limit = 500) {
    // sanitize inputs
    lastId = Number(lastId) || 0;
    limit = Math.min(Math.max(Number(limit) || 500, 1), 500);

    // fetch one extra row to detect more data
    const fetchLimit = limit + 1;

    const rows = await dbQuery(`SELECT *
                                FROM resources
                                WHERE id > ?
                                AND status = 'verified'
                                ORDER BY id DESC
                                LIMIT ?`, [lastId, fetchLimit]);

    if (!Array.isArray(rows) || rows.length === 0) {
        return {items: [], more_data: false, next_last_id: lastId};
    }

    // detect more_data and trim fetched rows to the actual payload
    const more_data = rows.length === fetchLimit;
    const usedRows = more_data ? rows.slice(0, -1) : rows; // drop the extra row if present

    // group by file_hash
    const map = new Map();
    for (const r of usedRows) {
        const fh = r.file_hash;
        if (!fh) continue;

        if (!map.has(fh)) {
            map.set(fh, {
                file_hash: fh,
                hash_ref: r.hash_ref || null,
                type: r.type || null,
                title: r.title || null,
                description: r.description || null,
                size_bytes: (function (v) { // inline normalizeSize
                    if (v === null || v === undefined) return null;
                    if (typeof v === 'bigint') return Number(v);
                    if (typeof v === 'string') {
                        const s = v.endsWith('n') ? v.slice(0, -1) : v;
                        return s === '' ? null : Number(s);
                    }
                    return Number(v);
                })(r.size_bytes),
                hosts: [],
                _hostSet: new Set()
            });
        }

        const entry = map.get(fh);
        // push host only once
        if (r.host && !entry._hostSet.has(r.host)) {
            entry._hostSet.add(r.host);
            entry.hosts.push(r.host);
        }

        // if we dont yet have hash_ref/size_bytes and this row provides it, set it
        if (!entry.hash_ref && r.hash_ref) entry.hash_ref = r.hash_ref;
        if ((entry.size_bytes === null || entry.size_bytes === undefined) && r.size_bytes != null) {
            // normalize again
            entry.size_bytes = (function (v) {
                if (v === null || v === undefined) return null;
                if (typeof v === 'bigint') return Number(v);
                if (typeof v === 'string') {
                    const s = v.endsWith('n') ? v.slice(0, -1) : v;
                    return s === '' ? null : Number(s);
                }
                return Number(v);
            })(r.size_bytes);
        }
    }

    // prepare final items
    const items = Array.from(map.values()).map(it => {
        delete it._hostSet;
        return it;
    });

    // index = max id from usedRows, or lastId if none
    const index = usedRows.reduce((acc, r) => Math.max(acc, Number(r.id || 0)), lastId);

    return {
        items, more_data, index
    };
}

export async function searchHashes(fileHash) {
    const rows = await dbQuery(`SELECT *
                                FROM resources 
                                WHERE file_hash = ?
                                  AND (status = 'verified' OR status = 'unlisted') 
                                ORDER BY host`, [fileHash]);

    if (!Array.isArray(rows) || rows.length === 0) return null;

    const first = rows[0];
    const result = {
        file_hash: first.file_hash,
        hash_ref: first.hash_ref,
        type: first.type || null,
        title: first.title || null,
        description: first.description || null,
        size_bytes: normalizeSize(first.size_bytes),
        hosts: []
    };

    const seenHosts = new Set();
    for (const r of rows) {
        if (!r.host || seenHosts.has(r.host)) continue;
        seenHosts.add(r.host);
        result.hosts.push(r.host);
    }

    return result;
}

export async function streamFileAttempt(filePath, resObj, opts) {
    try {
        return await streamFileFromPath(filePath, resObj, opts);
    } catch (e) {
        return false;
    }
}

export async function checkRemoteResource(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const upstream = await fetch(url, {
            method: 'GET', signal: controller.signal, redirect: 'follow'
        });
        clearTimeout(timer);
        Logger.debug(`checkRemoteResource ${url} -> ${upstream.status}`);
        return upstream?.ok === true;
    } catch (e) {
        clearTimeout(timer);
        Logger.warn("Unable to retrieve remote resource " + url);
        Logger.debug(e && e.stack ? e.stack : String(e));
        return false;
    }
}

export async function streamFileFromPath(filePath, res, opts = {}) {
    const {
        rangeHeader,
        filename = path.basename(filePath),
        contentType = "application/octet-stream",
        download = false
    } = opts;

    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) return false;

    const total = stat.size;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-transform");

    const makeReadStream = (start, end) => {
        const rs = fs.createReadStream(filePath, (start !== undefined && end !== undefined) ? {start, end} : undefined);
        res.on('close', () => {
            try {
                rs.destroy();
            } catch (_) {
            }
        });
        return rs;
    };

    try {
        if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

            if (isNaN(start) || isNaN(end) || start > end || start >= total) {
                res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
                return true;
            }

            const expectedLen = end - start + 1;
            res.status(206);
            res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
            res.setHeader("Content-Length", String(expectedLen));

            if (typeof res.flushHeaders === 'function') res.flushHeaders();
            const rs = makeReadStream(start, end);
            await pipeline(rs, res);
            return true;
        } else {
            const chunkSize = 5 * 1024 * 1024;
            const end = Math.min(total - 1, chunkSize - 1);

            res.status(206);
            res.setHeader("Content-Range", `bytes 0-${end}/${total}`);
            res.setHeader("Content-Length", String(end + 1));

            if (typeof res.flushHeaders === 'function') res.flushHeaders();
            const rs = makeReadStream(0, end);
            await pipeline(rs, res);
            return true;
        }
    } catch (err) {
        const s = String(err || '').toLowerCase();
        if (s.includes('premature close') || s.includes('err_stream_premature_close') || s.includes('client aborted') || s.includes('aborted')) {
            return true;
        }
        Logger.warn("streamFileFromPath failed: " + String(err));
        try {
            res.destroy();
        } catch (_) {
        }
        return false;
    }
}

export async function fetchAndPipeRemote(url, req, res, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = {};
        if (req.headers.range) headers.range = req.headers.range;
        if (req.headers['user-agent']) headers['user-agent'] = req.headers['user-agent'];

        const upstream = await fetch(url, {
            method: 'GET', headers, signal: controller.signal, redirect: 'follow'
        });
        clearTimeout(timer);

        if (!upstream.ok) {
            Logger.debug(`fetchAndPipeRemote: upstream ${url} returned ${upstream.status}`);
            return false;
        }

        const forwardHdrs = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control'];
        for (const h of forwardHdrs) {
            const v = upstream.headers.get(h);
            if (v) res.setHeader(h, v);
        }
        res.setHeader('Cache-Control', 'no-transform');

        const cr = upstream.headers.get('content-range');
        const cl = upstream.headers.get('content-length');
        if (cr) {
            const m = cr.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
            if (!m) {
                Logger.warn(`Invalid content-range from upstream: ${cr} for ${url}`);
                return false;
            }
            const expectedLen = Number(m[2]) - Number(m[1]) + 1;
            if (cl && Number(cl) !== expectedLen) {
                Logger.warn(`Content-Length mismatch: upstream content-length=${cl} expected=${expectedLen} for ${url}`);
                return false;
            }
        }

        res.status(upstream.status);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        const body = upstream.body;
        if (!body) return false;

        if (typeof body.pipe === 'function') {
            res.on('close', () => {
                try {
                    body.destroy();
                } catch (_) {
                }
            });
            try {
                await pipeline(body, res);
                return true;
            } catch (e) {
                const s = String(e || '').toLowerCase();
                if (s.includes('premature close') || s.includes('err_stream_premature_close') || s.includes('client aborted') || s.includes('aborted')) {
                    return true;
                }
                Logger.warn("fetchAndPipeRemote pipeline failed for " + url + " -> " + String(e));
                try {
                    res.destroy();
                } catch (_) {
                }
                return false;
            }
        }

        if (typeof body.getReader === 'function') {
            const reader = body.getReader();
            res.on('close', () => {
                try {
                    reader.cancel();
                } catch (_) {
                }
            });
            try {
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    if (value) res.write(Buffer.from(value));
                }
                res.end();
                return true;
            } catch (e) {
                const s = String(e || '').toLowerCase();
                if (s.includes('premature close') || s.includes('err_stream_premature_close') || s.includes('client aborted') || s.includes('aborted')) {
                    return true;
                }
                try {
                    res.destroy();
                } catch (_) {
                }
                return false;
            }
        }

        return false;
    } catch (e) {
        clearTimeout(timer);
        const s = String(e || '').toLowerCase();
        if (s.includes('premature close') || s.includes('err_stream_premature_close') || s.includes('client aborted') || s.includes('aborted')) {
            return true;
        }
        Logger.warn("fetchAndPipeRemote failed for " + url + " -> " + String(e));
        try {
            res.destroy();
        } catch (_) {
        }
        return false;
    }
}
