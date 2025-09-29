import path from "path";
import {deleteFromDisk} from "../../modules/upload.mjs";
import Logger from "../../modules/logger.mjs";
import {generateOneTimeToken, verifyOneTimeToken} from "../../modules/ott.mjs";
import {isAuth, isAdmin} from "../../modules/auth-helpers.mjs";
import {isValidHash} from "../../modules/serve.mjs";
import {getConfig, initConfig} from "../../modules/config-handler.mjs";

import {streamFileFromPath} from "../../modules/serve.mjs";
import {getFirstRow} from "../../modules/sql.mjs";
import {syncSingleResource} from "../../modules/jobs/syncServerData.mjs";

initConfig();
let config = getConfig();

export default function registerRoute(app, deps) {
    const {pool, asyncHandler, signToken, dbQuery, requireAuth, requireAdmin} = deps;

    app.get('/dashboard/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
        const htmlPath = path.join(process.cwd(), 'public', 'dashboard.html');
        return res.sendFile(htmlPath);
    }))

    app.get('/admin/resources{/:index}', requireAuth, requireAdmin, async (req, res) => {
        let {index} = req.params;
        const rows = await dbQuery('SELECT * FROM resources WHERE id > ? ORDER BY created_at DESC LIMIT 100', [index || 0]);
        res.json({ok: true, rows});
    });

    app.post('/admin/file/ott/create/', async (req, res) => {
        if (!await isAuth(req)) return res.status(401).json({ok: false, error: "Unauthorized"});
        if (!await isAdmin(req)) return res.status(403).json({ok: false, error: "Forbidden"});

        res.status(200).json({ok: true, ott: generateOneTimeToken()});
    });

    app.get('/admin/file/:hash/:ott', asyncHandler(async (req, res) => {
        const {hash, ott} = req.params;

        if (!verifyOneTimeToken(ott)) {
            return res.status(403).json({ok: false, error: "Invalid OTT"});
        }
        if (!isValidHash(hash)) {
            return res.status(400).json({ok: false, error: 'Invalid Hash'});
        }

        const q = await dbQuery(`
            SELECT *
            FROM resources
            WHERE file_hash = ? AND host = ?
            LIMIT 1
        `, [hash, config.host]);

        const entry = Array.isArray(q) ? q[0] : (q?.rows?.[0] ?? q);
        if (!entry || !entry.hash_ref) {
            return res.status(404).json({ok: false, error: 'not_found'});
        }

        const filePath = path.join(config.upload.storage_dir, entry.hash_ref);
        const rangeHeader = req.headers.range;
        const download = req.query.download === '1' || req.query.download === 'true';

        const ok = await streamFileFromPath(filePath, res, {
            rangeHeader, contentType: entry.type || 'application/octet-stream', download
        });

        if (res.headersSent) {
            if (!ok) Logger.warn("Stream failed after headers sent.");
            return;
        }

        if (!ok) {
            return res.status(500).json({ok: false, error: 'stream_failed'});
        }
    }));


    app.get('/admin/events', requireAuth, requireAdmin, async (req, res) => {
        const rows = await dbQuery('SELECT id, msg_hash, origin_host, origin_sig, type, forward, payload, status, created_at, received_at FROM events ORDER BY created_at DESC LIMIT 2000');
        res.json({ok: true, rows});
    });

    app.get('/admin/event-deliveries', requireAuth, requireAdmin, async (req, res) => {
        const rows = await dbQuery('SELECT * FROM event_deliveries ORDER BY delivered_at DESC LIMIT 1000');
        res.json({ok: true, rows});
    });

    app.post('/admin/resources/:id/:action{/:value}', requireAuth, requireAdmin, async (req, res) => {
        const allowedStatus = ["verified", "pending", "deleted", "unlisted", "blocked"];
        const {id, action, value} = req.params;

        if (action === "changeStatus" && value) {
            if (!allowedStatus.includes(value)) {
                return res.status(400).json({ok: false, error: "invalid_status"});
            }

            await dbQuery('UPDATE resources SET status = ? WHERE id = ?', [value, id]);
            return res.json({ok: true});
        }

        if (action === "resync" && id) {
            let syncResult = await syncSingleResource(id)

            if(syncResult?.ok === true){
                return res.status(200).json({ok: true});
            }
            else {
                return res.status(400).json({ok: false, error: syncResult?.error});
            }
        }

        if (action === "delete" && value) {
            try {
                await dbQuery("START TRANSACTION");

                // lets get info first
                const fileInfo = await dbQuery(`SELECT hash_ref, file_hash, storage_type
                                                FROM resources
                                                WHERE file_hash = ?`, [value]);
                // then delete it lol
                await dbQuery(`DELETE FROM resources WHERE file_hash = ? `, [value]);
                const row = getFirstRow(fileInfo)

                // if we host it, delete it from fs
                if (row?.hash_ref && row?.storage_type === "local") {
                    let deleted = await deleteFromDisk(path.join(config.upload.storage_dir, row.hash_ref));

                    if(deleted){
                        await dbQuery("COMMIT");
                        return res.status(200).json({ok: true});
                    }
                    else{
                        await dbQuery("ROLLBACK");
                        return res.status(500).json({ok: false, error: "File not found or deleted"});
                    }
                }
                else if(row?.storage_type === "remote"){
                    // file aint local
                    await dbQuery("COMMIT");
                }
            } catch (e) {
                Logger.error(e);
                await dbQuery("ROLLBACK");
                return res.status(500).json({ok: false, error: "Unexpected Server error"});
            }
        }

        if (action === "updateTitle" && req.body.title) {
            await dbQuery('UPDATE resources SET title = ? WHERE id = ?', [req.body.title, id]);
            return res.status(200).json({ok: true});
        }

        Logger.warn("Unkown action " + action + ` (${value})`)
        return res.status(400).json({ok: false, error: "unknown_action"});
    });

}
