(function () {
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");
  var current = "overview";
  var member = null;
  var renderVersion = 0;

  function esc(value) {
    var element = document.createElement("span");
    element.textContent = value == null ? "" : String(value);
    return element.innerHTML;
  }

  async function api(path, options) {
    var response = await fetch(path, Object.assign({ credentials: "same-origin" }, options || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || "request_failed");
    return body;
  }

  function errorMessage(code) {
    if (code === "authentication_required") return "Sign in through the approved Cloudflare Access policy to continue.";
    if (code === "authentication_unavailable") return "Identity verification is temporarily unavailable. Please try again later.";
    if (code === "registry_unavailable") return "The read-only Registry integration is not configured or is temporarily unavailable. No applicant data is displayed.";
    if (code === "forbidden") return "Your account is not authorized to perform this action.";
    return "The request could not be completed. No data was changed.";
  }

  function showError(code) {
    main.innerHTML = "<section class='card' role='alert'><h2>Control Center unavailable</h2><p>" + esc(errorMessage(code)) + "</p></section>";
  }

  function showSetup() {
    main.innerHTML = "<section class='card'><h2>Complete President setup</h2>" +
      "<p>Cloudflare Access must enforce MFA for this application. Confirm that you have read the security and privacy requirements before activating the first account.</p>" +
      "<form id='setup'><label><input id='policy-ack' type='checkbox' required> I acknowledge the security and privacy requirements.</label>" +
      "<button class='btn primary' type='submit'>Complete setup</button></form></section>";
  }

  function renderOverview(summary) {
    var countMarkup = summary
      ? "<div class='grid'>" +
        "<div class='card'><div class='n'>" + esc(summary.pending) + "</div>Pending</div>" +
        "<div class='card'><div class='n'>" + esc(summary.verified) + "</div>Verified</div>" +
        "<div class='card'><div class='n'>" + esc(summary.closed) + "</div>Closed</div></div>"
      : "<div class='card muted'>Registry summary is not available. Applicant records are never shown here.</div>";
    main.innerHTML = "<h2>Organization Overview</h2>" +
      "<div class='grid'><div class='card'><div class='n'>" + esc(member.role) + "</div>Signed-in role</div>" +
      "<div class='card'><div class='n'>" + esc(member.status) + "</div>Account status</div></div>" +
      "<div class='card'><strong>" + esc(member.email) + "</strong><p class='muted'>Access is authorized by the server for each request. No sample or applicant personal data is displayed.</p></div>" +
      "<h2>Recovery Grant Registry summary</h2>" + countMarkup;
  }

  function renderRegistry(summary) {
    main.innerHTML = "<h2>Registry Summary</h2>" +
      (summary
        ? "<div class='grid'>" +
          "<div class='card'><div class='n'>" + esc(summary.pending) + "</div>Pending</div>" +
          "<div class='card'><div class='n'>" + esc(summary.verified) + "</div>Verified</div>" +
          "<div class='card'><div class='n'>" + esc(summary.closed) + "</div>Closed</div></div>"
        : "<div class='card muted'>Registry summary is unavailable. Applicant records and personal information are not returned.</div>");
  }

  function renderSecurity() {
    main.innerHTML = "<h2>Security</h2><div class='card'><strong>" + esc(member.role) + "</strong>" +
      "<p class='muted'>" + esc(member.email) + "</p><h3>Server-authorized permissions</h3><ul>" +
      member.permissions.map(function (permission) { return "<li>" + esc(permission) + "</li>"; }).join("") +
      "</ul><p class='muted'>Cloudflare Access identity tokens are signature-, issuer-, audience-, and expiry-verified by the application server. MFA must be required by the approved Access policy.</p></div>";
  }

  async function render() {
    if (!member || member.setupRequired) return;
    var requestedSection = current;
    var version = ++renderVersion;
    try {
      if (requestedSection === "security") return renderSecurity();
      var response = await api("/api/registry/summary");
      if (version !== renderVersion || !member || current !== requestedSection) return;
      var counts = response.summary.statusCounts;
      var summary = { pending: counts.pending, verified: counts.verified, closed: counts.closed };
      if (requestedSection === "registry") renderRegistry(summary);
      else renderOverview(summary);
    } catch (error) {
      if (version !== renderVersion || !member || current !== requestedSection) return;
      if (error.message === "authentication_required") return showError(error.message);
      if (requestedSection === "registry") return renderRegistry(null);
      renderOverview(null);
    }
  }

  nav.addEventListener("click", function (event) {
    var section = event.target.getAttribute("data-s");
    if (!section) return;
    current = section;
    Array.prototype.forEach.call(nav.querySelectorAll("button"), function (button) {
      button.classList.toggle("on", button === event.target);
    });
    render();
  });

  main.addEventListener("submit", async function (event) {
    if (event.target.id !== "setup") return;
    event.preventDefault();
    if (!document.getElementById("policy-ack").checked) return;
    try {
      member = await api("/api/bootstrap/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyAck: true })
      });
      render();
    } catch (error) {
      showError(error.message);
    }
  });

  document.getElementById("logout").addEventListener("click", async function () {
    renderVersion += 1;
    try {
      await api("/api/session", { method: "DELETE" });
      member = null;
      renderVersion += 1;
      window.location.assign("/cdn-cgi/access/logout");
    } catch (error) {
      showError(error.message);
    }
  });

  async function start() {
    try {
      try {
        member = await api("/api/me");
      } catch (error) {
        if (error.message !== "authentication_required") throw error;
        member = await api("/api/session", { method: "POST" });
      }
      document.getElementById("logout").hidden = false;
      if (member.setupRequired) showSetup();
      else render();
    } catch (error) {
      showError(error.message);
    }
  }

  start();
})();
