import bcrypt from "bcrypt";
import {dbQuery} from "../sql.mjs";
import Logger from "../logger.mjs";

export async function terminalSetUserRole(args) {
    if (args.length === 3) {
        let user = args[1];
        let role = args[2];

        if (user && role) {
            let regResult = await dbQuery(`UPDATE users SET role = ? WHERE username = ?`, [role, user])
            if (regResult?.affectedRows > 0) {
                Logger.success(`User ${user}'s role was changed to ${role}`);
            } else {
                Logger.warn("No users where updated. Does the user exist? Try 'users'");
            }
        }
    }
}