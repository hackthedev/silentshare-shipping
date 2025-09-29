import EventEmitter from 'events';

export class Network {
    static _resolver = null;
    static events = new EventEmitter();

    static setServerResolver(resolver) {
        if (typeof resolver !== 'function') {
            throw new TypeError('resolver must be a function');
        }
        this._resolver = resolver;
    }

    static async getServers() {
        if (!this._resolver) {
            throw new Error('No server resolver set. Call Network.setServerResolver(fn).');
        }

        const list = await this._resolver();

        if (!Array.isArray(list)) return [];

        return list
            .map(String)
            .filter(Boolean);
    }

    static on(event, handler) {
        this.events.on(event, handler);
    }

    static off(event, handler) {
        this.events.off(event, handler);
    }

    static _clone(value) {
        if (value == null || typeof value !== 'object') return value;

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch {
                // fallthrough to JSON clone
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            // return original if cloning fails
            return value;
        }
    }

    static async emit(
        targetHost,
        {
            method = 'POST',
            path = '/',
            body = null,
            headers = {},
            timeoutMs = 15_000,
            stringifyJson = true
        } = {},
        response = null
    ) {
        if (!targetHost) {
            throw new TypeError('targetHost required');
        }

        const url = (targetHost.endsWith('/') ? targetHost.slice(0, -1) : targetHost) + path;

        // always clone
        const safeBody = this._clone(body);

        const payload =
            safeBody != null && typeof safeBody !== 'string' && stringifyJson
                ? JSON.stringify(safeBody)
                : safeBody;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(url, {
                method,
                headers: payload ? { 'content-type': 'application/json', ...headers } : headers,
                body: payload,
                signal: controller.signal
            });

            clearTimeout(timer);

            const text = await res.text().catch(() => '');

            const result = res.ok
                ? { host: targetHost, ok: true, status: res.status, body: text }
                : { host: targetHost, ok: false, status: res.status, body: text };

            if (res.ok) {
                this.events.emit('delivered', { host: targetHost, method, path, status: res.status });
            } else {
                this.events.emit('error', { host: targetHost, method, path, status: res.status, body: text });
            }

            if (typeof response === 'function') {
                try {
                    await response(result);
                } catch (_) { /* ignore callback errors */ }
            }

            return result;

        } catch (err) {
            clearTimeout(timer);

            const msg =
                err && err.name === 'AbortError'
                    ? 'timeout'
                    : (err && err.message) ? err.message : String(err);

            const result = { host: targetHost, ok: false, error: msg };

            this.events.emit('error', { host: targetHost, method, path, error: msg });

            if (typeof response === 'function') {
                try {
                    await response(result);
                } catch (_) { /* ignore */ }
            }

            return result;
        }
    }

    static async broadcast(
        {
            method = 'POST',
            path = '/',
            makeBody = null,
            headers = {},
            timeoutMs = 15_000,
            concurrency = 10,
            stringifyJson = true
        } = {},
        response = null,
        onComplete = null
    ) {
        const servers = await this.getServers();

        if (!servers.length) {
            if (typeof onComplete === 'function') {
                await onComplete([]);
            }
            return [];
        }

        const results = [];
        let index = 0;

        const worker = async () => {
            while (true) {
                const i = index++;
                if (i >= servers.length) return;

                const server = servers[i];

                const body = typeof makeBody === 'function'
                    ? makeBody(server)
                    : makeBody;

                const result = await this.emit(
                    server,
                    { method, path, body, headers, timeoutMs, stringifyJson },
                    response
                );

                results.push(result);
            }
        };

        const workers = Array.from({ length: Math.min(concurrency, servers.length) }, () => worker());

        await Promise.all(workers);

        if (typeof onComplete === 'function') {
            try {
                await onComplete(results);
            } catch (_) { /* ignore */ }
        }

        return results;
    }
}
