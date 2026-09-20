// Multi-Tenant Service Worker for Dolphin User Site (userd.jini24.in)
// Supports dynamic per-shop app names and custom logos configured in admind.jini24.in
const CACHE_NAME = 'shop-pwa-v9';

// In-memory store for active shop manifest and icons
let activeShopManifest = null;
const shopManifests = {};

// Strip social/tracking params (fbclid, gclid, utm_*, etc.) from a query string so
// the manifest "id"/"start_url" stay stable regardless of where the visitor came from.
function cleanQuery(q) {
    try {
        const p = new URLSearchParams(q || '');
        const parts = [];
        p.forEach((val, key) => {
            if (/^(fbclid|fbclick|fb_active_token|fb_comment_id|__cft__|gclid|msclkid|ttclid|igshid|yclid|mc_cid|mc_eid|_hsenc|_hsmi|utm_source|utm_medium|utm_campaign|utm_term|utm_content|utm_id|utm_reader)$/i.test(key)) return;
            parts.push(key + (val ? '=' + val : ''));
        });
        if (!parts.length) return '';
        return '?' + parts.join('&');
    } catch (e) {
        return q || '';
    }
}

// Assets to pre-cache on install (all verified existing on disk)
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './pwa-icon-192.png',
    './pwa-icon-512.png',
    'assets/default-shop-logo.png',
    'assets/icon-192.png',
    './victory.wav'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                console.warn('Pre-cache warning (non-fatal):', err);
            });
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Listen for dynamic shop configuration messages from index.html
self.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'SET_SHOP_MANIFEST') {
        const manifest = event.data.manifest;
        const shopKey = event.data.shopKey || 'active';
        shopManifests[shopKey] = manifest;
        activeShopManifest = manifest;

        // Persist dynamic manifest to CacheStorage
        caches.open(CACHE_NAME).then((cache) => {
            const makeRes = () => new Response(JSON.stringify(manifest), {
                headers: {
                    'Content-Type': 'application/manifest+json',
                    'Cache-Control': 'no-cache'
                }
            });
            cache.put('./manifest.json', makeRes()).catch(() => {});
            cache.put('/manifest.json', makeRes()).catch(() => {});
            if (manifest && manifest.start_url && manifest.start_url.includes('?')) {
                const query = manifest.start_url.substring(manifest.start_url.indexOf('?'));
                cache.put('./manifest.json' + query, makeRes()).catch(() => {});
                cache.put('/manifest.json' + query, makeRes()).catch(() => {});
            }
            if (shopKey && shopKey !== 'active') {
                cache.put('./manifest.json?' + encodeURIComponent(shopKey), makeRes()).catch(() => {});
                cache.put('/manifest.json?' + encodeURIComponent(shopKey), makeRes()).catch(() => {});
                cache.put('./manifest.json?u=' + encodeURIComponent(shopKey), makeRes()).catch(() => {});
                cache.put('/manifest.json?u=' + encodeURIComponent(shopKey), makeRes()).catch(() => {});
            }
        });
    }

    if (event.data.type === 'CACHE_SHOP_ICON') {
        const { url, base64 } = event.data;
        if (url && base64) {
            caches.open(CACHE_NAME).then((cache) => {
                fetch(base64).then((res) => {
                    cache.put(url, res.clone());
                    if (!url.startsWith('/')) cache.put('/' + url, res.clone());
                }).catch(() => {});
            });
        }
    }
});

