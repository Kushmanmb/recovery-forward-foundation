// PROTOTYPE: all data below is fictional sample data. No network, storage, or auth.
(function () {
  var SAMPLE = {
    members: [
      { id: 1, name: "Sample President", role: "President", email: "president@example.org", active: true },
      { id: 2, name: "Sample Vice President", role: "Vice President", email: "vp@example.org", active: true },
      { id: 3, name: "Sample Secretary", role: "Secretary", email: "secretary@example.org", active: true },
      { id: 4, name: "Sample Treasurer", role: "Treasurer", email: "treasurer@example.org", active: false },
      { id: 5, name: "Sample Member", role: "Member", email: "member@example.org", active: true }
    ],
    docs: ["Bylaws (sample)", "Meeting Minutes Q1 (sample)", "Grant Policy Draft (sample)"],
    meetings: [["2026-11-01", "Quarterly Board Meeting (sample)"], ["2026-12-06", "Annual Planning (sample)"]],
    finances: [["Donations YTD", "$0.00 (sample)"], ["Grants Awarded", "$0.00 (sample)"], ["Operating Balance", "$0.00 (sample)"]],
    log: []
  };
  var ROLES = ["President", "Vice President", "Secretary", "Treasurer", "Member"];
  var RBAC = {
    "President": ["All sections", "Lock/unlock accounts", "Invite/remove members"],
    "Vice President": ["Documents", "Meetings", "Activity Log (read)"],
    "Secretary": ["Documents (edit)", "Meetings (edit)"],
    "Treasurer": ["Finances (edit)", "Documents (read)"],
    "Member": ["Own email dashboard", "Documents (read)", "Meetings (read)"]
  };
  var main = document.getElementById("main");
  var current = "overview", selected = 1;
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function log(m) { SAMPLE.log.unshift(new Date().toISOString() + " — " + m + " (prototype)"); }
  function proto() { return '<span class="tag">PROTOTYPE</span>'; }
  function opts(list, sel) { return list.map(function (r) { return "<option" + (r === sel ? " selected" : "") + ">" + esc(r) + "</option>"; }).join(""); }

  var views = {
    overview: function () {
      var a = SAMPLE.members.filter(function (m) { return m.active; }).length;
      return "<h2>Organization Overview " + proto() + "</h2><div class='grid'>" +
        "<div class='card'><div class='n'>" + SAMPLE.members.length + "</div>Board members</div>" +
        "<div class='card'><div class='n'>" + a + "</div>Unlocked accounts</div>" +
        "<div class='card'><div class='n'>" + (SAMPLE.members.length - a) + "</div>Locked accounts</div>" +
        "<div class='card'><div class='n'>" + SAMPLE.meetings.length + "</div>Upcoming meetings</div></div>" +
        "<div class='card'>Recovery. Opportunity. A Future Forward.</div>";
    },
    board: function () {
      var h = "<h2>Board Members " + proto() + "</h2>";
      SAMPLE.members.forEach(function (m) {
        h += "<div class='card row'><div><strong>" + esc(m.name) + "</strong><br><span class='muted'>" + esc(m.role) + " · " + esc(m.email) + "</span></div>" +
          "<label class='row muted' style='margin:0'>" + (m.active ? "Unlocked" : "Locked") +
          " <span class='sw'><input type='checkbox' data-id='" + m.id + "' aria-label='Unlock " + esc(m.name) + "'" + (m.active ? " checked" : "") + "><i></i></span></label></div>";
      });
      h += "<div class='card'><h3>Add Board Member " + proto() + "</h3><form id='add'>" +
        "<label for='n'>Name</label><input type='text' id='n' required placeholder='Sample name only'>" +
        "<label for='e'>Email</label><input type='email' id='e' required placeholder='name@example.org'>" +
        "<label for='r'>Role</label><select id='r'>" + opts(ROLES) + "</select><br>" +
        "<button class='btn primary' type='submit'>Add (sample only)</button>" +
        "<p class='muted'>Do not enter real personal data. Nothing is saved or sent; reloading resets everything.</p></form></div>";
      return h;
    },
    email: function () {
      var m = SAMPLE.members.filter(function (x) { return x.id === selected; })[0];
      return "<h2>Member Email Dashboard " + proto() + "</h2><label for='sel'>Member</label><select id='sel'>" +
        SAMPLE.members.map(function (x) { return "<option value='" + x.id + "'" + (x.id === selected ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") +
        "</select><div class='card'><strong>" + esc(m.email) + "</strong> <span class='muted'>(" + (m.active ? "unlocked" : "locked") + ")</span>" +
        "<h3>Inbox (sample)</h3><div class='table'><table><tr><th>From</th><th>Subject</th></tr>" +
        "<tr><td>secretary@example.org</td><td>Agenda for next meeting</td></tr><tr><td>treasurer@example.org</td><td>Monthly report</td></tr></table></div>" +
        "<p class='muted'>Layout only. Real mailboxes require Phase 2 email hosting.</p></div>";
    },
    documents: function () { return "<h2>Documents " + proto() + "</h2><div class='card'>" + SAMPLE.docs.map(function (d) { return "<div>" + esc(d) + "</div>"; }).join("") + "</div>"; },
    meetings: function () { return "<h2>Meetings " + proto() + "</h2><div class='card'>" + SAMPLE.meetings.map(function (d) { return "<div>" + esc(d[0]) + " — " + esc(d[1]) + "</div>"; }).join("") + "</div>"; },
    finances: function () { return "<h2>Finances " + proto() + "</h2><div class='grid'>" + SAMPLE.finances.map(function (d) { return "<div class='card'>" + esc(d[0]) + "<div class='n'>" + esc(d[1]) + "</div></div>"; }).join("") + "</div>"; },
    security: function () {
      var h = "<h2>Security " + proto() + "</h2><div class='card'><h3>Role-based access (design)</h3><div class='table'><table>";
      ROLES.forEach(function (r) { h += "<tr><th>" + esc(r) + "</th><td>" + esc(RBAC[r].join("; ")) + "</td></tr>"; });
      return h + "</table></div></div><div class='card'><h3>Invitation &amp; 2FA plan</h3><p>See <code>docs/PHASE2-REQUIREMENTS.md</code>. Invite-only, single-use expiring links, mandatory 2FA (TOTP/passkeys), server-enforced RBAC.</p></div>";
    },
    activity: function () {
      return "<h2>Activity Log " + proto() + "</h2><div class='card'>" + (SAMPLE.log.length ? SAMPLE.log.map(function (l) { return "<div>" + esc(l) + "</div>"; }).join("") : "<span class='muted'>No activity yet. Toggle a switch to see sample entries.</span>") + "</div>";
    }
  };

  function render() { main.innerHTML = views[current](); }
  document.getElementById("nav").addEventListener("click", function (e) {
    var s = e.target.getAttribute("data-s"); if (!s) return;
    current = s;
    Array.prototype.forEach.call(document.querySelectorAll("nav button"), function (b) { b.classList.toggle("on", b === e.target); });
    render();
  });
  main.addEventListener("change", function (e) {
    var t = e.target;
    if (t.getAttribute("data-id")) {
      var m = SAMPLE.members.filter(function (x) { return x.id === +t.getAttribute("data-id"); })[0];
      m.active = t.checked; log(m.name + (m.active ? " unlocked" : " locked")); render();
    } else if (t.id === "sel") { selected = +t.value; render(); }
  });
  main.addEventListener("submit", function (e) {
    e.preventDefault();
    var role = document.getElementById("r").value;
    SAMPLE.members.push({ id: SAMPLE.members.length + 1, name: document.getElementById("n").value, role: role, email: document.getElementById("e").value, active: false });
    log("Added board member (" + role + ") — locked pending invite"); render();
  });
  render();
})();
