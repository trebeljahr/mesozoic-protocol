# Mesozoic Protocol — Google Play listing (captured 2026-09-22 from the draft app; package `com.ricoslabs.mesozoicprotocol`, Play app id 4972014174140347180)

App name: Mesozoic Protocol
Short description (78/80): Containment broke. The dinosaurs adapt. Build the towers that could stop them.
Pricing: Paid (price not yet set), product tax category set
Assets: icon-512.png, feature-graphic.jpg (1024x500), screenshot-1..6.png (phone, ~2900x1500)

## Policy declarations (all actioned Jun 12, 2026)
- Privacy policy URL: https://protocol.trebeljahr.com/privacy — the canonical store URL. `nginx.conf` serves `public/privacy.html` at `/privacy` on this host and on `play.mesozoicprotocol.com`, so both answer once `main` is deployed. The legacy host is the store URL on purpose: it is the only host with TLS and routing today (`mesozoicprotocol.com` and `play.mesozoicprotocol.com` resolved to a box that refused port 443 on 2026-09-22). The URL answered 404 at capture time because the deployed image predates the page — a push of `main` and one run of `deploy.yml` fix that, no console edit needed.
- Ads: No, my app does not contain ads
- Sign in details (app access): No — no part of the app is restricted
- Target audience: 13-15, 16-17, 18 and over
- Content rating: IARC questionnaire submitted Jun 12, 2026 (email ricotrebeljahr@gmail.com); no certificate id yet
- Health apps / Financial features / Government apps: none (last option "No")
- Advertising ID declaration: NOT done (the one "Needs attention")
- Data safety: see below
- Testers: none. Internal testing: one empty draft release, no bundle.
- App signing: not set up (nothing uploaded, no Play App Signing key exists)
