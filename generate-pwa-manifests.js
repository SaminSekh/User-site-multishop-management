const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://uzpujtaqzuzjtqecbzto.supabase.co';
const ANON_KEY = 'sb_publishable_-AG7Cn5lImdpWk6yS62tVw_WZax4Yas';

function shortName(name) {
    const s = String(name || '').trim();
    return s.length > 12 ? s.substring(0, 12).trim() : s;
}

function buildManifest(slug, shopName) {
    return {
        id: '/?' + slug,
        name: shopName,
        short_name: shortName(shopName),
        description: 'Order from ' + shopName + ' online.',
        start_url: '/?' + slug,
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0f6425',
        icons: [
            { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    };
}

async function main() {
    const res = await fetch(SUPABASE_URL + '/rest/v1/shops?select=slug,shop_name&limit=500', {
        headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
    });
    if (!res.ok) {
        throw new Error('Supabase request failed: ' + res.status + ' ' + (await res.text()));
    }
    const shops = await res.json();
    let count = 0;
    for (const shop of shops) {
        const slug = (shop.slug || '').trim();
        const name = (shop.shop_name || '').trim();
        if (!slug) continue;
        const dir = path.join(__dirname, 'pwa', slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(buildManifest(slug, name), null, 2));
        count++;
    }
    console.log('Generated ' + count + ' per-shop PWA manifests under ./pwa/<slug>/manifest.json');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});