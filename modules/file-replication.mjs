import {dbQuery, getFirstRow} from "./sql.mjs";
import {getConfig, initConfig} from "./config-handler.mjs";
import ping from "ping";
import { promises as fs } from "fs";
import Logger from "./logger.mjs";
import path from "path";

import { dSyncSign } from "@hackthedev/dsync-sign";
const signer = new dSyncSign();

initConfig();
let config = getConfig();

async function pingHost(host) {
    const res = await ping.promise.probe(host);
    if (res.alive) {
        return parseFloat(res.time);
    } else {
        return null;
    }
}

export async function checkFileReplication(file_hash){
    if(config.sync.files.enabled !== true){
        Logger.debug("File syncing turned off")
        return;
    }

    Logger.info(`Checking file ${file_hash}`);

    let allServersRow = await dbQuery(`SELECT COUNT(id) AS total FROM servers`, []);
    let allHostsRow = await dbQuery(`SELECT DISTINCT host FROM resources WHERE file_hash= ?`, [file_hash]);

    // ping check hosts first and filter
    const checkedHosts = [];

    for (let hostObj of allHostsRow) {
        const latency = await pingHost(hostObj.host);

        if (latency && latency < config.sync.files.pingLimitMs) {
            checkedHosts.push({ ...hostObj, latency });
        }
    }
    allHostsRow = checkedHosts;


    let serverCount = Number((getFirstRow(allServersRow)).total);
    let fileHostCount = allHostsRow.length;

    // % of how many servers in the known network replicated the file
    let coveragePercent = ((fileHostCount / serverCount) * 100).toFixed(0);

    // if the coverage is smaller then the max coverage in the config
    if(coveragePercent <= config.sync.files.networkCoveragePercent){
        return { shouldReplicate: true, coverage: coveragePercent };
    }
    else{
        return { shouldReplicate: false, coverage: coveragePercent };
    }
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function downloadFile(host, fileHash, destPath) {
    if(host === config.host) return;

    const fileInfo = `https://${host}/file/${fileHash}/json`;
    const infoRes = await fetch(fileInfo);
    if(!infoRes.ok){
        Logger.error(`HTTP ${infoRes.status} while trying to get info ${fileInfo}`);
        return;
    }

    let fileJson = await infoRes.json();

    let file_size = (fileJson?.size_bytes / 1024 / 1024).toFixed(2); // to mb
    let file_hash = fileJson?.file_hash;
    let hash_ref = fileJson?.hash_ref;

    // check if file already exists
    if(await fileExists(path.join(destPath, hash_ref))){
        return;
    }

    let publicKeyRow = await dbQuery("SELECT public_key FROM servers WHERE host = ?", [host])
    let publicKey = (getFirstRow(publicKeyRow))?.public_key;

    // unkown host??
    if(!publicKey){
        return;
    }

    let isValid = await signer.verifyJson(fileJson, publicKey);

    // todo: penalty. source is not trusted anymore.
    if(!isValid){
        return;
    }

    // if the file size is too big
    if(file_size >= config.sync.files.max_size_mb){
        return;
    }

    // todo: penalty!!! should never happen
    if(file_hash !== fileHash){
        return;
    }

    Logger.info(`Downloading file ${file_hash}`);

    const url = `https://${host}/file/${fileHash}/download`;
    const res = await fetch(url);
    if (!res.ok) {
        Logger.error(`HTTP ${res.status} while trying to download ${url}`);
        return;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    await fs.writeFile(path.join(destPath, hash_ref), buf);

    Logger.success(`Downloaded file ${file_hash}`);

    return path.join(destPath, hash_ref);
}