import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import {rateLimit} from '../modules/ratelimit.mjs';
import {
    saveToDisk, getFileMeta, is_mime_allowed, getFileHash, MAX_USER_FILE_SIZE_BYTES, checkDuplicateFile
} from '../modules/upload.mjs';
import {getConfig, initConfig} from "../modules/config-handler.mjs";
import {requireAdmin} from "../modules/route-helpers.mjs";
import {dbQuery} from "../modules/sql.mjs";

import {extractHost} from "../modules/helpers.mjs";

initConfig();
let config = getConfig();
const storageDir = path.resolve(process.cwd(), config.upload.storage_dir);

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    ipLimit: config.upload.max_uploads_per_ip_minute,
    sigLimit: config.upload.max_uploads_per_minute,
    trustProxy: true
});

export async function addResource(resource, update = false) {

    let storage_type = "";
    if(extractHost(resource.host) === extractHost(config.host)){
        storage_type = "local"
    }
    else{
        storage_type = "remote";
    }

    const insertResourceSql = `
                INSERT IGNORE INTO resources
                (host, file_hash, hash_ref, size_bytes, storage_type, type, title, description, tags, copy_count, view_count,
                 report_count, download_count, created_at)
                VALUES (?, ?, ?, ?, '${storage_type}', ?, ?, NULL, NULL, 1, 0, 0, 0, CURRENT_TIMESTAMP)
                ${
                    update === true ?
                        `ON DUPLICATE KEY
                         UPDATE type = VALUES(type), title = VALUES(title)` 
                    : 
                        ""
                }
            `;

    await dbQuery(insertResourceSql, [resource.host, resource.file_hash, resource.hash_ref, resource.size_bytes, resource.type, resource.title]);
}


export async function handleUpload(req, res, isAdmin = false) {
    const file = req.file;
    if (!file) return res.status(400).json({ok: false, error: 'no file uploaded (field: file)'});

    if (typeof MAX_USER_FILE_SIZE_BYTES === 'number' && file.size > MAX_USER_FILE_SIZE_BYTES && !isAdmin) {
        return res.status(413).json({
            ok: false, error: 'file_too_large', limit_bytes: MAX_USER_FILE_SIZE_BYTES
        });
    }

    const host = config.host;
    const originalName = file.originalname || 'file';
    const sizeBytes = file.size ?? Buffer.byteLength(file.buffer ?? '');
    const mimeFromClient = file.mimetype || 'application/octet-stream';

    if (!is_mime_allowed(mimeFromClient) && !isAdmin) {
        return res.status(415).json({ok: false, error: 'mime_not_allowed', mime: mimeFromClient});
    }

    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // if file already exists cancel upload and return info
    let dup = null;
    try {
        dup = await checkDuplicateFile(hash);
        if (dup && dup.exists) {
            return res.status(200).json({
                ok: true,
                exists: true,
                message: 'file already exists locally',
                host: dup.db.host,
                file_hash: hash,
                size: dup.db.size_bytes,
                path: `/files/${dup.db.hash_ref}`
            });
        }
    } catch (err) {
        console.error('db check existing hash failed', err);
        return;
    }

    const ext = path.extname(originalName) || '';
    let filepath;

    try {
        filepath = await saveToDisk(storageDir, `${hash}${ext}`, file.buffer, {mode: 0o600});
    } catch (err) {
        if (err && err.code === 'QUOTA_EXCEEDED') {
            return res.status(413).json({ok: false, error: 'quota_exceeded'});
        }
        throw err;
    }

    const meta = await getFileMeta(filepath);

    try {
        await dbQuery('START TRANSACTION');

        if (dup && dup.db && dup.db.id) {
            // duplicate file. ignore
        } else {
            const fileType = meta.mime || 'application/octet-stream';
            const title = originalName;
            const hashRef = path.basename(filepath);

            // add resource
            await addResource({
                host: extractHost(host),
                file_hash: hash,
                hash_ref: hashRef,
                size_bytes: meta.sizebytes,
                type: fileType,
                title: title,
            });

        }

        await dbQuery('COMMIT');
    } catch (err) {
        try {
            await dbQuery('ROLLBACK');
        } catch (_) {
        }
        try {
            await fs.unlink(filepath).catch(() => {
            });
        } catch (_) {
        }
        throw err;
    }

    let hostDomain = extractHost(host);

    return res.json({
        ok: true,
        exists: false,
        hostDomain,
        file_hash: hash,
        size: meta.sizebytes,
        path: `/files/${path.basename(filepath)}`,
        mime: meta.mime,
        mime_allowed: meta.mime_allowed
    });
}

export default function registerUploadRoutes(app, deps) {
    const {asyncHandler, requireAuth} = deps;

    // setup per-user limit
    const multerOpts = {};
    if (typeof MAX_USER_FILE_SIZE_BYTES === 'number') {
        multerOpts.limits = {fileSize: MAX_USER_FILE_SIZE_BYTES};
    }
    const upload = multer({storage: multer.memoryStorage(), ...multerOpts});

    function multerMiddlewareSingle(field = 'file') {
        const mw = upload.single(field);
        return (req, res, next) => {
            mw(req, res, (err) => {
                if (!err) return next();
                if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FILE_COUNT')) {
                    return res.status(413).json({
                        ok: false, error: 'file_too_large', limit_bytes: MAX_USER_FILE_SIZE_BYTES || null
                    });
                }
                return next(err);
            });
        };
    }

    app.get('/user/upload', asyncHandler(async (req, res) => {
        const htmlPath = path.join(process.cwd(), 'public', 'upload.html');
        return res.sendFile(htmlPath);
    }));

    app.post('/upload', uploadLimiter, multerMiddlewareSingle('file'), asyncHandler(async (req, res) => {
        await handleUpload(req, res);
    }));
    app.post('/admin/upload', requireAuth, requireAdmin, multerMiddlewareSingle('file'), asyncHandler(async (req, res) => {
        await handleUpload(req, res, true);
    }));

}