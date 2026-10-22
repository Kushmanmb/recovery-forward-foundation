(function () {
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");
  var current = "overview";
  var member = null;
  var renderVersion = 0;
  var boardMembers = [];

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
    if (code === "member_or_invitation_exists") return "This member or an unused invitation already exists. Revoke the invitation before replacing it.";
    if (code === "invalid_invitation") return "The invitation is invalid, expired, already used, or belongs to another identity.";
    if (code === "invalid_member_state") return "The account changed or has not completed the required step. Refresh the roster.";
    if (code === "verification_required") return "Confirm identity and MFA verification before activation.";
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

  function showInvitation() {
    main.innerHTML = "<section class='card'><h2>Accept board invitation</h2><p>Sign in with the exact email invited by the President. Enter the invitation token provided privately. Acceptance does not activate your account.</p>" +
      "<form id='accept-invite'><label for='invite-token'>Invitation token</label><input id='invite-token' name='token' type='password' autocomplete='off' required pattern='[a-f0-9]{64}'>" +
      "<label><input name='policyAck' type='checkbox' required> I acknowledge the security and privacy requirements.</label><button class='btn primary'>Accept invitation</button></form></section>";
  }

  function pendingScreen() {
    main.innerHTML = "<section class='card'><h2>Awaiting President activation</h2><p>Your invitation was accepted. The President must verify your identity and MFA enrollment before activating your account.</p><button class='btn' id='check-activation'>Check status</button></section>";
  }

  function renderBoard(data) {
    boardMembers = data.members;
    main.innerHTML = "<h2>Board access</h2><p>Invite officers, review onboarding, and control account access.</p><div id='board-message' role='status'></div>" +
      "<section class='card'><h3>Invite a board member</h3><p class='muted'>Invitations expire in 48 hours. Deliver the token privately to the intended person. Cloudflare Access must allow their exact identity and require MFA.</p>" +
      "<form id='board-invite'><label>Email<input name='email' type='email' maxlength='254' required></label><label>Role<select name='role'>" +
      data.roles.map(function (role) { return "<option>" + esc(role) + "</option>"; }).join("") +
      "</select></label><button class='btn primary'>Create invitation</button></form></section>" +
      boardMembers.map(function (person, index) {
        var actions = "";
        if (person.role !== "President") {
          if (person.status === "pending") actions = "<form data-action='activate' data-index='" + index + "'><label><input type='checkbox' name='identityVerified' required> I independently verified this person's identity.</label><label><input type='checkbox' name='mfaVerified' required> I verified MFA enrollment and the Access policy requires MFA.</label><button class='btn primary'>Activate member</button></form>";
          if (person.status === "active") actions = "<form data-action='suspend' data-index='" + index + "'><label>Reason for suspension<input name='reason' type='text' required maxlength='300'></label><button class='btn danger'>Suspend and revoke sessions</button></form>";
          if (person.status === "suspended" && person.activated_at) actions = "<form data-action='reinstate' data-index='" + index + "'><button class='btn'>Reinstate member</button></form>";
          if (person.status === "invited" && !person.revoked_at) actions = "<form data-action='revoke' data-index='" + index + "'><button class='btn'>Revoke invitation</button></form>";
        }
        var state = person.revoked_at && person.status === "invited" ? "revoked" : person.status;
        if (state === "invited" && person.expires_at <= Date.now()) state = "expired";
        return "<section class='card'><div class='row'><h3>" + esc(person.email) + "</h3><span class='tag'>" + esc(state) + "</span></div><p>" + esc(person.role) + "</p>" + actions + "</section>";
      }).join("");
  }

  function renderAudit(data) {
    main.innerHTML = "<h2>Audit activity</h2><p class='muted'>Latest 100 recorded events. Times shown in your browser's local timezone.</p>" +
      (data.entries.length ? data.entries.map(function (entry) {
        return "<section class='card'><strong>" + esc(entry.action) + "</strong><p>" + esc(entry.actorEmail) + "</p><p class='muted'>" + esc(new Date(entry.createdAt).toLocaleString()) + "</p><pre>" + esc(JSON.stringify(entry.detail, null, 2)) + "</pre></section>";
      }).join("") : "<section class='card'>No recorded events.</section>");
  }

  async function render() {
    if (!member || member.setupRequired) return;
    if (member.activationPending) return pendingScreen();
    var requestedSection = current;
    var version = ++renderVersion;
    try {
      if (requestedSection === "security") return renderSecurity();
      if (requestedSection === "board" || requestedSection === "audit") {
        var result = await api(requestedSection === "board" ? "/api/board" : "/api/audit");
        if (version !== renderVersion || !member || current !== requestedSection) return;
        return requestedSection === "board" ? renderBoard(result) : renderAudit(result);
      }
      var response = await api("/api/registry/summary");
      if (version !== renderVersion || !member || current !== requestedSection) return;
      var counts = response.summary.statusCounts;
      var summary = { pending: counts.pending, verified: counts.verified, closed: counts.closed };
      if (requestedSection === "registry") renderRegistry(summary);
      else renderOverview(summary);
    } catch (error) {
      if (version !== renderVersion || !member || current !== requestedSection) return;
      if (error.message === "authentication_required" || requestedSection === "board" || requestedSection === "audit") return showError(error.message);
      if (requestedSection === "registry") return renderRegistry(null);
      renderOverview(null);
    }
  }

  main.addEventListener("click", async function (event) {
    if (event.target.id === "check-activation") await start();
  });

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
    var form = event.target;
    var action = form.getAttribute("data-action");
    if (form.id === "accept-invite" || form.id === "board-invite" || action) {
      event.preventDefault();
      var submit = form.querySelector("button");
      submit.disabled = true;
      var fields = new FormData(form);
      try {
        var path, payload;
        if (form.id === "accept-invite") {
          path = "/api/board/accept";
          payload = { token: fields.get("token").trim(), policyAck: fields.has("policyAck") };
        } else if (form.id === "board-invite") {
          path = "/api/board/invite";
          payload = { email: fields.get("email"), role: fields.get("role") };
        } else {
          path = "/api/board/" + action;
          payload = { email: boardMembers[Number(form.getAttribute("data-index"))].email };
          if (action === "activate") { payload.identityVerified = fields.has("identityVerified"); payload.mfaVerified = fields.has("mfaVerified"); }
          if (action === "suspend") payload.reason = fields.get("reason");
        }
        var result = await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        if (form.id === "accept-invite") { form.reset(); return start(); }
        var version = renderVersion;
        await render();
        if (!member || current !== "board" || renderVersion !== version + 1) return;
        var message = document.getElementById("board-message");
        if (result.token) {
          message.innerHTML = "<section class='card'><h3>Invitation created</h3><p>This token is shown once. Deliver it privately to the invited person, who can enter it at this command center after Access sign-in. It expires in 48 hours.</p><label for='new-token'>Invitation token</label><textarea id='new-token' readonly></textarea><p>Leaving this screen clears the displayed token.</p></section>";
          document.getElementById("new-token").value = result.token;
        } else message.textContent = "Board access updated.";
      } catch (error) {
        var message = document.getElementById("board-message");
        if (message) message.textContent = errorMessage(error.message);
        else showError(error.message);
      } finally { submit.disabled = false; }
      return;
    }
    if (form.id !== "setup") return;
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
      Array.prototype.forEach.call(nav.querySelectorAll("button"), function (button) {
        var section = button.getAttribute("data-s");
        if (section === "board" || section === "audit") button.hidden = member.role !== "President" || member.status !== "active";
      });
      if (member.setupRequired) showSetup();
      else render();
    } catch (error) {
      if (error.message === "invitation_required") showInvitation();
      else showError(error.message);
    }
  }

  start();
})();
