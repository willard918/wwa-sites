/* "Send me this design": a small email form that goes with a library unit or the configurator.
   POSTs to /api/tease; the server writes a ready-to-send email (with the dusk render inline) to data/outbox and logs the lead.
   Sending is OFF unless the server has SMTP settings, and the form says so honestly. */
(function (global) {
  var API = global.LOTCHECK_API != null ? global.LOTCHECK_API : (location.protocol === "file:" ? "http://127.0.0.1:8787" : "");
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ctx: { unit:{id,name,sf,beds,stories,kind,source}, image: function -> dataURL, source: "library"|"configurator", extra: {} } */
  function mount(box, ctx) {
    box.innerHTML = '<form class="tz" novalidate><label class="tz-l" for="tz-e">Keep this one</label>' +
      '<p class="tz-p">We\'ll email you this design with a note on how it sits on a lot, what it takes to build, and a link back to it. Add your address and the note covers your lot.</p>' +
      '<div class="tz-r"><input id="tz-e" type="email" placeholder="you@example.com" autocomplete="email" aria-label="Email address" required>' +
      '<button class="btn" type="submit">Email it to me</button></div>' +
      '<input class="tz-a" type="text" placeholder="Property address (optional)" autocomplete="street-address" aria-label="Property address, optional">' +
      '<input class="tz-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<label class="tz-c"><input type="checkbox" required> Yes, email me this design. One email, no list, unsubscribe any time. <a href="/privacy" target="_blank" rel="noopener" style="text-decoration:underline">Privacy</a></label>' +
      '<div class="tz-m" role="status"></div></form>';
    var f = box.querySelector("form"), em = f.querySelector("#tz-e"), ad = f.querySelector(".tz-a"), ck = f.querySelector(".tz-c input"), msg = f.querySelector(".tz-m"), btn = f.querySelector("button");
    if (global.LASTLOT && global.LASTLOT.match) ad.value = global.LASTLOT.match.address;
    f.addEventListener("submit", function (e) {
      e.preventDefault(); msg.className = "tz-m";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em.value.trim())) { msg.textContent = "That email address doesn't look right."; msg.className = "tz-m bad"; return; }
      if (!ck.checked) { msg.textContent = "Tick the box so we know you want the email."; msg.className = "tz-m bad"; return; }
      btn.disabled = true; btn.textContent = "Preparing…"; msg.textContent = "";
      var img = ""; try { img = ctx.image ? ctx.image() : ""; } catch (err) { }
      fetch(API + "/api/tease", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: em.value.trim(), address: ad.value.trim(), unit: ctx.unit, image: img, source: ctx.source || "library", consent: true, website: f.querySelector(".tz-hp").value, extra: ctx.extra || {} }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) { msg.textContent = d.error || "Something went wrong. Please try again."; msg.className = "tz-m bad"; return; }
          msg.className = "tz-m ok";
          msg.innerHTML = d.sent ? "Sent. Check your inbox for <b>" + esc(ctx.unit.name) + "</b>." : "Saved. Email sending is switched off in this prototype, so nothing has left the building yet. Your note is ready in the outbox.";
          f.querySelector(".tz-r").style.display = "none";
        })
        .catch(function () { msg.textContent = "The server is offline. Email " + "contact@pacificlivingsolutions.com" + " and we'll send it by hand."; msg.className = "tz-m bad"; })
        .then(function () { btn.disabled = false; btn.textContent = "Email it to me"; });
    });
  }
  global.TEASE = { mount: mount };
})(window);
