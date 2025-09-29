import bcrypt from "bcrypt";
import {dbQuery} from "../sql.mjs";
import Logger from "../logger.mjs";

export async function terminalListUsers(args) {
    let regResult = await dbQuery(`SELECT username, role FROM users`, [])
    let row = (Array.isArray(regResult.rows) && regResult.rows.length) ? regResult.rows[0] : regResult;

    try{
        if(row?.length > 0){
            row?.forEach((user) => {
                Logger.success(`${user.username} - ${user.role}`);
            })
        }
        else{
            Logger.warn("No users found. Try 'register <username> <password>'")
        }
    }
    catch(err){
        Logger.error(err);
    }
}