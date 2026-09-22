# Mesozoic Protocol — Google Play listing (captured 2026-09-22 from the draft app; package `com.ricoslabs.mesozoicprotocol`, Play app id 4972014174140347180)

App name: Mesozoic Protocol
Short description (78/80): Containment broke. The dinosaurs adapt. Build the towers that could stop them.
Pricing: Paid (price not yet set), product tax category set
Assets: icon-512.png, feature-graphic.jpg (1024x500), screenshot-1..6.png (phone, ~2900x1500)

## Policy declarations (all actioned Jun 12, 2026)
- Privacy policy URL: https://mesozoicprotocol.com/privacy — the canonical store URL on the apex marketing site. `nginx.conf` serves `public/privacy.html` at `/privacy` on the apex and on `play.mesozoicprotocol.com`. TLS + routing for both come from the Coolify proxy once `hatchkit sync` registers the hosts and the certificate issues; the retired host `protocol.trebeljahr.com` 301-redirects to the play subdomain. The Play Console + App Store Connect privacy fields still hold the old `protocol.trebeljahr.com/privacy` — a human must update both to this apex URL (see human-tasks).
- Ads: No, my app does not contain ads
- Sign in details (app access): No — no part of the app is restricted
- Target audience: 13-15, 16-17, 18 and over
- Content rating: IARC questionnaire submitted Jun 12, 2026 (email ricotrebeljahr@gmail.com); no certificate id yet
- Health apps / Financial features / Government apps: none (last option "No")
- Advertising ID declaration: NOT done (the one "Needs attention")
- Data safety: see below
- Testers: none. Internal testing: one empty draft release, no bundle.
- App signing: not set up (nothing uploaded, no Play App Signing key exists)
