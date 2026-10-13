/* Runtime for published pages: wires the contact form to the leads API. No inline script, so a strict CSP works. */
(function () {
  var me = document.currentScript;
  var pageId = me && me.getAttribute('data-page');
  document.querySelectorAll('form[data-lp-contact]').forEach(function (form) {
    var status = form.querySelector('.lp-form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      var data = Object.fromEntries(new FormData(form).entries());
      btn.disabled = true; status.className = 'lp-form-status'; status.textContent = 'Sending…';
      fetch('/api/pages/' + encodeURIComponent(pageId) + '/contact', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || 'Something went wrong');
          form.reset(); status.className = 'lp-form-status ok'; status.textContent = 'Thanks! Your message has been sent.';
        })
        .catch(function (err) { status.className = 'lp-form-status err'; status.textContent = err.message; })
        .then(function () { btn.disabled = false; });
    });
  });
})();
