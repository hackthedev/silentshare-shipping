import {checkConfigAdditions, getConfig, initConfig} from "./modules/config-handler.mjs";

console.clear();

import {pathToFileURL} from "node:url";
import express from "express";
import {fileURLToPath} from "url";
import path from "path";

const app = express();
import fs from "node:fs";

import {dbQuery, initSchema, pool} from "./modules/sql.mjs";
import {asyncHandler, requireAuth, requireAdmin} from "./modules/route-helpers.mjs";
import {handleTerminalCommands, sanitizeForJson, signToken} from "./modules/helpers.mjs";
import {isAdmin, isAuth} from "./modules/auth-helpers.mjs";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

import readline from "node:readline";
import {doSyncJob} from "./modules/jobs/syncServerData.mjs";
import Logger from "./modules/logger.mjs";
import {registerTemplateMiddleware} from "./modules/template.mjs";

import dSync from "@hackthedev/dsync";
export let sync = new dSync("silentshare", app)

export function promptTerminal(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    return new Promise((resolve) => {
        rl.question(`${question} : `, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

process.on('uncaughtException', function (err) {

    // Handle the error safely
    Logger.error("UNEXPECTED ERROR");
    Logger.error(err.message);
    Logger.error("Details: ");
    Logger.error(err.stack);
})


await initSchema();

initConfig();
let config = getConfig();
checkConfigAdditions(config)

export const port = config?.port || 3000

registerTemplateMiddleware(app, __dirname, fs, path)

app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(express.static(__dirname + '/public'));


app.use((req, res, next) => {
    const _json = res.json.bind(res);
    res.json = (body) => _json(sanitizeForJson(body));
    next();
});


// need to improve after testing to load both routes and syncs
async function loadRouteFiles(dir = path.join(__dirname, "routes")) {
    async function walk(current) {
        const entries = await fs.promises.readdir(current, {withFileTypes: true}).catch(() => []);
        for (const ent of entries) {
            const full = path.join(current, ent.name);
            if (ent.isDirectory()) {
                await walk(full);
                continue;
            }
            if (!ent.isFile()) continue;
            if (!(/\.(js|mjs)$/i).test(ent.name)) continue;
            if (ent.name.includes("template")) continue;

            try {
                const mod = await import(pathToFileURL(full).toString());
                if (typeof mod.default === "function") {
                    mod.default(app, {
                        dbQuery,
                        pool,
                        asyncHandler,
                        requireAuth,
                        requireAdmin,
                        isAuth,
                        isAdmin,
                        signToken,
                        sanitizeForJson,
                    });
                }
            } catch (err) {
                console.error("Failed to load route:", full, err);
            }
        }
    }

    await walk(dir);
}

async function loadSyncEvents(dir = path.join(__dirname, "modules\\syncs")) {
    async function walk(current) {
        const entries = await fs.promises.readdir(current, {withFileTypes: true}).catch(() => []);
        for (const ent of entries) {
            const full = path.join(current, ent.name);
            if (ent.isDirectory()) {
                await walk(full);
                continue;
            }
            if (!ent.isFile()) continue;
            if (!(/\.(js|mjs)$/i).test(ent.name)) continue;
            if (ent.name.includes("template")) continue;

            try {
                const mod = await import(pathToFileURL(full).toString());
                if (typeof mod.default === "function") {
                    mod.default(sync, {
                        dbQuery,
                        pool,
                        isAuth,
                        isAdmin,
                        signToken,
                        sanitizeForJson,
                    });
                }
            } catch (err) {
                console.error("Failed to load syncs:", full, err);
            }
        }
    }

    await walk(dir);
}


await loadRouteFiles();
await loadSyncEvents();

app.use((req, res) => {
    res.status(404).json({ok: false, error: "Not Found"});
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (text) {
    var data = text.trim();

    var args = data.split(" ");
    var command = args[0];

    handleTerminalCommands(command, args);
});

doSyncJob(config.sync.interval.minutes * 60_000, true)


