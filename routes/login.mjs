import path from 'path';
import bcrypt from 'bcrypt';
import {rateLimit} from "../modules/ratelimit.mjs";
import {getConfig, initConfig} from "../modules/config-handler.mjs";

initConfig()
let config = getConfig();

const loginLimiter = rateLimit({
    windowMs: 60 * 60_000,
    ipLimit: config.login.login_attempts_per_ip_per_hour,
    sigLimit: config.login.login_attempts_per_hour,
    trustProxy: true
});

export default function registerRoute(app, deps) {
    const {dbQuery, asyncHandler, signToken} = deps;

    app.get('/user/login', asyncHandler(async (req, res) => {
        const htmlPath = path.join(process.cwd(), 'public', 'login.html');
        return res.sendFile(htmlPath);
    }));

    app.post('/login', loginLimiter, asyncHandler(async (req, res) => {

            const {username, password} = req.body || {};
            if (!username || !password) return res.status(400).json({ok: false, error: 'Missing fields'});

            const rows = await dbQuery('SELECT id, username, password, role FROM users WHERE username = ? LIMIT 1', [username]);
            const user = Array.isArray(rows) && rows.length ? rows[0] : null;
            if (!user) return res.status(401).json({ok: false, error: 'Invalid credentials'});

            const ok = await bcrypt.compare(password, user.password);
            if (!ok) return res.status(401).json({ok: false, error: 'Invalid credentials'});

            const token = signToken({id: user.id, role: user.role || 'user'});
            res.json({ok: true, token, user: {id: user.id, username: user.username, role: user.role || 'user'}});
    }));
}
