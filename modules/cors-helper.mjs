export function enableCors({
                               allowCredentials = false,
                               allowedHeaders = ['Range', 'If-Range', 'Content-Type', 'Authorization', 'Origin', 'Accept'],
                               exposeHeaders = ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
                               methods = ['GET', 'HEAD', 'OPTIONS']
                           } = {}) {


    const allowHeadersStr = allowedHeaders.join(', ');
    const exposeHeadersStr = exposeHeaders.join(', ');
    const methodsStr = methods.join(', ');

    return (req, res, next) => {
        const origin = req.headers.origin;

        if (origin) {
            // reflect origin to support credentials
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }

        res.setHeader('Access-Control-Allow-Methods', methodsStr);
        res.setHeader('Access-Control-Allow-Headers', allowHeadersStr);
        res.setHeader('Access-Control-Expose-Headers', exposeHeadersStr);

        if (allowCredentials) {
            // when credentials are enabled, Access-Control-Allow-Origin must not be '*'
            if (!origin) {
                // no origin present, do not allow credentials
                res.setHeader('Access-Control-Allow-Credentials', 'false');
            } else {
                res.setHeader('Access-Control-Allow-Credentials', 'true');
            }
        }

        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    };
}