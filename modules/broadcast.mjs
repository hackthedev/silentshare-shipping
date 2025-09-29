import fetch from "node-fetch";

export async function broadcastToServers(servers, path, payload) {
    const results = [];

    await Promise.all(servers.map(async (serverUrl) => {
        try {
            const res = await fetch(`${serverUrl}${path}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload),
                timeout: 5000
            });

            const data = await res.json().catch(() => null);
            results.push({ server: serverUrl, ok: true, data });
        } catch (err) {
            results.push({ server: serverUrl, ok: false, error: err.message });
        }
    }));

    return results;
}
