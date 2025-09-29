import fs from "node:fs";

export var config = {}

export function initConfig(){
    if(!fs.existsSync("./config.json")){
        if(fs.existsSync("./config.json.example")){
            fs.cpSync("./config.json.example", "./config.json")
        }
        else{
            fs.writeFileSync("./config.json", "{}");
        }
    }

    config = JSON.parse(fs.readFileSync("./config.json", {encoding: "utf-8"}));
}

export function getConfig(){
    return config;
}

export function saveConfig(config){
    fs.writeFileSync("./config.json",JSON.stringify(config, null, 2));
}

export function checkObjectKeys(obj, path, defaultValue) {
    const keys = path.split('.');

    function recursiveCheck(currentObj, keyIndex) {
        const key = keys[keyIndex];

        if (key === '*') {
            for (const k in currentObj) {
                if (currentObj.hasOwnProperty(k)) {
                    recursiveCheck(currentObj[k], keyIndex + 1);
                }
            }
        } else {
            if (!(key in currentObj)) {
                currentObj[key] = (keyIndex === keys.length - 1) ? defaultValue : {};
            }
            if (keyIndex < keys.length - 1) {
                recursiveCheck(currentObj[key], keyIndex + 1);
            }
        }
    }

    recursiveCheck(obj, 0);
    saveConfig(obj);
}

export function checkConfigAdditions(config){
    checkObjectKeys(config, "info.server.name", "SilentShare");


    checkObjectKeys(config, "sync.interval.minutes", 10);


    checkObjectKeys(config, "host", "your_public_address:");
    checkObjectKeys(config, "db.host", "localhost");
    checkObjectKeys(config, "db.user", "user");
    checkObjectKeys(config, "db.password", "");
    checkObjectKeys(config, "db.database", "silentshare");
    checkObjectKeys(config, "db.port", 3306);
    checkObjectKeys(config, "db.connectionLimit", 5);
    checkObjectKeys(config, "port", 2052);

    checkObjectKeys(config, "login.login_attempts_per_ip_per_hour", 3);
    checkObjectKeys(config, "login.login_attempts_per_hour", 6);

    checkObjectKeys(config, "rateLimits.fileRequests.timespan", 60000);
    checkObjectKeys(config, "rateLimits.fileRequests.per_ip_limit", 1000);
    checkObjectKeys(config, "rateLimits.fileRequests.total_limit", 120000);

    checkObjectKeys(config, "upload.max_name_length", 240);
    checkObjectKeys(config, "upload.filename_allowed_regex", "[A-Za-z0-9_.\\-]");

    checkObjectKeys(config, "upload.mimeTypes", [
        [".txt", "text/plain", true],
        [".md", "text/markdown", true],
        [".json", "application/json", true],
        [".pdf", "application/pdf", true],
        [".png", "image/png", true],
        [".jpg", "image/jpeg", true],
        [".jpeg", "image/jpeg", true],
        [".gif", "image/gif", true],
        [".webp", "image/webp", true],
        [".svg", "image/svg+xml", true],
        [".mp4", "video/mp4", true],
        [".mov", "video/quicktime", true],
        [".webm", "video/webm", true],
        [".mp3", "audio/mpeg", true],
        [".wav", "audio/wav", true],
        [".ogg", "audio/ogg", true],
        [".zip", "application/zip", false],
        [".tar", "application/x-tar", false],
        [".gz", "application/gzip", false],
        [".exe", "application/x-msdownload", false],
        [".sh", "application/x-sh", false],
        [".bin", "application/octet-stream", false]
    ]);

    checkObjectKeys(config, "upload.enabled", true);
    checkObjectKeys(config, "upload.max_allowed_upload_gb", 10);
    checkObjectKeys(config, "upload.storage_dir", "./data/files");
    checkObjectKeys(config, "upload.max_user_file_size_mb", 200);
    checkObjectKeys(config, "upload.max_uploads_per_ip_minute", 2);
    checkObjectKeys(config, "upload.max_uploads_per_minute", 40);
}