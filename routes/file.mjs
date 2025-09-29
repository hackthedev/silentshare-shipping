import path from 'path';
import {getConfig, initConfig} from "../modules/config-handler.mjs";
import {
    streamFileFromPath,
    isValidHash,
    fetchAndPipeRemote,
    checkRemoteResource,
    streamFileAttempt,
    searchHashes,
    listResources
} from "../modules/serve.mjs";
import Logger from "../modules/logger.mjs";
import {requireAdmin, requireAuth} from "../modules/route-helpers.mjs";
import {rateLimit} from "../modules/ratelimit.mjs";
import {enableCors} from "../modules/cors-helper.mjs";
import {extractHost} from "../modules/helpers.mjs";
import {signJson, verifyJson} from "../modules/sign-helper.mjs";
import {getPublicKey} from "../modules/crypt.mjs";
import {discoverHost} from "../modules/sync-helpers.mjs";

initConfig();
const config = getConfig();

const fileRequestLimiter = rateLimit({
    windowMs: config.rateLimits.fileRequests.timestpan, // 1 minute
    ipLimit: config.rateLimits.fileRequests.per_ip_limit, // ~ 16 req/s
    sigLimit: config.rateLimits.fileRequests.total_limit, // 2000 req/s
    trustProxy: true
});


fileRequestLimiter.onTrigger(async (info) => {
    let ip = info.ip;
    let method = info.method;
    let path = info.path;
    let referer = info.referer;
    let blockedBy = info.blockedBy;

    if (blockedBy === "ip") {
        Logger.space();
        Logger.warn(Logger.colors.blink + Logger.colors.underscore + "========== ANTI ABUSE RATE LIMIT ==========")
        Logger.warn(Logger.colors.blink + `IP ${ip} has reached the rate limit of ${config.rateLimits.fileRequests.per_ip_limit / 60} req/s !`)
        Logger.warn(Logger.colors.blink + `Target URL (${method}): ${path} `)
        Logger.warn(info, Logger.colors.fgYellow + Logger.colors.blink)
        Logger.space()
    }
});

export default function registerRoute(app, deps) {
    const {dbQuery, asyncHandler} = deps;

    app.get("/resources{/:host}{/:index}", enableCors(), fileRequestLimiter, asyncHandler(async (req, res) => {
        const {index, host} = req.params;

        // get resource list and sign it!!
        let resourceList = await listResources(index, 100);

        let payload = {ok: true, items: resourceList.items, more_data: resourceList.more_data, index: resourceList.index};
        await signJson(payload)

        // the server seems to be real so lets show our resources
        res.status(200).json(payload);

        // if the requester is a host instance lets see if they are legit and add them
        // these requests can also be send by a client, which isnt really that bad honestly
        // as it will help discover servers.
        if (host) {
            // discover host
            discoverHost(host);
        }
    }));

    app.get('/file/:hash{/:option}', enableCors(), fileRequestLimiter, asyncHandler(async (req, res) => {
        const {hash, option} = req.params;

        let download = false;
        let json = false;
        if (option) {
            if (option === "download") download = true;
            if (option === "json") json = true;
        }

        if (!isValidHash(hash)) return res.status(400).json({ok: false, error: 'invalid_hash'});

        let hostsCollection = await searchHashes(hash);
        if (!hostsCollection) return res.status(404).json({ok: false, error: 'not_found'});

        for (const host of [...hostsCollection.hosts]) {
            const isHost = (host === config.host);
            const rangeHeader = req.headers.range;
            const timeoutMs = 5000;

            if (download) {
                if (isHost) {
                    if (!hostsCollection.hash_ref) {
                        Logger.debug(`file route: host ${host} removed — no hash_ref`);
                        hostsCollection.hosts = hostsCollection.hosts.filter(h => h !== host);
                        continue;
                    }

                    const ok = await streamFileFromPath(
                        path.join(config.upload.storage_dir, hostsCollection.hash_ref),
                        res,
                        {rangeHeader, timeoutMs, contentType: hostsCollection.type, download: true}
                    );

                    if (res.headersSent) {
                        Logger.debug(`file route: response already started for host ${host}, exiting handler`);
                        return;
                    }

                    if (ok) {
                        return;
                    }

                    Logger.warn(`file route: local stream failed for host ${host}, removing host`);
                    hostsCollection.hosts = hostsCollection.hosts.filter(h => h !== host);
                    continue;
                }
                const okRemote = await fetchAndPipeRemote(
                    `https://${extractHost(host)}/file/${hostsCollection.file_hash}`, req, res, timeoutMs);


                if (okRemote.headersSent) {
                    Logger.debug(`file route: proxy started/finished for host ${host}, exiting handler`);
                    return;
                }

                if (okRemote) {
                    return;
                }

                Logger.warn(`file route: remote fetch failed for host ${host}, removing host`);
                hostsCollection.hosts = hostsCollection.hosts.filter(h => h !== host);

            } else {
                if (isHost) {
                    if (json) {
                        let payload = {ok: true, ...hostsCollection}
                        await signJson(payload);
                        return res.status(200).json(payload);
                    }

                    if (!hostsCollection.hash_ref) {
                        Logger.debug(`file route: host ${host} removed — no hash_ref`);
                        hostsCollection.hosts = hostsCollection.hosts.filter(h => h !== host);
                        continue;
                    }

                    const ok = await streamFileFromPath(
                        path.join(config.upload.storage_dir, hostsCollection.hash_ref),
                        res,
                        {rangeHeader, timeoutMs, contentType: hostsCollection.type, download: false}
                    );

                    if (res.headersSent) {
                        Logger.debug(`file route: preview stream started for host ${host}, exiting handler`);
                        return;
                    }

                    if (ok) return;

                    Logger.warn(`file route: preview stream failed for host ${host}, removing host`);
                    hostsCollection.hosts = hostsCollection.hosts.filter(h => h !== host);
                    continue;
                }

                const remoteOnline = await checkRemoteResource(`https://${extractHost(host)}/file/${hostsCollection.file_hash}`, timeoutMs);

                if (remoteOnline.headersSent) {
                    Logger.debug(`file route: remote reachability check for ${host} caused response; exiting`);
                    return;
                }

                if (!remoteOnline) {
                    Logger.debug(`file route: remote host ${host} not reachable, removing`);
                    hostsCollection.hosts = hostsCollection.hosts.filter(h => h !== host);
                }
            }
        }

        if (hostsCollection?.hosts?.length > 0) {
            return res.status(200).json({ok: true, ...hostsCollection});
        }

        return res.status(502).json({ok: false, error: 'no_reachable_host'});
    }));
}