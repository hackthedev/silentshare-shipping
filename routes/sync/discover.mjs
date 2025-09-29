import {rateLimit} from "../../modules/ratelimit.mjs";
import {listResources} from "../../modules/serve.mjs";
import {getConfig, initConfig} from "../../modules/config-handler.mjs";
import {getPublicKey} from "../../modules/crypt.mjs";

const discoverLimiter = rateLimit({
    windowMs: 60_000,
    ipLimit: 4,
    sigLimit: 60_000,
    trustProxy: true
});

initConfig();
let config = getConfig()

export default function registerRoute(app, deps) {
    const { pool, asyncHandler, signToken, dbQuery, requireAuth, requireAdmin } = deps;

    app.get("/sync/discover", discoverLimiter, asyncHandler(async (req, res) => {
        return res.status(200).json({ok: true, host: config.host, publicKey: await getPublicKey(), whoami: "silentshare"});
    }));
}
