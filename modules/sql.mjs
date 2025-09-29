import mariadb from "mariadb";
import {makeid} from "./helpers.mjs";
import {getConfig, initConfig} from "./config-handler.mjs";

export const JWT_SECRET = makeid(48);
export const JWT_EXPIRES_IN = "30d";

initConfig();
let config = getConfig();

export const pool = mariadb.createPool({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    port: config.db.port ?? 3306,
    connectionLimit: config.db.connectionLimit ?? 5
});

export async function dbQuery(sql, params = []) {
    let conn;
    try {
        conn = await pool.getConnection();
        const res = await conn.query(sql, params);
        return res;
    } finally {
        if (conn) conn.release();

    }
}

export function getFirstRow(result) {
    if (!result) return null;
    if (Array.isArray(result)) return result[0] || null;
    if (Array.isArray(result.rows)) return result.rows[0] || null;
    return null;
}


export async function getSettingRaw(key) {
    const rows = await dbQuery("SELECT `value` FROM settings WHERE `name` = ? LIMIT 1", [key]);
    return rows && rows.length ? rows[0].value : null;
}


export async function setSetting(key, value) {
    await dbQuery("INSERT INTO settings (`name`,`value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = NOW()", [key, String(value)]);
}

export async function initSchema() {
    const conn = await pool.getConnection();
    try {
        await conn.query("SET NAMES utf8mb4");
        await conn.query("SET time_zone = '+00:00'");

        await conn.query(`
            CREATE TABLE IF NOT EXISTS servers
            (
                id                INT AUTO_INCREMENT PRIMARY KEY,
                host              VARCHAR(255)  NOT NULL UNIQUE,
                public_key        TEXT          NOT NULL,
                trust_level       DOUBLE NOT NULL DEFAULT 0.5,
                location          VARCHAR(100),
                connection_errors INT                    DEFAULT 0,
                sync_index        INT                    DEFAULT 0,
                is_blocked        TINYINT(1)             DEFAULT 0,
                notes             TEXT,
                last_seen         TIMESTAMP     NULL     DEFAULT NULL,
                last_sync         TIMESTAMP     NULL     DEFAULT NULL,
                created_at        TIMESTAMP              DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
              DEFAULT CHARSET=utf8mb4
              COLLATE=utf8mb4_unicode_ci;
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS resources
            (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                host           VARCHAR(255)            NOT NULL,
                file_hash      CHAR(64)                NOT NULL,
                hash_ref   VARCHAR(512) NOT NULL,
                size_bytes BIGINT,
                storage_type   ENUM ('local','remote') NOT NULL DEFAULT 'remote',
                status         ENUM ('verified','blocked','pending', 'unlisted') NOT NULL DEFAULT 'unlisted',
                type           VARCHAR(50)             NOT NULL,
                title          VARCHAR(255),
                description    TEXT,
                tags           JSON,
                copy_count     INT                     NOT NULL DEFAULT 1,
                view_count     INT                     NOT NULL DEFAULT 0,
                report_count   INT                     NOT NULL DEFAULT 0,
                download_count INT                     NOT NULL DEFAULT 0,
                created_at     TIMESTAMP                        DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_resource (host, file_hash)
            ) ENGINE=InnoDB
              DEFAULT CHARSET=utf8mb4
              COLLATE=utf8mb4_unicode_ci;
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS events
            (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                msg_hash    CHAR(64)     NOT NULL UNIQUE,
                origin_host VARCHAR(255) NOT NULL,
                origin_sig  TEXT         NOT NULL,
                type        VARCHAR(50)  NOT NULL,
                forward     TINYINT(1)   NOT NULL DEFAULT 0,
                payload     JSON         NOT NULL,
                status      ENUM ('pending','done') DEFAULT 'pending',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
              DEFAULT CHARSET=utf8mb4
              COLLATE=utf8mb4_unicode_ci;
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS event_deliveries
            (
                id           BIGINT AUTO_INCREMENT PRIMARY KEY,
                event_id     BIGINT       NOT NULL,
                target_host  VARCHAR(255) NOT NULL,
                delivered_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_event_delivery_event FOREIGN KEY (event_id)
                    REFERENCES events (id) ON DELETE CASCADE,
                UNIQUE KEY uq_event_delivery (event_id, target_host)
            ) ENGINE=InnoDB
              DEFAULT CHARSET=utf8mb4
              COLLATE=utf8mb4_unicode_ci;
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS users
            (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                username   VARCHAR(255)                   NOT NULL,
                password   VARCHAR(255)                   NOT NULL,
                role       ENUM ('user','admin','mod','') NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_username (username)
            ) ENGINE=InnoDB
              DEFAULT CHARSET=utf8mb4
              COLLATE=utf8mb4_general_ci;
        `);

    } finally {
        conn.release();
    }
}
