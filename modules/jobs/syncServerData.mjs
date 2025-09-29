import {dbQuery, getFirstRow} from "../sql.mjs";
import {extractHost} from "../helpers.mjs";
import {getConfig, initConfig} from "../config-handler.mjs";
import {verifyJson} from "../sign-helper.mjs";
import {discoverHost} from "../sync-helpers.mjs";
import {addResource} from "../../routes/upload.mjs";
import Logger from "../logger.mjs";

initConfig();
let config = getConfig();

export async function doSyncJob(interval, initial = false) {

    if (initial) {
        await syncResources()
        await doSyncJob(interval)
    } else {
        setInterval(async function () {
            await syncResources()
        }, interval)
    }
}

export async function syncSingleResource(id){
    // needed to check who is hosting the file and which file
    let storedResourceRow = await dbQuery(`SELECT host, file_hash, storage_type FROM resources WHERE id = ?`, [id]);
    let storedResourceData = getFirstRow(storedResourceRow);

    if(storedResourceData?.storage_type === "local"){
        return {ok: false, error: "The resource was local and cannot be synced with yourself"};
    }

    // then we fetch the host's current data about it
    let hostResources = await (await fetch(`https://${extractHost(storedResourceData?.host)}/file/${storedResourceData?.file_hash}/json`)).json();

    // then we need to fetch the public key of the host.
    // we cant ever trust a public key from a response to verify a signature
    let storedServerRow = await dbQuery(`SELECT public_key FROM servers WHERE host = ?`, [storedResourceData?.host])
    let storedServerData = getFirstRow(storedServerRow);

    if(hostResources?.ok === true){
        // lets verify the data and origin
        let isValid = await verifyJson(hostResources, storedServerData?.public_key);

        // data legit comes from host
        if(isValid === true){

            if(hostResources.hash_ref &&
                hostResources.size_bytes &&
                hostResources.type &&
                hostResources.title &&
                hostResources.file_hash){

                // oh shit holy crap!
                if(storedResourceData.file_hash !== hostResources.file_hash){
                    // todo: create penalty
                    // the problem here is that a remote host should've never returned a ok response with the wrong hash
                    // possibly a bad actor trying to sync wrong information!!
                    Logger.warn(`The stored resource hash doesnt fit the new, synced hash from ${extractHost(storedResourceData?.host)} anymore!`);
                    return;
                }

                await addResource({
                    host: extractHost(storedResourceData?.host),
                    file_hash: hostResources.file_hash,
                    hash_ref: hostResources.hash_ref,
                    size_bytes: hostResources.size_bytes,
                    type: hostResources.type,
                    title: hostResources.title,
                }, true);

                return {ok: true, error: null};
            }
        }
        else{
            // todo: create penalty
            // if the resource is a remote host and the publickey isnt valid anymore its a bad sign and possible takeover
            // hosts usually need to announce that they will change key with the old key
            Logger.warn(`Couldnt sync resource ${id} with server ${extractHost(storedResourceData?.server)} because signature failed`);
            return {ok: false, error: "Signature wasnt valid!"};
        }
    }
    else{
        return hostResources;
    }
}

export async function syncResources(targetHost, index) {
    let hostToSync = null;

    if (!targetHost) {
        hostToSync = await dbQuery(`
            SELECT * FROM servers 
            WHERE last_sync IS NULL 
            OR last_sync < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? minute) ORDER BY last_sync LIMIT 1`, [config.sync.interval])
    }
    else{
        hostToSync = await dbQuery(`
            SELECT * FROM servers 
            WHERE host = ? LIMIT 1`, [extractHost(targetHost)]);
    }


    let hostServerData = getFirstRow(hostToSync);

    let host = targetHost ? targetHost : extractHost(hostServerData?.host);
    if (!host) return; // host is unkown

    let hostResources = await (await fetch(`https://${host}/resources/${config.host}/${index ? index : ""}`)).json();
    if (hostResources?.ok === true) {

        // sync host resources
        if (hostResources?.items?.length > 0) {
            let resources = hostResources?.items;
            let hostSig = hostResources?.sig;
            let hostPublicKey = hostServerData.public_key;
            let isValid = await verifyJson(hostResources, hostPublicKey);

            // the list is verified and legit
            // it doesnt mean that it doesnt contain bad shit
            if (isValid === true) {

                for( const resource of resources) {

                    // if there is a new host we can try to discover it to
                    // sync with it later as well
                    resource.hosts.forEach(host => {
                        // we dont wanna add ourself etc
                        if(extractHost(host) !== extractHost(config.host)) {
                            discoverHost(extractHost(host))
                        }
                    })

                    // fockin' add dat resource biatch
                    await addResource({
                        host: extractHost(host),
                        file_hash: resource.file_hash,
                        hash_ref: resource.hash_ref,
                        size_bytes: resource.size_bytes,
                        type: resource.type,
                        title: resource.title,
                    });
                }

                await dbQuery(`UPDATE servers SET last_sync = CURRENT_TIMESTAMP WHERE host = ?`, [extractHost(host)]);
            }
        }
    }
}