(function () {
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");
  var current = "overview";
  var member = null;
  var renderVersion = 0;
  var boardMembers = [];
  var proposalId = null;
  var meetingId = null;
  var proposalFilter = "";
  var directorList = [];

  var GOV_ERRORS = {
    governance_rules_unverified: "Bylaws rules have not been verified. The President must record and attest them under Board Members before official action.",
    no_quorum: "Quorum is not present.",
    notice_insufficient: "Recorded meeting notice does not meet the notice period in the verified rules.",
    meeting_not_in_session: "The meeting must be in session.",
    voting_not_open: "Voting is not open for this proposal.",
    already_voted: "A vote is already recorded for this director. Votes cannot be changed.",
    recused: "This director is recused from this motion.",
    not_present: "This director is not recorded as present at the meeting.",
    not_a_director: "Only seated directors can do this. The administrative role alone confers no vote.",
    version_conflict: "The proposal changed since you opened it. Reload and try again.",
    not_editable: "Only drafts can be edited.",
    invalid_state: "This action is not available in the current state.",
    self_review_forbidden: "You cannot review your own proposal.",
    governance_check_failed: "One or more governance checks failed. See the checklist.",
    bylaws_review_required: "Confirm that you reviewed the bylaws before finalizing.",
    attestation_required: "The attestation checkbox is required.",
    seat_unavailable: "The board is already at the verified size, or the person already holds a seat.",
    member_not_active: "Only active members can be seated.",
    approval_not_permitted: "Minutes cannot be approved by their drafter or twice.",
    voting_still_open: "Close voting on all motions before adjourning.",
    reason_required: "A reason is required.",
    invalid_request: "Check the form values and try again."
  };

  var DOC_ERRORS = {
    unsupported_file_type: "That file type is not allowed.",
    content_type_mismatch: "The file type does not match its extension.",
    content_mismatch: "The file contents do not match its type.",
    file_too_large: "The file is larger than the allowed size.",
    empty_file: "The file is empty.",
    invalid_filename: "The file name is not valid.",
    version_conflict: "Someone else added a version first. Reload and try again.",
    document_archived: "Archived documents cannot receive new versions.",
    documents_unavailable: "Document storage is not configured.",
    forbidden: "You do not have permission for this folder."
  };

  var NOT_OPERATIONAL = {
    applications: ["Applications", "The applications inbox is not operational in this build. No applicant data is collected, stored or shown here."],
    finance: ["Finance", "Finance and payments are not operational. There is no accounting, banking or payment integration, and no balances are shown."],
    comms: ["Communications", "Communications are not operational. This system sends no email or notices; meeting notice is recorded here by attestation only."]
  };

  function has(permission) {
    return !!member && Array.isArray(member.permissions) && member.permissions.indexOf(permission) >= 0;
  }

  function escAttr(value) {
    return esc(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function when(timestamp) {
    return timestamp ? esc(new Date(timestamp).toLocaleString()) : "";
  }

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
    if (GOV_ERRORS[code]) return GOV_ERRORS[code];
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

  function msgBox() {
    return "<div id='gov-message' role='status' class='muted'></div>";
  }

  function notOperational(key) {
    var info = NOT_OPERATIONAL[key];
    main.innerHTML = "<h2>" + esc(info[0]) + "</h2><section class='card' role='note'><span class='tag warn'>Not operational</span><p>" + esc(info[1]) + "</p></section>";
  }

  function govForm(path, inner, button, extra) {
    return "<form data-gov='" + escAttr(path) + "'" + (extra || "") + ">" + inner + "<button class='btn primary'>" + esc(button) + "</button></form>";
  }

  function govButton(path, label, attrs, cls) {
    return "<button type='button' class='btn " + (cls || "") + "' data-gov-post='" + escAttr(path) + "' " + (attrs || "") + ">" + esc(label) + "</button>";
  }

  function integrationList(items) {
    if (!items) return "";
    return "<h3>Integrations</h3>" + items.map(function (item) {
      return "<div class='card'><div class='row'><strong>" + esc(item.name) + "</strong><span class='tag " + (item.operational ? "ok" : "warn") + "'>" +
        (item.operational ? "Configured" : "Not operational") + "</span></div><p class='muted'>" + esc(item.note) + "</p></div>";
    }).join("");
  }

  function renderDashboard(dash) {
    if (!dash || !dash.governance) return "<div class='card muted'>Governance data is unavailable.</div>";
    var g = dash.governance;
    var counts = dash.proposalCounts || {};
    var html = "<h2>Board governance</h2>";
    if (!g.rulesVerified) html += "<div class='card warn-card' role='alert'><strong>Official action is blocked.</strong> Bylaws and Indiana-law rules have not been verified. " +
      (has("governance:verify") ? "Record and attest them under Board Members." : "The President must record and attest them.") + "</div>";
    html += "<div class='grid'>" +
      "<div class='card'><div class='n'>" + esc(g.seatedDirectors) + (g.directorCount ? " / " + esc(g.directorCount) : "") + "</div>Seated directors</div>" +
      "<div class='card'><div class='n'>" + esc((counts.submitted || 0) + (counts.ready || 0)) + "</div>Awaiting review or vote scheduling</div>" +
      "<div class='card'><div class='n'>" + esc(counts.voting || 0) + "</div>Open for voting</div>" +
      "<div class='card'><div class='n'>" + esc(counts.finalized || 0) + "</div>Official resolutions</div></div>";
    if (dash.awaitingReview) html += "<div class='card'>" + esc(dash.awaitingReview) + " proposal(s) are awaiting your review.</div>";
    if (dash.votesNeeded && dash.votesNeeded.length) {
      html += "<h3>Your vote is needed</h3>" + dash.votesNeeded.map(function (p) {
        return "<div class='card'><button class='btn' type='button' data-open-proposal='" + Number(p.id) + "'>" + esc(p.title) + "</button></div>";
      }).join("");
    }
    html += "<h3>Upcoming meetings</h3>" + (dash.upcomingMeetings && dash.upcomingMeetings.length ? dash.upcomingMeetings.map(function (m) {
      return "<div class='card'><div class='row'><button class='btn' type='button' data-open-meeting='" + Number(m.id) + "'>" + esc(m.title) + "</button><span class='tag'>" + esc(m.status) + "</span></div><p class='muted'>" + when(m.scheduledAt) + "</p></div>";
    }).join("") : "<div class='card muted'>No meetings scheduled.</div>");
    return html;
  }

  function statusTag(status) {
    return "<span class='tag'>" + esc(status) + "</span>";
  }

  function renderProposalList(data) {
    var filters = ["", "submitted", "ready", "voting", "passed", "failed", "finalized", "archived"];
    var html = "<h2>Board proposals</h2>" + msgBox() +
      "<label for='proposal-filter'>Show</label><select id='proposal-filter'>" + filters.map(function (f) {
        return "<option value='" + escAttr(f) + "'" + (f === proposalFilter ? " selected" : "") + ">" + esc(f || "all active") + "</option>";
      }).join("") + "</select>";
    if (has("proposals:write")) {
      html += "<section class='card'><h3>New proposal</h3>" + govForm("proposals",
        "<label>Title<input name='title' type='text' maxlength='200' required></label>" +
        "<label>Category<select name='category'><option>policy</option><option>budget</option><option>grant</option><option>personnel</option><option>bylaws</option><option>other</option></select></label>" +
        "<label>Proposed resolution text<textarea name='body' maxlength='20000' required></textarea></label>", "Save draft") + "</section>";
    }
    html += data.proposals.length ? data.proposals.map(function (p) {
      return "<div class='card'><div class='row'><button class='btn' type='button' data-open-proposal='" + Number(p.id) + "'>" + esc(p.title) + "</button>" + statusTag(p.status) + "</div>" +
        "<p class='muted'>" + esc(p.category) + " &middot; " + esc(p.authorEmail) + " &middot; " + when(p.updatedAt) + "</p></div>";
    }).join("") : "<div class='card muted'>No proposals.</div>";
    main.innerHTML = html;
  }

  function checklist(checks) {
    return "<ul class='checks'>" + checks.map(function (c) {
      return "<li class='" + (c.ok ? "pass" : "fail") + "'>" + (c.ok ? "Pass" : "Fail") + ": " + esc(c.detail) + "</li>";
    }).join("") + "</ul>";
  }

  function renderProposal(d) {
    var p = d.proposal;
    var base = "proposals/" + Number(p.id);
    var mine = p.authorEmail === member.email;
    var html = "<p><button class='btn' type='button' data-back='proposals'>Back to proposals</button></p>" + msgBox() +
      "<section class='card'><div class='row'><h2>" + esc(p.title) + "</h2>" + statusTag(p.status) + "</div>" +
      "<p class='muted'>" + esc(p.category) + " &middot; by " + esc(p.authorEmail) + " &middot; version " + esc(p.version) + "</p><pre>" + esc(p.body) + "</pre>" +
      (p.reviewNote ? "<p><strong>Reviewer note:</strong> " + esc(p.reviewNote) + "</p>" : "") +
      (p.archiveReason ? "<p><strong>Archived:</strong> " + esc(p.archiveReason) + "</p>" : "") + "</section>";

    if (p.status === "draft" && mine) {
      html += "<section class='card'><h3>Edit draft</h3>" + govForm(base + "/edit",
        "<input type='hidden' name='n:version' value='" + Number(p.version) + "'>" +
        "<label>Title<input name='title' type='text' maxlength='200' required value='" + escAttr(p.title) + "'></label>" +
        "<label>Category<select name='category'>" + ["policy", "budget", "grant", "personnel", "bylaws", "other"].map(function (c) {
          return "<option" + (c === p.category ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select></label>" +
        "<label>Text<textarea name='body' maxlength='20000' required>" + esc(p.body) + "</textarea></label>", "Save changes") +
        govButton(base + "/submit", "Submit for review") + "</section>";
    }
    if (p.status === "submitted" && has("proposals:review") && !mine) {
      html += "<section class='card'><h3>Review</h3>" + govForm(base + "/review",
        "<label>Decision<select name='decision'><option value='approve'>Approve for the agenda</option><option value='return'>Return to author</option></select></label>" +
        "<label>Note (required when returning)<input name='note' type='text' maxlength='1000'></label>", "Record review") + "</section>";
    }
    if (p.status === "ready" && has("meetings:manage")) {
      html += "<section class='card'><h3>Agenda placement</h3>" + (p.meetingId ? "<p>Assigned to meeting #" + Number(p.meetingId) + ".</p>" : "") +
        govForm(base + "/assign-meeting", "<label>Meeting ID (scheduled meetings only)<input name='n:meetingId' type='text' inputmode='numeric' pattern='[0-9]+' required value='" + (p.meetingId ? Number(p.meetingId) : "") + "'></label>", "Assign to meeting") + "</section>";
    }
    if (p.meetingId) {
      html += "<section class='card'><h3>Quorum and voting</h3><p>Meeting: " + (d.meeting ? esc(d.meeting.title) + " (" + esc(d.meeting.status) + ")" : "") + "</p><p>Quorum: " +
        (d.quorum.required ? esc(d.quorum.present) + " present of " + esc(d.quorum.required) + " required &mdash; <strong>" + (d.quorum.met ? "quorum met" : "no quorum") + "</strong>" : "unknown until rules are verified") + "</p>" +
        "<p>Votes recorded: " + esc(d.voting.votesCast) + " of " + esc(d.voting.presentNotRecused) + " present, non-recused directors.</p>" +
        (d.voting.myVote ? "<p>Your vote: <strong>" + esc(d.voting.myVote) + "</strong> (final)</p>" : "") +
        (d.voting.recused ? "<p>You are recused from this motion.</p>" : "") + "</section>";
    }
    if (p.status === "ready" && has("meetings:manage") && p.meetingId) html += "<section class='card'>" + govButton(base + "/open-voting", "Open voting") + "</section>";
    if (p.status === "voting") {
      if (d.voting.eligibleToVote) {
        html += "<section class='card'><h3>Cast your vote</h3><p class='muted'>One vote per director. It cannot be changed.</p>" +
          ["yes", "no", "abstain"].map(function (c) { return govButton(base + "/vote", c.charAt(0).toUpperCase() + c.slice(1), "data-choice='" + c + "'", c === "yes" ? "primary" : ""); }).join(" ") + "</section>";
      }
      if (!d.voting.myVote && !d.voting.recused) {
        html += "<section class='card'><h3>Conflict of interest</h3>" + govForm(base + "/recuse", "<label>Describe the conflict<input name='reason' type='text' maxlength='500' required></label>", "Recuse myself") + "</section>";
      }
      if (has("meetings:manage")) html += "<section class='card'>" + govButton(base + "/close-voting", "Close voting and tally") + "</section>";
    }
    if (d.voting.result) {
      var r = d.voting.result;
      html += "<section class='card'><h3>Result</h3><p><strong>" + (r.passed ? "Carried" : "Not carried") + "</strong>" + (r.reason ? " (" + esc(r.reason) + ")" : "") + "</p>" +
        "<p>Yes " + esc(r.yes) + " &middot; No " + esc(r.no) + " &middot; Abstain " + esc(r.abstain) + " &middot; Present " + esc(r.present) + "</p>" +
        "<div class='table'><table><tr><th>Director</th><th>Vote</th></tr>" + d.voting.rollCall.map(function (v) {
          return "<tr><td>" + esc(v.directorEmail) + "</td><td>" + esc(v.choice) + "</td></tr>"; }).join("") + "</table></div></section>";
    }
    if (d.recusals.length) {
      html += "<section class='card'><h3>Recusals</h3>" + d.recusals.map(function (x) {
        return "<p>" + esc(x.directorEmail) + ": " + esc(x.reason) + "</p>"; }).join("") + "</section>";
    }
    if (d.finalization) {
      html += "<section class='card'><h3>Bylaws and governance verification</h3>" + checklist(d.finalization.checks) +
        govForm(base + "/finalize", "<label><input type='checkbox' name='b:bylawsReviewed' required> I reviewed the bylaws and applicable law for this resolution.</label>", "Finalize official resolution") + "</section>";
    }
    if (d.resolution) {
      html += "<section class='card'><h3>Official resolution " + esc(d.resolution.number) + "</h3><p class='muted'>Finalized by " + esc(d.resolution.finalizedBy) + " " + when(d.resolution.finalizedAt) + "<br>SHA-256 " + esc(d.resolution.contentHash) + "</p></section>";
    }
    if (["draft", "submitted", "ready", "failed", "finalized"].indexOf(p.status) >= 0 && (has("proposals:archive") || (p.status === "draft" && mine))) {
      html += "<section class='card'><h3>Archive</h3>" + govForm(base + "/archive", "<label>Reason<input name='reason' type='text' maxlength='500' required></label>", "Archive proposal") + "</section>";
    }
    html += "<section class='card'><h3>Revision history</h3>" + d.revisions.map(function (v) {
      return "<p class='muted'>v" + esc(v.version) + " &middot; " + esc(v.editedBy) + " &middot; " + when(v.editedAt) + "</p>"; }).join("") + "</section>";
    main.innerHTML = html;
  }

  function renderMeetingList(data, calendar) {
    var list = data.meetings.slice();
    var html = "<h2>" + (calendar ? "Calendar" : "Board meetings") + "</h2>" + msgBox();
    if (!calendar && has("meetings:manage")) {
      html += "<section class='card'><h3>Schedule a meeting</h3>" + govForm("meetings",
        "<label>Title<input name='title' type='text' maxlength='200' required></label>" +
        "<label>Type<select name='type'><option>regular</option><option>special</option><option>annual</option></select></label>" +
        "<label>Date and time<input name='t:scheduledAt' type='datetime-local' required></label>" +
        "<label>Location<input name='location' type='text' maxlength='300'></label>", "Schedule") + "</section>";
    }
    if (calendar) list.sort(function (a, b) { return a.scheduledAt - b.scheduledAt; });
    html += list.length ? list.map(function (m) {
      return "<div class='card'><div class='row'><button class='btn' type='button' data-open-meeting='" + Number(m.id) + "'>" + esc(m.title) + "</button>" + statusTag(m.status) + "</div>" +
        "<p class='muted'>" + esc(m.type) + " &middot; " + when(m.scheduledAt) + (m.location ? " &middot; " + esc(m.location) : "") + "</p></div>";
    }).join("") : "<div class='card muted'>No meetings scheduled.</div>";
    if (calendar) html += "<p class='muted'>Calendar entries come from recorded board meetings only. External calendar sync and notices are not operational.</p>";
    main.innerHTML = html;
  }

  function renderMeeting(d) {
    var m = d.meeting;
    var base = "meetings/" + Number(m.id);
    var html = "<p><button class='btn' type='button' data-back='meetings'>Back to meetings</button></p>" + msgBox() +
      "<section class='card'><div class='row'><h2>" + esc(m.title) + "</h2>" + statusTag(m.status) + "</div><p class='muted'>" + esc(m.type) + " &middot; " + when(m.scheduledAt) + (m.location ? " &middot; " + esc(m.location) : "") + "</p>" +
      "<p>Quorum: " + (d.quorum.required ? esc(d.quorum.present) + " of " + esc(d.quorum.required) + " required &mdash; <strong>" + (d.quorum.met ? "met" : "not met") + "</strong>" : "unknown until rules are verified") + "</p>" +
      "<p>Notice: " + (m.noticeSentAt ? "recorded " + when(m.noticeSentAt) : "not recorded") + (d.noticeCompliant === null ? "" : d.noticeCompliant ? " (meets " + esc(d.noticeDays) + "-day rule)" : " (does not meet " + esc(d.noticeDays) + "-day rule)") + "</p></section>";
    html += "<section class='card'><h3>Agenda</h3><ol>" + d.agenda.map(function (a) { return "<li>" + esc(a.title) + (a.detail ? "<br><span class='muted'>" + esc(a.detail) + "</span>" : "") + "</li>"; }).join("") +
      d.motions.map(function (x) { return "<li>Motion: <button class='btn' type='button' data-open-proposal='" + Number(x.id) + "'>" + esc(x.title) + "</button> " + statusTag(x.status) + "</li>"; }).join("") + "</ol>" +
      (!d.agenda.length && !d.motions.length ? "<p class='muted'>No agenda items.</p>" : "") +
      (has("meetings:manage") && m.status === "scheduled" ? govForm(base + "/agenda", "<label>Add agenda item<input name='title' type='text' maxlength='200' required></label>", "Add item") : "") + "</section>";
    if (has("meetings:manage") && m.status !== "adjourned") {
      html += "<section class='card'><h3>Notice, attendance and session</h3>" +
        (!m.noticeSentAt && m.status === "scheduled" ? govForm(base + "/notice", "<label><input type='checkbox' name='b:attest' required> I attest that proper notice was sent outside this system. This system sends none.</label>", "Record notice") : "") +
        govForm(base + "/attendance", "<label>Record director present<select name='email'>" + directorList.filter(function (x) { return !x.endedAt; }).map(function (x) {
          return "<option value='" + escAttr(x.email) + "'>" + esc(x.email) + "</option>"; }).join("") + "</select></label>", "Record attendance") +
        (m.status === "scheduled" ? govButton(base + "/start", "Call to order") : govButton(base + "/adjourn", "Adjourn")) + "</section>";
    }
    html += "<section class='card'><h3>Present</h3>" + (d.attendance.length ? d.attendance.map(function (a) { return "<p>" + esc(a.directorEmail) + " <span class='muted'>" + when(a.checkedInAt) + "</span></p>"; }).join("") : "<p class='muted'>No attendance recorded.</p>") + "</section>";
    html += "<section class='card'><h3>Minutes</h3>" + (d.minutes.length ? d.minutes.map(function (x) {
      return "<div><strong>Version " + esc(x.version) + "</strong> " + (x.approvedAt ? statusTag("approved by " + x.approvedBy) : statusTag("draft by " + x.draftedBy)) + "<pre>" + esc(x.content) + "</pre>" +
        (!x.approvedAt && has("minutes:approve") && m.status === "adjourned" && x.draftedBy !== member.email ? govButton(base + "/minutes/approve", "Approve this version", "data-version='" + Number(x.version) + "'") : "") + "</div>"; }).join("") : "<p class='muted'>No minutes.</p>") +
      (has("minutes:draft") && m.status !== "scheduled" ? govForm(base + "/minutes", "<label>Draft minutes<textarea name='content' maxlength='50000' required></textarea></label>", "Save draft version") : "") + "</section>";
    main.innerHTML = html;
  }

  function renderMembers(directors, rules) {
    var html = "<h2>Board members</h2>" + msgBox() + "<section class='card'><h3>Directors with voting seats</h3><p class='muted'>Only seated directors can vote. Application roles alone confer no vote.</p>" +
      (directors.directors.length ? "<div class='table'><table><tr><th>Director</th><th>Seat</th><th>Role</th><th>State</th><th></th></tr>" + directors.directors.map(function (x) {
        return "<tr><td>" + esc(x.email) + "</td><td>" + esc(x.seatTitle) + "</td><td>" + esc(x.role) + "</td><td>" + (x.endedAt ? "ended " + when(x.endedAt) : "seated") + "</td><td>" +
          (!x.endedAt && has("directors:manage") ? govButton("directors/end", "End seat", "data-email='" + escAttr(x.email) + "'", "danger") : "") + "</td></tr>"; }).join("") + "</table></div>" : "<p class='muted'>No directors seated.</p>") +
      (has("directors:manage") ? govForm("directors/seat", "<label>Member email<input name='email' type='email' maxlength='254' required></label><label>Seat title<input name='seatTitle' type='text' maxlength='100' required></label>", "Seat director") : "") + "</section>";
    var r = rules.rules;
    html += "<section class='card'><h3>Bylaws and governance rules</h3>" + (rules.verified && r ?
      "<p><span class='tag ok'>Verified</span> by " + esc(r.verifiedBy) + " " + when(r.verifiedAt) + "</p><ul><li>Directors: " + esc(r.directorCount) + "</li><li>Quorum: " + esc(r.quorum) + "</li><li>Approval rule: " + esc(r.approvalRule) +
      "</li><li>Notice: " + esc(r.noticeDays) + " day(s)</li><li>Source: " + esc(r.sourceDocument) + "</li><li>Statutory basis: " + esc(r.statutoryBasis) + "</li></ul>" :
      "<p><span class='tag warn'>Unverified</span> Voting, meetings and official resolutions are blocked.</p>");
    if (has("governance:verify")) {
      html += "<h4>Record verified rules</h4><p class='muted'>Transcribe these from the adopted bylaws and applicable Indiana law. A new entry supersedes the previous one; history is retained.</p>" + govForm("rules",
        "<label>Number of directors<input name='n:directorCount' type='text' inputmode='numeric' pattern='[0-9]+' required></label>" +
        "<label>Quorum (directors)<input name='n:quorum' type='text' inputmode='numeric' pattern='[0-9]+' required></label>" +
        "<label>Approval rule<select name='approvalRule'>" + (rules.approvalRules || []).map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select></label>" +
        "<label>Notice period (days)<input name='n:noticeDays' type='text' inputmode='numeric' pattern='[0-9]+' required></label>" +
        "<label><input type='checkbox' name='b:writtenConsentPermitted'> Bylaws permit action by written consent</label>" +
        "<label>Source document and section<input name='sourceDocument' type='text' maxlength='300' required></label>" +
        "<label>Statutory basis (Indiana Code citation)<input name='statutoryBasis' type='text' maxlength='300' required></label>" +
        "<label><input type='checkbox' name='b:attestation' required> I attest these values match the adopted bylaws and applicable law.</label>", "Verify and save");
    }
    main.innerHTML = html + "</section>";
  }

  var docFolder = "";
  var docDetail = null;

  function renderStore(store) {
    if (!store) return "<section class='card' role='note'><span class='tag warn'>File storage not operational</span><p class='muted'>Private document storage is unavailable. Official resolutions and meeting minutes stored in the database are listed below.</p></section>";
    var writable = store.folders.filter(function (f) { return f.canWrite; });
    var html = "<section class='card'><div class='row'><strong>Private document storage</strong><span class='tag ok'>Private bucket</span></div>" +
      "<p class='muted'>Files are served only through authorized, audited downloads. Maximum " + esc(Math.round(store.maxBytes / 1048576)) + " MB; allowed: " + esc(store.allowedTypes.join(", ")) + ".</p>" +
      "<label for='doc-folder-filter'>Folder</label><select id='doc-folder-filter'><option value=''>All folders</option>" + store.folders.map(function (f) {
        return "<option value='" + escAttr(f.id) + "'" + (f.id === docFolder ? " selected" : "") + ">" + esc(f.label) + "</option>";
      }).join("") + "</select></section>";
    if (writable.length) html += "<section class='card'><h3>Upload a document</h3><form id='doc-upload'>" +
      "<label>Folder<select name='folder'>" + writable.map(function (f) { return "<option value='" + escAttr(f.id) + "'>" + esc(f.label) + "</option>"; }).join("") + "</select></label>" +
      "<label>Title<input name='title' type='text' maxlength='200' required></label>" +
      "<label>Description<input name='description' type='text' maxlength='1000'></label>" +
      "<label>File<input name='file' type='file' required></label><button class='btn primary'>Upload</button></form>" + msgBox() + "</section>";
    else html += msgBox();
    return html;
  }

  function renderDocList(list) {
    if (!list) return "";
    return "<h3>Documents</h3>" + (list.documents.length ? list.documents.map(function (d) {
      return "<div class='card'><div class='row'><button class='btn' type='button' data-open-doc='" + Number(d.id) + "'>" + esc(d.title) + "</button>" + statusTag(d.status) + "</div>" +
        "<p class='muted'>" + esc(d.folder) + " &middot; v" + Number(d.currentVersion) + " &middot; " + esc(d.filename) + " &middot; " + when(d.uploadedAt) + "</p>" +
        "<p><a class='btn' href='/api/documents/" + Number(d.id) + "/download'>Download</a></p></div>";
    }).join("") : "<div class='card muted'>No documents in this folder.</div>");
  }

  function renderDocDetail(detail, store) {
    var d = detail.document;
    var canWrite = store && store.folders.some(function (f) { return f.id === d.folder && f.canWrite; });
    return "<p><button class='btn' type='button' data-doc-back='1'>Back</button></p><section class='card'><div class='row'><h3>" + esc(d.title) + "</h3>" + statusTag(d.status) + "</div>" +
      "<p class='muted'>" + esc(d.folder) + " &middot; " + esc(d.description || "") + "</p>" +
      "<div class='table'><table><tr><th>Version</th><th>File</th><th>Size</th><th>SHA-256</th><th>Uploaded</th><th></th></tr>" + detail.versions.map(function (v) {
        return "<tr><td>" + Number(v.version) + "</td><td>" + esc(v.filename) + "</td><td>" + Number(v.sizeBytes) + "</td><td>" + esc(v.sha256) + "</td><td>" + esc(v.uploadedBy) + " " + when(v.uploadedAt) +
          "</td><td><a href='/api/documents/" + Number(d.id) + "/download?version=" + Number(v.version) + "'>Download</a></td></tr>";
      }).join("") + "</table></div></section>" +
      (canWrite && d.status === "active" ? "<section class='card'><h3>Add a new version</h3><form id='doc-upload' data-document='" + Number(d.id) + "'><label>File<input name='file' type='file' required></label><button class='btn primary'>Upload version</button></form>" +
        "<button type='button' class='btn' data-doc-archive='" + Number(d.id) + "'>Archive document</button></section>" : "") + msgBox();
  }

  function renderDocuments(data, store, list, detail) {
    main.innerHTML = "<h2>Documents</h2>" + (detail ? renderDocDetail(detail, store) : renderStore(store) + renderDocList(list)) +
      "<h3>Official resolutions</h3>" + (data.resolutions.length ? data.resolutions.map(function (x) {
        return "<div class='card'><div class='row'><button class='btn' type='button' data-open-proposal='" + Number(x.proposalId) + "'>" + esc(x.number) + " &mdash; " + esc(x.title) + "</button></div><p class='muted'>" + when(x.finalizedAt) + " &middot; SHA-256 " + esc(x.contentHash) + "</p></div>";
      }).join("") : "<div class='card muted'>No official resolutions.</div>");
  }

  async function uploadDocument(form) {
    var fields = new FormData(form);
    var file = fields.get("file");
    var existing = form.getAttribute("data-document");
    var query = existing ? "documentId=" + encodeURIComponent(existing) : "folder=" + encodeURIComponent(fields.get("folder")) + "&title=" + encodeURIComponent(fields.get("title")) +
      (fields.get("description") ? "&description=" + encodeURIComponent(fields.get("description")) : "");
    try {
      await api("/api/documents?" + query + "&filename=" + encodeURIComponent(file.name), { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      await render();
      setMessage("Uploaded.");
    } catch (error) {
      setMessage(DOC_ERRORS[error.message] || errorMessage(error.message));
    }
  }

  async function renderGovernance(section, version) {
    var data;
    if (section === "proposals") {
      if (proposalId) {
        data = await api("/api/governance/proposals/" + Number(proposalId));
        if (version !== renderVersion || current !== section) return;
        return renderProposal(data);
      }
      data = await api("/api/governance/proposals" + (proposalFilter ? "?status=" + encodeURIComponent(proposalFilter) : ""));
      if (version !== renderVersion || current !== section) return;
      return renderProposalList(data);
    }
    if (section === "meetings" || section === "calendar") {
      if (meetingId && section === "meetings") {
        var results = await Promise.all([api("/api/governance/meetings/" + Number(meetingId)), api("/api/governance/directors")]);
        if (version !== renderVersion || current !== section) return;
        directorList = results[1].directors;
        return renderMeeting(results[0]);
      }
      data = await api("/api/governance/meetings");
      if (version !== renderVersion || current !== section) return;
      return renderMeetingList(data, section === "calendar");
    }
    if (section === "members") {
      var both = await Promise.all([api("/api/governance/directors"), api("/api/governance/rules")]);
      if (version !== renderVersion || current !== section) return;
      return renderMembers(both[0], both[1]);
    }
    if (section === "documents") {
      var parts = await Promise.all([api("/api/governance/resolutions"), api("/api/documents/folders").catch(function () { return null; })]);
      var store = parts[1];
      var list = null;
      var detail = null;
      if (store && docDetail) detail = await api("/api/documents/" + Number(docDetail)).catch(function () { return null; });
      else if (store) list = await api("/api/documents" + (docFolder ? "?folder=" + encodeURIComponent(docFolder) : "")).catch(function () { return null; });
      if (version !== renderVersion || current !== section) return;
      return renderDocuments(parts[0], store, list, detail);
    }
  }

  async function render() {
    if (!member || member.setupRequired) return;
    if (member.activationPending) return pendingScreen();
    var requestedSection = current;
    var version = ++renderVersion;
    try {
      if (requestedSection === "security") {
        renderSecurity();
        var posture = await api("/api/governance/dashboard").catch(function () { return null; });
        if (version !== renderVersion || !member || current !== requestedSection || !posture || !posture.integrations) return;
        main.innerHTML += securityExtras(posture);
        return;
      }
      if (NOT_OPERATIONAL[requestedSection]) return notOperational(requestedSection);
      if (GOVERNANCE_SECTIONS.indexOf(requestedSection) >= 0) return await renderGovernance(requestedSection, version);
      if (requestedSection === "board" || requestedSection === "audit") {
        var result = await api(requestedSection === "board" ? "/api/board" : "/api/audit");
        if (version !== renderVersion || !member || current !== requestedSection) return;
        return requestedSection === "board" ? renderBoard(result) : renderAudit(result);
      }
      var dashboardRequest = requestedSection === "overview" ? api("/api/governance/dashboard").catch(function () { return null; }) : null;
      var response = await api("/api/registry/summary");
      if (version !== renderVersion || !member || current !== requestedSection) return;
      var counts = response.summary.statusCounts;
      var summary = { pending: counts.pending, verified: counts.verified, closed: counts.closed };
      if (requestedSection === "registry") renderRegistry(summary);
      else renderOverview(summary);
      if (dashboardRequest) await appendDashboard(dashboardRequest, version, requestedSection);
    } catch (error) {
      if (version !== renderVersion || !member || current !== requestedSection) return;
      if (error.message === "authentication_required" || requestedSection === "board" || requestedSection === "audit" || GOVERNANCE_SECTIONS.indexOf(requestedSection) >= 0) return showError(error.message);
      if (requestedSection === "registry") return renderRegistry(null);
      renderOverview(null);
      if (requestedSection === "overview") await appendDashboard(api("/api/governance/dashboard").catch(function () { return null; }), version, requestedSection);
    }
  }

  var GOVERNANCE_SECTIONS = ["proposals", "meetings", "calendar", "members", "documents"];

  async function appendDashboard(request, version, section) {
    var dash = await request;
    if (version !== renderVersion || !member || current !== section || !dash || !dash.governance) return;
    main.innerHTML += renderDashboard(dash) + integrationList(dash.integrations);
  }

  function securityExtras(dash) {
    var html = "";
    if (dash.security) {
      html += "<div class='card'><h3>Deployment posture</h3><p>Environment: <strong>" + esc(dash.security.environment) + "</strong></p><p>Cloudflare Access configured: <strong>" + (dash.security.accessConfigured ? "yes" : "NO") + "</strong></p>" +
        "<p>President identity configured: <strong>" + (dash.security.presidentEmailConfigured ? "yes" : "NO") + "</strong></p><p class='muted'>" + esc(dash.security.mfa) + "</p></div>";
    }
    return html + integrationList(dash.integrations);
  }

  async function govAction(path, payload) {
    try {
      var result = await api("/api/governance/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (path === "proposals" && result.id) proposalId = result.id;
      if (path === "meetings" && result.id) meetingId = result.id;
      await render();
      setMessage("Saved." + (result.number ? " Resolution " + result.number + " recorded." : "") + (result.outcome ? " Outcome: " + result.outcome + "." : ""));
    } catch (error) {
      setMessage(errorMessage(error.message));
    }
  }

  function setMessage(text) {
    var box = document.getElementById("gov-message");
    if (box) box.textContent = text;
  }

  function formPayload(form) {
    var payload = {};
    new FormData(form).forEach(function (value, key) {
      var kind = key.slice(0, 2);
      if (kind === "n:") payload[key.slice(2)] = Number(value);
      else if (kind === "b:") payload[key.slice(2)] = true;
      else if (kind === "t:") payload[key.slice(2)] = new Date(value).getTime();
      else payload[key] = value;
    });
    Array.prototype.forEach.call(form.querySelectorAll("input[type=checkbox]"), function (box) {
      var name = box.getAttribute("name");
      if (name && name.slice(0, 2) === "b:" && !(name.slice(2) in payload)) payload[name.slice(2)] = false;
    });
    return payload;
  }

  // Keep the selected section across a browser refresh.
  function rememberSection(section) {
    try { if (window.history && window.history.replaceState) window.history.replaceState(null, "", "#" + section); } catch (error) { /* non-critical */ }
  }

  function restoreSection() {
    var hash = window.location && typeof window.location.hash === "string" ? window.location.hash.slice(1) : "";
    var button = Array.prototype.filter.call(nav.querySelectorAll("button"), function (b) { return b.getAttribute("data-s") === hash && !b.hidden; })[0];
    if (button) { current = hash; setActiveNav(hash); }
  }

  function setActiveNav(section) {
    Array.prototype.forEach.call(nav.querySelectorAll("button"), function (button) {
      button.classList.toggle("on", button.getAttribute("data-s") === section);
    });
  }

  main.addEventListener("change", function (event) {
    if (event.target && event.target.id === "doc-folder-filter") {
      docFolder = event.target.value;
      render();
    }
    if (event.target && event.target.id === "proposal-filter") {
      proposalFilter = event.target.value;
      render();
    }
  });

  main.addEventListener("click", async function (event) {
    var target = event.target;
    if (target.id === "check-activation") return start();
    if (typeof target.getAttribute !== "function") return;
    var open = target.getAttribute("data-open-proposal");
    var openMeeting = target.getAttribute("data-open-meeting");
    var post = target.getAttribute("data-gov-post");
    if (target.getAttribute("data-open-doc")) { docDetail = Number(target.getAttribute("data-open-doc")); return render(); }
    if (target.getAttribute("data-doc-back")) { docDetail = null; return render(); }
    if (target.getAttribute("data-doc-archive")) {
      if (!window.confirm("Archive this document? Its versions are kept.")) return;
      try { await api("/api/documents/" + Number(target.getAttribute("data-doc-archive")) + "/archive", { method: "POST" }); docDetail = null; return render(); } catch (error) { return setMessage(DOC_ERRORS[error.message] || errorMessage(error.message)); }
    }
    if (open) { current = "proposals"; proposalId = Number(open); setActiveNav(current); return render(); }
    if (openMeeting) { current = "meetings"; meetingId = Number(openMeeting); setActiveNav(current); return render(); }
    if (target.getAttribute("data-back")) { proposalId = null; meetingId = null; return render(); }
    if (!post) return;
    if (post === "directors/end" && !window.confirm("End this director's seat?")) return;
    var payload = {};
    if (target.getAttribute("data-choice")) payload.choice = target.getAttribute("data-choice");
    if (target.getAttribute("data-email")) payload.email = target.getAttribute("data-email");
    if (target.getAttribute("data-version")) payload.version = Number(target.getAttribute("data-version"));
    target.disabled = true;
    await govAction(post, payload);
    target.disabled = false;
  });

  nav.addEventListener("click", function (event) {
    var section = event.target.getAttribute("data-s");
    if (!section) return;
    current = section;
    proposalId = null;
    meetingId = null;
    docDetail = null;
    rememberSection(section);
    setActiveNav(section);
    render();
  });

  main.addEventListener("submit", async function (event) {
    var form = event.target;
    if (form.id === "doc-upload") {
      event.preventDefault();
      var docSubmit = form.querySelector("button");
      docSubmit.disabled = true;
      await uploadDocument(form);
      docSubmit.disabled = false;
      return;
    }
    var govPath = typeof form.getAttribute === "function" ? form.getAttribute("data-gov") : null;
    if (govPath) {
      event.preventDefault();
      var govSubmit = form.querySelector("button");
      govSubmit.disabled = true;
      await govAction(govPath, formPayload(form));
      govSubmit.disabled = false;
      return;
    }
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
      else { restoreSection(); render(); }
    } catch (error) {
      if (error.message === "invitation_required") showInvitation();
      else showError(error.message);
    }
  }

  start();
})();
