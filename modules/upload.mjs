import fs from 'fs/promises';
import {createReadStream, constants as fsconstants} from 'fs';
import path from 'path';
import crypto from 'crypto';
import {getConfig, initConfig} from "./config-handler.mjs";
import {dbQuery} from "./sql.mjs";

initConfig();
const config = getConfig();

if (!config || !config.upload) {
    throw new Error('config.upload missing');
    process.exit(0)
}

const max_name_length = Number(config.upload.max_name_length ?? 240);
const filename_allowed_regex = new RegExp(String(config.upload.filename_allowed_regex ?? '[A-Za-z0-9_.\\-]'), 'g');

const ext_mime_map = new Map();
const allowed_mime_whitelist = new Set();

if (Array.isArray(config.upload.mimeTypes)) {
    for (const e of config.upload.mimeTypes) {
        if (!Array.isArray(e) || e.length < 3) continue;
        const ext = String(e[0]).toLowerCase();
        const mime = String(e[1]).toLowerCase();
        const allowed = Boolean(e[2]);
        ext_mime_map.set(ext, mime);
        if (allowed) {
            allowed_mime_whitelist.add(mime);
        }
    }
}


// max allowed upload folder size total
const max_allowed_upload_gb = Number(config.upload.max_allowed_upload_gb ?? NaN);
const default_gb = 10;
export const MAX_ALLOWED_UPLOAD_BYTES = Number.isFinite(max_allowed_upload_gb) && max_allowed_upload_gb >= 0
    ? Math.floor(max_allowed_upload_gb * 1024 * 1024 * 1024)
    : (typeof config.upload.max_allowed_upload === 'number'
        ? Number(config.upload.max_allowed_upload)
        : default_gb * 1024 * 1024 * 1024);

// per-user per-file max mb upload
export const MAX_USER_FILE_SIZE_BYTES = (typeof config.upload.max_user_file_size_mb === 'number' && config.upload.max_user_file_size_mb > 0)
    ? Math.floor(Number(config.upload.max_user_file_size_mb) * 1024 * 1024)
    : (typeof config.upload.max_user_file_size_bytes === 'number' ? Number(config.upload.max_user_file_size_bytes) : undefined);

export function safeFilename(name, {maxlength = max_name_length} = {}) {
    if (!name) return 'file';
    const base = path.basename(String(name));
    const ext = path.extname(base).toLowerCase();
    const nameonly = base.slice(0, base.length - ext.length);
    const normalized = String(nameonly)
        .normalize('NFKD')
        .replace(/[\u0300-\u036F]/g, '')
        .replace(/\s+/g, '_')
        .match(filename_allowed_regex)?.join('') || 'file';
    const truncated = normalized.slice(0, Math.max(1, maxlength - ext.length));
    return truncated + (ext || '');
}

function _streamHash(stream, hash) {
    return new Promise((resolve, reject) => {
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

export async function checkDuplicateFile(hash) {
    let storageDir = config.upload.storage_dir;

    const rows = await dbQuery(
        'SELECT id, host, hash_ref, size_bytes FROM resources WHERE file_hash = ? LIMIT 1',
        [hash]
    );

    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    const existingPath = path.join(storageDir, row.hash_ref);

    try {
        await fs.access(existingPath);
        return {
            exists: true,
            db: row,
            filepath: existingPath
        };
    } catch {
        return {
            exists: false,
            db: row,
            filepath: existingPath
        };
    }
}


export async function getFileHash(input, algorithm = 'sha256', encoding = 'hex') {
    if (!input) throw new TypeError('input required');
    const hash = crypto.createHash(algorithm);
    if (typeof input === 'string') {
        const stream = createReadStream(input);
        const result = await _streamHash(stream, hash);
        if (encoding === 'hex') return result;
        return Buffer.from(result, 'hex').toString(encoding);
    }
    if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
        hash.update(Buffer.from(input));
        return hash.digest(encoding);
    }
    if (input && typeof input.pipe === 'function') {
        const result = await _streamHash(input, hash);
        if (encoding === 'hex') return result;
        return Buffer.from(result, 'hex').toString(encoding);
    }
    throw new TypeError('input must be file path, Buffer, or readable stream');
}

export async function getFolderSize(dir) {
    if (!dir) throw new TypeError('dir required');
    const abs = path.resolve(dir);

    async function walk(p) {
        let total = 0;
        const items = await fs.readdir(p, {withFileTypes: true}).catch(() => []);
        for (const it of items) {
            const full = path.join(p, it.name);
            if (it.isDirectory()) total += await walk(full);
            else if (it.isFile()) {
                const st = await fs.stat(full).catch(() => null);
                if (st) total += st.size;
            }
        }
        return total;
    }

    return await walk(abs);
}

export async function saveToDisk(dir, originalname, buffer, {mode = 0o600} = {}) {
    if (!dir) throw new TypeError('dir required');
    if (!originalname) throw new TypeError('originalname required');
    if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array)) throw new TypeError('buffer required (Buffer or Uint8Array)');

    const absdir = path.resolve(dir);
    await fs.mkdir(absdir, {recursive: true});

    const used = await getFolderSize(absdir).catch(() => 0);
    const willUse = Buffer.byteLength(Buffer.from(buffer));
    if (typeof MAX_ALLOWED_UPLOAD_BYTES === 'number' && MAX_ALLOWED_UPLOAD_BYTES >= 0) {
        if (used + willUse > MAX_ALLOWED_UPLOAD_BYTES) {
            const err = new Error('storage quota exceeded');
            err.code = 'QUOTA_EXCEEDED';
            throw err;
        }
    }

    const safe = safeFilename(originalname);
    let filename = safe;
    let filepath = path.join(absdir, filename);
    let i = 0;

    while (true) {
        try {
            await fs.access(filepath, fsconstants.F_OK);
            i += 1;
            const nameOnly = path.basename(safe, path.extname(safe));
            const ext = path.extname(safe);
            filename = `${nameOnly}-${i}${ext}`;
            filepath = path.join(absdir, filename);
        } catch {
            break;
        }
    }

    await fs.writeFile(filepath, Buffer.from(buffer), {mode});
    return filepath;
}

export async function deleteFromDisk(filepath) {
    if (!filepath) throw new TypeError('filepath required');
    try {
        await fs.unlink(filepath);
        return true;
    } catch {
        return false;
    }
}

export function is_mime_allowed(mime) {
    if (!mime || typeof mime !== "string") return false;
    return allowed_mime_whitelist.has(mime.toLowerCase());
}


export async function getFileMeta(filepath, {hashalgo = 'sha256', hashencoding = 'hex'} = {}) {
    if (!filepath) throw new TypeError('filepath required');
    const abs = path.resolve(filepath);
    const st = await fs.stat(abs);
    if (!st || !st.isFile()) throw new Error('file not found');

    const filename = path.basename(abs);
    const ext = path.extname(filename).toLowerCase();
    const sizebytes = st.size;
    const kbsize = Number((sizebytes / 1024).toFixed(2));
    const mime = ext_mime_map.get(ext) || "application/octet-stream";
    const mime_allowed = is_mime_allowed(mime);
    const hash = await getFileHash(abs, hashalgo, hashencoding);

    return {
        ext,
        filename,
        path: abs,
        sizebytes,
        kbsize,
        hash,
        mime,
        mime_allowed
    };
}
