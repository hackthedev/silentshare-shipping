const grid = document.getElementById('grid');
const btnMore = document.getElementById('btnMore');
const empty = document.getElementById('empty');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter');

let lastId = 0, loading = false, moreData = true;
let allItems = [];
let currentFilter = 'all';
let currentSearch = '';

AudioPlayer.injectStyle()

function humanSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(1) + ' GB';
}

function mediaThumb(item, size) {
    const t = (item?.type || '').toLowerCase();
    const hash = item?.file_hash || '';

    if (t.startsWith('image/')) {
        const a = document.createElement("a");
        a.className = "thumb thumb-link";
        a.href = "#";
        a.target = "_blank";
        a.rel = "noopener";

        const img = document.createElement("img");
        img.className = "thumb-img";
        img.dataset.hash = hash;
        img.loading = "lazy";
        a.appendChild(img);
        return a;
    }

    if (t.startsWith('video/')) {
        const a = document.createElement("a");
        a.className = "thumb thumb-link";
        a.href = "#";
        a.target = "_blank";
        a.rel = "noopener";

        const vid = document.createElement("video");
        vid.className = "thumb-video";
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = "metadata";
        vid.dataset.hash = hash;
        a.appendChild(vid);
        return a;
    }

    if (t.startsWith('audio/')) {
        const wrapper = document.createElement("a");
        wrapper.className = "thumb";
        wrapper.target = "_blank";
        wrapper.rel = "noopener";

        const mini = AudioPlayer.createMiniPlayer(null, hash);
        wrapper.appendChild(mini);
        return wrapper;
    }


    const a = document.createElement("a");
    a.className = "thumb thumb-link";
    a.href = "#";
    a.target = "_blank";
    a.rel = "noopener";
    a.style = "display:flex;align-items:center;justify-content:center;color:#888;font-size:13px;";
    a.textContent = "No preview";
    return a;
}


function buildUrlsForHost(host, hash) {
    return {
        viewCandidates: [`https://${extractHost(host)}/file/${hash}`],
        downloadCandidates: [`https://${extractHost(host)}/file/${hash}/download`]
    };
}

// helper: timeout wrapper for fetch
function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {signal: controller.signal, ...opts})
        .finally(() => clearTimeout(id));
}

