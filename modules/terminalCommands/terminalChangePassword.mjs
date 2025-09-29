import bcrypt from "bcrypt";
import {dbQuery} from "../sql.mjs";
import Logger from "../logger.mjs";

export async function terminalChangePassword(args) {
    if (args.length === 3) {
        let user = args[1];
        let password = args[2];

        if (user && password) {
            let password_hash = await bcrypt.hash(password, 12);
            if (password_hash) {
                let regResult = await dbQuery(`UPDATE users
                                               SET password = ?
                                               WHERE username = ?`, [password_hash, user])

                if (regResult?.affectedRows > 0) {
                    Logger.success(`User ${user} password successfully changed`);
                } else {
                    Logger.warn("Coudlnt change user password. Does the user exist? Check with 'users'");
                }
            }
        }
    }
}