> Historical reference. For selected files, current sizes and known gaps, start with the [store asset library](../README.md). Do not use this older document as live upload status.

# Mesozoic Protocol — Google Play listing (captured 2026-09-22 from the draft app; package `com.ricoslabs.mesozoicprotocol`, Play app id 4972014174140347180)

App name: Mesozoic Protocol
Short description (78/80): Containment broke. The dinosaurs adapt. Build the towers that could stop them.
Pricing: Paid — price set + merchant account active, product tax category set (verified in console 2026-09-23)
Assets: icon-512.png, feature-graphic.jpg (1024x500), screenshot-1..6.png (phone, ~2900x1500)

## Policy declarations (all actioned; verified complete in console 2026-09-23 — setup shows 12/13, only store-listing graphics upload outstanding)
- Privacy policy URL: https://mesozoicprotocol.com/privacy — the canonical store URL on the apex marketing site. `nginx.conf` serves `public/privacy.html` at `/privacy` on the apex and on `play.mesozoicprotocol.com`. TLS + routing for both come from the Coolify proxy once `hatchkit sync` registers the hosts and the certificate issues; the retired host `protocol.trebeljahr.com` 301-redirects to the play subdomain. The Play Console privacy field holds this apex URL since 2026-09-22 and the store-listing contact is hello@mesozoicprotocol.com / https://mesozoicprotocol.com (2026-09-23); App Store Connect has the same URL, App Privacy published as "Data Not Collected", category Games/Strategy/Action and age rating 13+ (2026-09-23). The apex is now deployed — https://mesozoicprotocol.com/privacy returns 200 with valid TLS (Let's Encrypt via the Cloudflare edge), verified live 2026-09-23; www + play.mesozoicprotocol.com also serve, and protocol.trebeljahr.com 301s to play.
- Ads: No, my app does not contain ads
- Sign in details (app access): No — no part of the app is restricted
- Target audience: 13-15, 16-17, 18 and over
- Content rating: IARC completed 2026-09-22 (ESRB E10+ / PEGI 7 / USK 6 / ACB PG); shows actioned in console
- Health apps / Financial features / Government apps: none (last option "No")
- Advertising ID declaration: done 2026-09-22 (no advertising ID, part of "no data collected"); App content shows all declarations actioned
- Data safety: see below
- Testers: none. Internal testing: one empty draft release, no bundle.
- App signing: not set up (nothing uploaded, no Play App Signing key exists) — the key is generated on the first signed-AAB upload
- Store listing: text/short/full description filled; graphics (icon 512, feature graphic 1024x500, phone screenshots) NOT yet uploaded to the console — this is the one incomplete setup task (12/13). Assets exist in this folder, ready to upload.
