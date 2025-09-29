import bcrypt from "bcrypt";
import {dbQuery} from "../sql.mjs";
import Logger from "../logger.mjs";

export async function terminalDeleteUser(args) {
    if (args.length === 2) {
        let user = args[1];

        if (user) {
            let regResult = await dbQuery(`DELETE FROM users WHERE username = ?`, [user]);
            if (regResult?.affectedRows > 0) {
                Logger.success(`User ${user} was deleted successfully.`);
            } else {
                Logger.warn("User not found. Check with 'users'");
            }
        }
    }
}