// Fetch event listener
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    const url = new URL(event.request.url);

    // Dynamic Shop Manifest interception for Multi-Tenant / Multi-Business
    if (url.pathname.endsWith('/manifest.json') || url.pathname.includes('manifest.json')) {
        // Per-shop static manifest path: /pwa/<slug>/manifest.json (real file on the host)
        const pwaPathMatch = url.pathname.match(/^\/pwa\/([^/]+)\/manifest\.json/);
        const viaPwaPath = !!(pwaPathMatch && pwaPathMatch[1]);
        let shopParam = url.searchParams.get('u') || url.searchParams.get('id');
        if (!shopParam && viaPwaPath) {
            shopParam = decodeURIComponent(pwaPathMatch[1]);
        }
        if (!shopParam) {
            const cleanSearch = cleanQuery(url.search);
            if (cleanSearch.length > 1) {
                shopParam = cleanSearch.substring(1).split('&')[0].split('=')[0];
            }
        }
        // Extract shop from Referrer if browser omitted query parameter when requesting manifest
        if (!shopParam && event.request.referrer) {
            try {
                const refUrl = new URL(event.request.referrer);
                shopParam = refUrl.searchParams.get('u') || refUrl.searchParams.get('id');
                if (!shopParam && refUrl.search.length > 1) {
                    shopParam = refUrl.search.substring(1).split('&')[0].split('=')[0];
                }
            } catch (e) {}
        }

        // Multi-tenant resolution: match only this specific shop's manifest
        let manifest = null;
        if (shopParam && shopParam !== 'active') {
            manifest = shopManifests[shopParam];
        } else {
            manifest = activeShopManifest || shopManifests['active'];
        }

        if (manifest) {
            const finalManifest = Object.assign({}, manifest);
            const query = shopParam && shopParam !== 'active' ? ('?' + encodeURIComponent(shopParam)) : cleanQuery(url.search);
            if (viaPwaPath && shopParam) {
                finalManifest.start_url = '/?' + encodeURIComponent(shopParam);
                finalManifest.id = '/?' + encodeURIComponent(shopParam);
            } else if (query && (!finalManifest.start_url || finalManifest.start_url === './' || finalManifest.start_url === '/')) {
                finalManifest.start_url = './' + query;
                finalManifest.id = './' + query;
            }
            event.respondWith(
                new Response(JSON.stringify(finalManifest), {
                    headers: {
                        'Content-Type': 'application/manifest+json',
                        'Cache-Control': 'no-cache'
                    }
                })
            );
            return;
        }

        // Check CacheStorage for this shop's specific cached manifest
        const specificKey = shopParam && shopParam !== 'active' ? ('./manifest.json?' + encodeURIComponent(shopParam)) : null;
        event.respondWith(
            (specificKey ? caches.match(specificKey) : Promise.resolve(null))
                .then((cachedSpecific) => {
                    if (cachedSpecific) return cachedSpecific;
                    return caches.match(event.request);
                })
                .then((cached) => {
                    if (cached) {
                        return cached.json().then((json) => {
                            const query = shopParam && shopParam !== 'active' ? ('?' + encodeURIComponent(shopParam)) : cleanQuery(url.search);
                            if (viaPwaPath && shopParam) {
                                json.start_url = '/?' + encodeURIComponent(shopParam);
                                json.id = '/?' + encodeURIComponent(shopParam);
                            } else if (query && (!json.start_url || json.start_url === './' || json.start_url === '/')) {
                                json.start_url = './' + query;
                                json.id = './' + query;
                            }
                            return new Response(JSON.stringify(json), {
                                headers: {
                                    'Content-Type': 'application/manifest+json',
                                    'Cache-Control': 'no-cache'
                                }
                            });
                        }).catch(() => cached);
                    }
                    return fetch(event.request).then((res) => {
                        return res.json().then((json) => {
                            const query = shopParam && shopParam !== 'active' ? ('?' + encodeURIComponent(shopParam)) : cleanQuery(url.search);
                            if (viaPwaPath && shopParam) {
                                json.start_url = '/?' + encodeURIComponent(shopParam);
                                json.id = '/?' + encodeURIComponent(shopParam);
                            } else if (query && (!json.start_url || json.start_url === './' || json.start_url === '/')) {
                                json.start_url = './' + query;
                                json.id = './' + query;
                            }
                            return new Response(JSON.stringify(json), {
                                headers: {
                                    'Content-Type': 'application/manifest+json',
                                    'Cache-Control': 'no-cache'
                                }
                            });
                        }).catch(() => res);
                    });
                })
        );
        return;
    }

    // Dynamic square shop icon interception
    if (url.pathname.includes('icon-192') || url.pathname.includes('icon-512') || url.pathname.includes('pwa-icon')) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).catch(() => caches.match('./pwa-icon-192.png'));
            })
        );
        return;
    }

    // Standard static and navigation requests
    event.respondWith(
        fetch(event.request)
            .then((response) => response)
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
