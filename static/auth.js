// Login helpers for the dashboard: sends you to the sign-in page if your session ends, and shows "who am I" + Sign out.
(function () {
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (...a) {
    const res = await origFetch(...a);
    const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
    if (res.status === 401 && url.indexOf('/api/auth/') === -1 && url.indexOf('/api/') !== -1) location.replace('/login.html');
    return res;
  };
  function chip(u) {
    const chips = document.querySelector('.topbar .chips');
    if (!chips || document.getElementById('chip-user')) return !!document.getElementById('chip-user');
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'chip-user'; b.className = 'chip user-chip'; b.title = 'Signed in as ' + u.username + '. Click to sign out';
    b.textContent = u.username + ' ⎋';
    b.addEventListener('click', async () => {
      try { await origFetch('/api/auth/logout', { method: 'POST', headers: { 'X-ASTB-Client': '1' } }); } catch (e) { /* ignore */ }
      location.replace('/login.html');
    });
    chips.appendChild(b);
    return true;
  }
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const r = await origFetch('/api/auth/me');
      if (!r.ok) return;
      const d = await r.json();
      if (!d.user) return;
      let n = 0; const t = setInterval(() => { if (chip(d.user) || ++n > 40) clearInterval(t); }, 250);
    } catch (e) { /* login is optional in the UI */ }
  });
})();
