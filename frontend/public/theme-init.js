// Runs before first paint (a blocking script in <head>) so the page never flashes the wrong theme.
// It is a file rather than inline so the CSP can stay at script-src 'self' (frontend/security-headers.conf).
(function () {
  var pref = 'system';
  try {
    var raw = localStorage.getItem('sentinel-theme');
    if (raw) pref = JSON.parse(raw).state.preference || 'system';
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
