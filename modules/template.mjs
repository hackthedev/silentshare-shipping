import {getConfig, initConfig} from "./config-handler.mjs";
import {versionCode} from "./helpers.mjs";

initConfig()
let config = getConfig();

export function registerTemplateMiddleware(app, __dirname, fs, path) {
    const publicDir = path.join(__dirname, 'public');
    const templateExtensions = ['.html', '.js'];

    function getMetaTitle() {
        `SilentShare • Decentralised File sharing`
    }

    function getMetaDescription() {
        return "SilentShare is a new decentralised file sharing 'service' with many innovative features and a lifelong uptime thats 100% independent";
    }

    function renderTemplate(template, query) {

        config = getConfig();

        let placeholders = [
            ["version", () => versionCode],

            ["meta.page.title", () => getMetaTitle()],
            ["meta.page.description", () => getMetaDescription()],
            ["server.name", () => config.info.server.name || "SilentShare"],
            ["adsense.snippet", () => config.info.adsense.snippet || ""],
        ];

        return template.replace(/{{\s*([^{}\s]+)\s*}}/g, (match, key) => {
            const found = placeholders.find(([name]) => name === key);
            return found ? found[1]() : '';
        });
    }

    app.use((req, res, next) => {
        let reqPath = req.path === '/' ? '/index.html' : req.path;
        const ext = path.extname(reqPath).toLowerCase();

        if (!templateExtensions.includes(ext)) return next();

        const fullPath = path.join(publicDir, reqPath);

        fs.readFile(fullPath, 'utf8', (err, content) => {
            if (err) return next();

            const rendered = renderTemplate(content, req.query);
            const contentType = {
                '.html': 'text/html',
                '.js': 'application/javascript',
            }[ext] || 'text/plain';

            res.setHeader('Content-Type', contentType);
            res.send(rendered);
        });
    });
}
