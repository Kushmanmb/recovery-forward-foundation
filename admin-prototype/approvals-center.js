/* RFF Presidential Approvals Center: client-side routing model only.
   All decisions continue through existing authorized governance endpoints. */
(function (root) {
  'use strict';

  const PRIORITIES = Object.freeze({ review: 0, vote: 1, agenda: 2, finalize: 3 });
  const ACTIONS = Object.freeze({
    review: { title: 'Review requested', button: 'Review proposal', detail: 'Independent proposal review required' },
    vote: { title: 'Your vote requested', button: 'Open ballot', detail: 'Voting eligibility is confirmed by the server' },
    agenda: { title: 'Ready for agenda', button: 'Schedule on agenda', detail: 'Assign this reviewed proposal to a meeting' },
    finalize: { title: 'Resolution processing', button: 'Review finalization', detail: 'Finalization requires server governance checks' }
  });

  /** Never decides eligibility itself: access checks and transitions run on the server.
   *  Only exposes navigation to pre-existing governance actions. */
  function buildQueue(proposals, dashboard, member) {
    if (!Array.isArray(proposals) || !dashboard || !member || member.status !== 'active') {
      throw new Error('approval_queue_unavailable');
    }
    const perms = new Set(Array.isArray(member.permissions) ? member.permissions : []);
    const voterIds = new Set(Array.isArray(dashboard.votesNeeded)
      ? dashboard.votesNeeded.filter(v => Number.isSafeInteger(v.id) && v.id > 0).map(v => v.id) : []);
    const items = [];
    for (const proposal of proposals) {
      if (!proposal || !Number.isSafeInteger(proposal.id) || proposal.id <= 0) continue;
      let kind = null;
      if (proposal.status === 'submitted' && perms.has('proposals:review') &&
          proposal.authorEmail !== member.email) kind = 'review';
      else if (proposal.status === 'voting' && perms.has('votes:cast') && voterIds.has(proposal.id)) kind = 'vote';
      else if (proposal.status === 'ready' && perms.has('meetings:manage')) kind = 'agenda';
      else if (proposal.status === 'passed' && perms.has('resolutions:finalize')) kind = 'finalize';
      if (!kind) continue;
      const meta = ACTIONS[kind];
      items.push({ id: proposal.id, title: String(proposal.title || 'Untitled proposal'),
        category: String(proposal.category || 'governance'), kind, state: meta.title,
        action: meta.button, description: meta.detail,
        updatedAt: Number.isSafeInteger(proposal.updatedAt) && proposal.updatedAt > 0 ? proposal.updatedAt : null });
    }
    items.sort((a, b) => PRIORITIES[a.kind] - PRIORITIES[b.kind] ||
      (b.updatedAt || 0) - (a.updatedAt || 0) || a.id - b.id);
    return { items, counts: {
      review: items.filter(x => x.kind === 'review').length,
      vote: items.filter(x => x.kind === 'vote').length,
      agenda: items.filter(x => x.kind === 'agenda').length,
      finalize: items.filter(x => x.kind === 'finalize').length,
      total: items.length
    }};
  }

  root.RFFApprovals = Object.freeze({ buildQueue });
})(typeof window !== 'undefined' ? window : globalThis);
