import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(new URL('../../admin-prototype/approvals-center.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const { buildQueue } = sandbox.window.RFFApprovals;
const proposal = (id, status, authorEmail='other@example.org', category='policy') => ({ id, title:`Proposal ${id}`,status,authorEmail,category,updatedAt:1700000000000 });
const member = (permissions, status='active') => ({email:'president@example.org',status,permissions});

test('actions are sorted by workflow priority and counted from real proposals', () => {
  const list=[proposal(5,'passed'),proposal(4,'ready'),proposal(3,'voting'),proposal(2,'submitted'),proposal(1,'draft')];
  const data=buildQueue(list,{votesNeeded:[{id:3}]},member(['proposals:review','meetings:manage','votes:cast','resolutions:finalize']));
  assert.equal(data.items.map(x=>x.kind).join(','),'review,vote,agenda,finalize');
  assert.equal(data.counts.total,4);
  assert.equal(data.counts.review,1);
  assert.equal(data.counts.vote,1);
  assert.equal(data.counts.agenda,1);
  assert.equal(data.counts.finalize,1);
});

test('cannot queue review of your own proposal', () => {
  const x=buildQueue([proposal(1,'submitted','president@example.org')], {votesNeeded:[]},member(['proposals:review']));
  assert.equal(x.counts.total,0);
});

test('vote only appears when server dashboard explicitly marks it needed', () => {
  const x=buildQueue([proposal(1,'voting')], {votesNeeded:[]},member(['votes:cast']));
  assert.equal(x.counts.vote,0);
});

test('inactive and unprivileged members do not get actionable queue items', () => {
  const list=[proposal(1,'submitted'),proposal(2,'ready'),proposal(3,'passed')];
  assert.equal(buildQueue(list,{votesNeeded:[]},member([])).counts.total,0);
  assert.throws(()=>buildQueue(list,{votesNeeded:[]},member(['proposals:review'],'pending')),/unavailable/);
});

test('a grant-category BOARD proposal is not a grant payment authorization', () => {
  const x=buildQueue([proposal(1,'submitted','other@example.org','grant')],{votesNeeded:[]},member(['proposals:review']));
  assert.equal(x.items[0].kind,'review');
  assert.equal(x.items[0].category,'grant');
  assert.ok(!('payment' in x.items[0]));
});

test('missing or malformed data fails closed instead of fabricating empty totals', () => {
  assert.throws(()=>buildQueue(null,{votesNeeded:[]},member([])),/unavailable/);
  assert.throws(()=>buildQueue([],null,member([])),/unavailable/);
  assert.equal(buildQueue([{id:'oops',status:'submitted'}],{votesNeeded:[]},member(['proposals:review'])).counts.total,0);
});

test('queue is navigation-only, never writing to finance, registry or mail', () => {
  assert.doesNotMatch(src, /fetch\s*\(|\.post\s*\(|payments\s*:\s*authorize/);
  assert.match(src, /server/);
});