// helper: check host reachability using HEAD/Range first, fallback to media element test for images/videos
async function checkHostReachable(host, hash, mimeType, timeoutMs = 5000) {
    const urls = buildUrlsForHost(host, hash);
    const candidates = urls.viewCandidates || [urls.view];

    for (const url of candidates) {
        try {
            // try a lightweight range request
            if (extractHost(window.location.origin) === extractHost(host)) {
                return {
                    ok: true,
                    url,
                    downloadUrl: (urls.downloadCandidates ? urls.downloadCandidates[candidates.indexOf(url)] : urls.download)
                };
            }

            const res = await fetchWithTimeout(url, {
                method: 'GET', headers: {Range: 'bytes=0-0'}, mode: 'cors', cache: 'no-store'
            }, timeoutMs);

            if (res && (res.status === 206 || res.status === 200)) return {
                ok: true,
                url,
                downloadUrl: (urls.downloadCandidates ? urls.downloadCandidates[candidates.indexOf(url)] : urls.download)
            };
            // otherwise try next candidate
        } catch (e) {
            // fetch failed (network, CORS or timeout). Fallthrough to next attempt.
        }
    }

    // fallback for images / video: try to load via element (works around some CORS/HEAD restrictions)
    if (mimeType && mimeType.startsWith('image/')) {
        const img = new Image();
        return await new Promise(resolve => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ok: false});
                }
            }, timeoutMs);

            img.onload = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                // pick first candidate that loads
                const url = (buildUrlsForHost(host, hash).viewCandidates || [buildUrlsForHost(host, hash).view])[0];
                const downloadUrl = url + '/download';
                resolve({ok: true, url, downloadUrl});
            };
            img.onerror = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve({ok: false});
            };

            // try first candidate
            const first = (buildUrlsForHost(host, hash).viewCandidates || [buildUrlsForHost(host, hash).view])[0];
            img.src = first;
        });
    }

    if (mimeType && mimeType.startsWith('video/')) {
        return await new Promise(resolve => {
            const vid = document.createElement('video');
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ok: false});
                }
            }, timeoutMs);

            vid.onloadedmetadata = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                const url = (buildUrlsForHost(host, hash).viewCandidates || [buildUrlsForHost(host, hash).view])[0];
                resolve({ok: true, url, downloadUrl: url + '/download'});
            };
            vid.onerror = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve({ok: false});
            };

            vid.preload = 'metadata';
            vid.src = (buildUrlsForHost(host, hash).viewCandidates || [buildUrlsForHost(host, hash).view])[0];
            // some browsers require append to DOM to start loading; try briefly
            vid.style.display = 'none';
            document.body.appendChild(vid);
            setTimeout(() => {
                try {
                    document.body.removeChild(vid);
                } catch (_) {
                }
            }, timeoutMs + 50);
        });
    }

    return {ok: false};
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function renderItem(it) {
    const title = it.title || (it.type || 'File');
    const size = humanSize(it.size_bytes);
    const hash = it.file_hash;
    const type = it.type || '';
    const el = document.createElement('div');

    el.className = 'item';

    el.appendChild(mediaThumb(it));
    el.insertAdjacentHTML("beforeend", `
      <div class="meta">
        <div style="font-weight:600" class="meta-title">${escapeHtml(title)}</div>
        <div class="muted">${escapeHtml(type)}${size ? ' · ' + escapeHtml(size) : ''}</div>
        <div class="hash">${escapeHtml(hash)}</div>
        <div class="hostStatus muted small" style="margin-top:6px">checking hosts…</div>
      </div>
      <div class="row">
        <a class="btn viewBtn" href="#" target="_blank" rel="noopener">View</a>
        <a class="btn downloadBtn" href="#" rel="noopener">Download</a>
        <button class="btn shareBtn" data-url="#" disabled>Share</button>
      </div>
    `);


    const hostStatusEl = el.querySelector('.hostStatus');
    const metaTitle = el.querySelector('.meta-title');
    let mutedInfo = el.querySelector('.muted');
    const viewBtn = el.querySelector('.viewBtn');
    const downloadBtn = el.querySelector('.downloadBtn');
    const shareBtn = el.querySelector('.shareBtn');

    // disable buttons initially
    viewBtn.classList.add('disabled');
    downloadBtn.classList.add('disabled');
    shareBtn.disabled = true;

    let foundHost = false;

    // iterate hosts until one works
    (async () => {
        const hosts = Array.isArray(it.hosts) ? it.hosts.slice() : [];
        if (hosts.length === 0) {
            hostStatusEl.textContent = 'no hosts';
            return;
        }

        for (let i = 0; i < hosts.length; i++) {
            const host = hosts[i];
            hostStatusEl.textContent = `checking ${host} (${i + 1}/${hosts.length})…`;

            try {
                const reachable = await checkHostReachable(host, hash, type, 5000);
                if (reachable && reachable.ok) {
                    foundHost = true;

                    // set buttons/links
                    viewBtn.href = reachable.url;
                    downloadBtn.href = reachable.downloadUrl || (reachable.url + '/download');
                    shareBtn.setAttribute('data-url', reachable.url);

                    shareBtn.disabled = false;

                    viewBtn.classList.remove('disabled');
                    downloadBtn.classList.remove('disabled');
                    hostStatusEl.textContent = host + (i < hosts.length - 1 ? ' (primary)' : '');

                    // update thumb anchor href and media src only now
                    const thumbLink = el.querySelector('.thumb-link');
                    if (thumbLink) thumbLink.href = reachable.url;

                    const img = el.querySelector('.thumb-img');
                    if (img) {
                        img.src = reachable.url;
                    }

                    const vid = el.querySelector('.thumb-video');
                    if (vid) {
                        vid.src = reachable.url + '#t=5';

                        vid.onloadeddata = () => {
                            if (vid && vid?.videoWidth !== 0) {
                                mutedInfo.innerText += ` · ${vid.videoWidth}p`;
                            }
                        }

                        try {
                            vid.load();
                        } catch (_) {
                        }
                    }

                    const player = el.querySelector('.mini-audio-player');
                    const audio = player.querySelector('audio');

                    if (audio) {
                        audio.src = reachable.url;

                        audio.addEventListener("loadedmetadata", async () => {
                            console.log(reachable.url)
                            let albumCover = await AudioPlayer.getAlbumCover(reachable.url);

                            if (albumCover.length > 0) {
                                player.style.backgroundImage = `url("${albumCover}")`;
                            }
                        });

                        try {
                            audio.load();
                        } catch (_) {
                        }
                    }

                    return;
                }
            } catch (e) {
                // ignore and try next

            }
        }

        if (!foundHost) {
            // no host succeeded
            hostStatusEl.textContent = 'no reachable host :(';

            viewBtn.href = '';
            downloadBtn.href = '';
            viewBtn.classList.add('disabled');
            downloadBtn.classList.add('disabled');

            metaTitle.innerHTML = `<del><i>${metaTitle.innerText}</i></del>`;
            shareBtn.setAttribute('data-url', viewBtn.href);
        }
    })();

    shareBtn.addEventListener('click', (ev) => {
        const url = shareBtn.getAttribute('data-url');
        if (!url) return;
        try {
            navigator.clipboard.writeText(url);
            shareBtn.textContent = 'Copied';
            setTimeout(() => shareBtn.textContent = 'Share', 1200);
        } catch (_) {
            // fallback: open share prompt
            window.open(url, '_blank');
        }
    });

    return el;
}


