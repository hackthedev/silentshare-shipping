import bcrypt from "bcrypt";
import {dbQuery} from "../sql.mjs";
import Logger from "../logger.mjs";

export async function terminalRegisterUser(args) {
    if (args.length === 3) {
        let user = args[1];
        let password = args[2];

        if (user && password) {
            let password_hash = await bcrypt.hash(password, 12);
            if (password_hash) {
                let regResult = await dbQuery(`INSERT IGNORE INTO users (username, password)
                                               VALUES (?, ?)`, [user, password_hash])
                if (regResult?.affectedRows > 0) {
                    Logger.success(`User ${user} was created successfully.`);
                } else {
                    Logger.warn("User already exists");
                }
            }
        }
    }
}