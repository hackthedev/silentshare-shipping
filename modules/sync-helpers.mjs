import {extractHost} from "./helpers.mjs";
import {dbQuery} from "./sql.mjs";

export async function discoverHost(host){
    if(!host) return;

    // didnt know i could do that but cool
    let fetchResult = await (await fetch(`https://${extractHost(host)}/sync/discover`, {
        method: "GET"
    })).json();

    // lets do some basic
    if (fetchResult?.ok !== true) return // something happened, maybe ratelimit
    if (fetchResult?.host !== host) return // the host was either not set, incorrectly or was missing
    if (fetchResult?.whoami !== "silentshare") return // host is not a silentshare instance
    if (!fetchResult?.publicKey) return // host didnt provide his public key. makes it useless

    // it seems like the host is real and working, lets save it for future syncing
    await dbQuery(`INSERT IGNORE INTO servers (host, public_key, last_seen) VALUES (?,?,CURRENT_TIMESTAMP)`,
        [extractHost(host), fetchResult.publicKey])

}