function applyFilters() {
    grid.innerHTML = '';
    const q = currentSearch.toLowerCase();
    const filtered = allItems.filter(it => {
        const type = (it.type || '').toLowerCase();
        const matchType = currentFilter === 'all' ? true : currentFilter === 'other' ? (!type.startsWith('image/') && !type.startsWith('video/') && !type.startsWith('audio/')) : type.startsWith(currentFilter);
        const matchSearch = !q || (it.title || '').toLowerCase().includes(q) || it.file_hash.includes(q) || type.includes(q);
        return matchType && matchSearch;
    });


    for (const it of filtered) {
        grid.appendChild(renderItem(it));
    }
    empty.style.display = filtered.length ? 'none' : 'block';
}

async function loadPage() {
    if (loading || !moreData) return;
    loading = true;
    btnMore.style.display = 'none';
    try {
        const q = lastId ? `?lastId=${encodeURIComponent(lastId)}` : '';
        const r = await fetch(`/resources${q}`);
        if (!r.ok) throw new Error(r.status);
        const data = await r.json();
        const items = Array.isArray(data.items) ? data.items : [];
        allItems.push(...items);
        applyFilters();
        moreData = !!data.more_data;
        lastId = data.next_last_id || lastId;
        if (moreData) btnMore.style.display = 'inline-block';
    } catch (e) {
        console.warn(e);
    } finally {
        loading = false;
    }
}

btnMore.addEventListener('click', e => {
    e.preventDefault();
    loadPage();
});
searchInput.addEventListener('input', e => {
    currentSearch = e.target.value;
    applyFilters();
});
filterBtns.forEach(btn => btn.addEventListener('click', () => {
    currentFilter = btn.dataset.type;
    applyFilters();
}));
document.addEventListener('click', e => {
    if (e.target.classList.contains('shareBtn')) {
        const url = e.target.dataset.url;
        navigator.clipboard.writeText(url).then(() => {
            e.target.textContent = 'Copied!';
            setTimeout(() => e.target.textContent = 'Share', 1000);
        });
    }
});
loadPage();