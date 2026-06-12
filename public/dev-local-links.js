// The marketing pages link to the production hosts (apex = marketing,
// play subdomain = game). On a dev server those links would navigate away
// to the live site — rewrite them to the local copies instead. Production
// has no port and a real hostname, so this is a no-op there.
(() => {
  const isDev =
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.port !== "";
  if (!isDev) return;

  // Apex routes are extensionless in production (nginx rewrite); the dev
  // server only knows the raw files.
  const apexPages = {
    "": "/about.html",
    "/press": "/press.html",
    "/privacy": "/privacy.html",
    "/imprint": "/imprint.html",
  };

  for (const a of document.querySelectorAll('a[href^="https://"]')) {
    const url = new URL(a.href);
    if (
      url.hostname === "play.mesozoicprotocol.com" ||
      url.hostname === "protocol.trebeljahr.com"
    ) {
      a.href = "/";
    } else if (url.hostname === "mesozoicprotocol.com") {
      const path = url.pathname.replace(/\/$/, "");
      if (path in apexPages) a.href = apexPages[path];
    }
  }
})();
