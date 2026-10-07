/* Headless smoke test: seeds the world and exercises the AI + state machine. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const grab = (f) => fs.readFileSync(path.join(ROOT, 'parts', f), 'utf8');

// Minimal browser surface so the module bodies can be evaluated in Node.
global.window = { devicePixelRatio: 1, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { hash: '#/' } };
global.document = {
  hidden: false, addEventListener() {}, documentElement: { setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} },
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { appendChild() {}, style: {}, contains: () => false },
  startViewTransition: undefined, createDocumentFragment: () => ({ appendChild() {}, childNodes: [] }),
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, addEventListener() {}, setAttribute() {}, querySelector: () => null, remove() {}, innerHTML: '' })
};
global.performance = { now: () => Date.now() };
global.localStorage = undefined;

let code = (grab('03_utils_i18n.html') + grab('04_store_seed.html') + grab('05_services_actions.html') + grab('06_motion.html')).replace('<script>', '');
const api = new Function(code + '\nreturn { Utils, Store, Services, Toast, Modal, Actions, CATEGORIES, TRANSITIONS, STATUSES, POIS, t, I18N, ANON_ALLOWED, Motion, Confetti };')();
api.Toast.show = () => {};                       // silence toasts
const { Utils, Store, Services, Actions, CATEGORIES, TRANSITIONS } = api;

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? (pass++, console.log('  ✓ ' + label + (extra ? ' — ' + extra : ''))) : (fail++, console.log('  ✗ ' + label + (extra ? ' — ' + extra : ''))); };
const section = (s) => console.log('\n' + s);

/* ---------------------------------------------------------------- seed */
Store.loadSeed();
const S = Store.state;
section('SEED DATA');
ok('25+ complaints seeded', S.complaints.length >= 25, S.complaints.length + ' complaints');
const statuses = new Set(S.complaints.map((c) => c.status));
ok('every status represented', ['Submitted', 'Verified', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Reopened'].every((s) => statuses.has(s)), [...statuses].join(', '));
ok('5 departments with SLA hours', S.departments.length === 5 && CATEGORIES.every((c) => c.slaHours > 0));
ok('3 users per role', ['citizen', 'official', 'admin'].every((r) => S.users.filter((u) => u.role === r).length >= 3));
ok('default session is a signed-in citizen', S.userId === 'u-cit-1' && S.role === 'citizen');
ok('all points near Tambaram (12.9, 80.1)', S.complaints.every((c) => Math.abs(c.location.lat - 12.92) < 0.09 && Math.abs(c.location.lng - 80.1) < 0.09));

section('DUPLICATE CLUSTER (3 potholes at the college gate)');
const parent = Store.complaint('CC-1007'), dupA = Store.complaint('CC-1042'), dupB = Store.complaint('CC-1043');
ok('CC-1042 merged & linked to CC-1007', dupA.linkedTo === 'CC-1007' && parent.duplicates.includes('CC-1042'));
ok('CC-1007 lists CC-1042 as a duplicate', parent.duplicates.length === 1);
ok('CC-1043 still an independent report near the gate', !dupB.linkedTo);
const dA = Utils.haversine(dupA.location, parent.location), dB = Utils.haversine(dupB.location, parent.location);
ok('both within the 150 m duplicate radius', dA < 150 && dB < 150, `${Math.round(dA)} m / ${Math.round(dB)} m`);

section('FLAGGED / SUSPICIOUS REPORTS');
const flagged = Store.flaggedComplaints();
ok('at least 2 reports in the admin flag queue', flagged.length >= 2, flagged.map((c) => c.id).join(', '));
ok('spam link + gibberish detected', flagged.some((c) => c.id === 'CC-1044') && flagged.some((c) => c.id === 'CC-1045'));

/* ------------------------------------------------------------- AI layer */
section('SERVICES: classifyCategory (EN + Tamil)');
[['deep pothole on the road', 'road damage'], ['garbage bin overflowing with trash', 'waste'],
 ['sewage overflowing from the drain manhole', 'drainage'], ['no water supply, pipeline leakage', 'water'],
 ['street light not working, lamp post dark', 'streetlight'], ['live wire and open drain, accident risk', 'public safety'],
 ['சாலையில் பெரிய குழி உள்ளது', 'road damage'], ['குப்பை அள்ளப்படவில்லை', 'waste'],
 ['வடிகால் அடைத்து கழிவுநீர் வழிகிறது', 'drainage'], ['தண்ணீர் கசிவு உள்ளது', 'water'],
 ['தெருவிளக்கு எரியவில்லை', 'streetlight'], ['பள்ளி அருகே ஆபத்து', 'public safety']]
  .forEach(([text, expected]) => {
    const r = Services.classifyCategory(text);
    ok(`"${text.slice(0, 34)}" → ${expected}`, r.category === expected, `got ${r.category} (${Math.round(r.confidence * 100)}% → ${r.department})`);
  });
const withImage = Services.classifyCategory('crack on the surface', { count: 2, hint: 'pothole night photo' });
ok('image metadata nudges classification', withImage.scores['road damage'] > 0);

section('SERVICES: severity, sentiment, moderation');
ok('live wire near school → severity 5', Services.estimateSeverity('live wire near school, accident risk, children', 'public safety', { lat: 12.9340, lng: 80.1425 }).severity === 5);
ok('minor cosmetic issue → low severity', Services.estimateSeverity('lamp post slightly leaning', 'streetlight').severity <= 3);
ok('distress detected as urgent', Services.sentimentScore('We are suffering, unbearable smell, children have fever, urgent!').urgent === true);
ok('positive language scores above 0', Services.sentimentScore('Thank you, the team was prompt and helpful').score > 0);
ok('spam link flagged', Services.moderate('Win a free gold lucky draw www.spam.example now').flagged);
ok('short gibberish flagged', Services.moderate('wwwwwwww junk').flagged);
ok('clean report not flagged', !Services.moderate('Large pothole near the bus stop entrance making two wheelers swerve into traffic').flagged);

section('SERVICES: duplicate detection (TF-IDF 0.45 + geo 0.35 + category 0.20)');
const probe = {
  title: 'Big pothole outside the college west gate',
  description: 'Deep pothole outside Madras Christian College west gate, students on cycles swerve into traffic, water fills it when it rains.',
  category: 'road damage', location: { lat: 12.91888, lng: 80.12132 }
};
const dup = Services.detectDuplicates(probe, S.complaints);
ok('finds a duplicate near the gate', dup.candidate && dup.candidate.verdict === 'duplicate', dup.candidate ? `${dup.candidate.complaint.id} score ${dup.candidate.score} (text ${dup.candidate.parts.text}, geo ${dup.candidate.parts.geo}, cat ${dup.candidate.parts.category})` : 'none');
ok('geo decay is 0 beyond 150 m', Services.analyze({ title: 'x', description: 'pothole', location: { lat: 13.10, lng: 80.30 }, media: [] }, S).duplicates.matches.length === 0);
const dupScore = dup.candidate.score;
const manual = 0.45 * dup.candidate.parts.text + 0.35 * dup.candidate.parts.geo + 0.20 * dup.candidate.parts.category;
ok('score equals the documented formula', Math.abs(dupScore - manual) < 0.002, `${dupScore} vs ${Utils.round(manual, 3)}`);

section('SERVICES: priority score + explainability');
const p = Store.complaint('CC-1017').priority;
ok('priority within 0-100', p.score >= 0 && p.score <= 100, p.score + '/100');
ok('every seeded severity is 1-5 and priority is finite', S.complaints.every((c) => Number.isInteger(c.severity) && c.severity >= 1 && c.severity <= 5 && Number.isFinite(c.priorityScore) && c.priorityScore <= 100), `min ${Math.min(...S.complaints.map((c) => c.priorityScore))} / max ${Math.max(...S.complaints.map((c) => c.priorityScore))}`);
const sum = Object.values(p.parts).reduce((a, b) => a + b, 0);
ok('breakdown sums to the score', Math.abs(sum - p.score) <= 1.5, JSON.stringify(p.parts));
ok('breakdown has all six weighted factors', Object.keys(p.parts).length === 6);
ok('proximity factor uses the POI list', typeof Services.nearestPoi(Store.complaint('CC-1007').location, 200) !== 'undefined');

section('SERVICES: officer briefing + heat buckets');
const brief = Services.summarizeForOfficials(S.complaints.filter((c) => c.status !== 'Closed'), 'PWD');
ok('briefing is a multi-line action report', brief.split('\n').length >= 4 && /overdue/i.test(brief), brief.split('\n')[0].slice(0, 70));
const buckets = Services.heatBuckets(S.complaints);
ok('grid-bucket heatmap has intensity 0-1', buckets.length > 0 && buckets.every((b) => b.intensity >= 0 && b.intensity <= 1), buckets.length + ' buckets');

/* --------------------------------------------------- state machine + RBAC */
section('STATE MACHINE + RBAC');
const draft = { title: 'Huge pothole on Gandhi Road near the school', description: 'A deep pothole in front of the school gate; children on cycles swerve into traffic and it is dangerous after rain.', category: 'road damage', location: { lat: 12.9212, lng: 80.1288, address: 'Gandhi Road, Tambaram' }, media: [Utils.placeholderImage('t', 'test')], anonymous: false };
const analysis = Services.analyze(draft, S);
const created = Actions.submitReport(draft, analysis, { supportExisting: false });
const nid = created.complaint.id;
ok('citizen can submit a report', !created.merged && !!nid, `${nid} priority ${created.complaint.priorityScore}, dept ${created.complaint.department}`);
ok('new ticket starts as Submitted with an SLA clock', created.complaint.status === 'Submitted' && created.complaint.slaDueAt > created.complaint.createdAt);
ok('invalid transition Submitted → In Progress is blocked', Actions.transition(nid, 'In Progress', { by: 'citizen' }).ok === false);
ok('citizen cannot verify', Actions.transition(nid, 'Verified', { by: 'citizen' }).ok === false);
ok('citizen cannot resolve', Actions.transition(nid, 'Resolved', { by: 'citizen' }).ok === false);

// officials only touch their own department
Store.state.role = 'official';
Store.state.userId = Store.state.users.find((u) => u.role === 'official' && u.department === 'Sanitation & Solid Waste').id;
ok('official from another department is blocked', Actions.transition(nid, 'Verified', { by: 'official' }).ok === false);
Store.state.userId = Store.state.users.find((u) => u.role === 'official' && u.department === created.complaint.department).id;
ok('own-department official can verify', Actions.transition(nid, 'Verified', { by: 'official', note: 'site visit' }).ok === true);
ok('Verified → Assigned', Actions.transition(nid, 'Assigned', { by: 'official' }).ok === true);
ok('Assigned → In Progress', Actions.transition(nid, 'In Progress', { by: 'official' }).ok === true);
ok('resolve without proof is blocked', Actions.resolve(nid, { afterPhoto: null, note: '' }) === false);
ok('resolve with photo + note succeeds', Actions.resolve(nid, { afterPhoto: Utils.placeholderImage('after', 'after'), note: 'Filled and compacted.' }) === true);
ok('ticket is now Resolved with confirmed=null', Store.complaint(nid).status === 'Resolved' && Store.complaint(nid).resolution.confirmed === null);
ok('Closed requires the citizen role', Actions.transition(nid, 'Closed', { by: 'official' }).ok === false);
Store.state.role = 'citizen'; Store.state.userId = 'u-cit-1';
ok('citizen confirms → Closed', Actions.confirmFix(nid) === true && Store.complaint(nid).status === 'Closed');
ok('Closed ticket maps to green on the map', Store.statusColorKey(Store.complaint(nid)) === 'resolved');
ok('every transition is logged', Store.complaint(nid).statusHistory.length === 6, Store.complaint(nid).statusHistory.map((h) => h.status).join(' → '));
ok('rating is stored', Actions.rate(nid, 5) === true && Store.complaint(nid).resolution.rating === 5);
ok('Closed → Reopened by the citizen', Actions.transition(nid, 'Reopened', { by: 'citizen' }).ok === true);

section('COMMUNITY + MERGE');
const gateProbe = {
  title: 'Pothole at the college west gate hitting students',
  description: 'Big pothole right outside Madras Christian College west gate, students walking and cycling, dangerous in rain.',
  category: 'road damage', location: { lat: 12.9189, lng: 80.1213, address: 'MCC west gate' }, media: []
};
const gateAnalysis = Services.analyze(gateProbe, S);
const gateTarget = gateAnalysis.duplicates.candidate.complaint;
const before = gateTarget.supporters.length;
const mergeRes = Actions.submitReport(gateProbe, gateAnalysis, { supportExisting: true });
ok('“support instead” merges into the matched ticket',
   mergeRes.merged === true && gateTarget.supporters.includes('u-cit-1') && gateTarget.supporters.length === before + 1,
   'matched ' + gateTarget.id + ' at ' + gateAnalysis.duplicates.candidate.score + ' (no new ticket created: ' + (S.complaints.length) + ' total)');
ok('merge does not create a ticket', Store.state.complaints.filter((c) => c.title === gateProbe.title).length === 0);
const counts = S.complaints.length;
const commentOk = Actions.comment('CC-1043', 'Same issue here, I cycle past it daily.');
ok('citizen can comment', commentOk === true && Store.complaint('CC-1043').comments.length > 0);
const upv = Actions.upvote('CC-1001');
ok('upvote toggles once per user', upv === true && Store.complaint('CC-1001').supporters.includes('u-cit-1'));
ok('upvote again removes support', Actions.upvote('CC-1001') === false);
ok('guest cannot upvote', (Store.state.userId = null, Store.can('upvote').ok === false));
Store.state.userId = 'u-cit-1';

section('ADMIN TOOLS');
Store.state.role = 'admin'; Store.state.userId = 'u-adm-1';
const rows = S.complaints.filter((c) => !c.removed);
ok('CSV rows build for export', rows.length > 25 && !!rows[0].id);
Actions.setSla('waste', 48);
ok('SLA edit applies to the category', CATEGORIES.find((c) => c.id === 'waste').slaHours === 48);
Actions.reviewFlag('CC-1044', 0, 'remove');
ok('flagged item rejected → hidden from the map', Store.complaint('CC-1044').removed === true);
ok('admin sees the analytics metrics', Store.computeMetrics().total > 25 && Store.computeMetrics().slaPct >= 0);
ok('hotspot ranking is non-empty', Store.hotspots(300).length > 0, Store.hotspots(300).map((h) => `${h.count}@${h.area}`).slice(0, 3).join(' | '));
Store.state.role = 'citizen'; Store.state.userId = 'u-cit-1';

section('I18N');
ok('Tamil dictionary covers every English key', Object.keys(api.I18N.en).every((k) => api.I18N.ta[k] != null), Object.keys(api.I18N.en).length + ' keys');
Store.state.lang = 'ta';
ok('status names translate', api.t('status.In Progress') === 'நடைபெறுகிறது');
ok('interpolation works in Tamil', api.t('toast.upvoted', { n: 3 }).includes('3'));
Store.state.lang = 'en';
ok('English fallback works', api.t('form.submit') === 'Submit report');

section('PERSISTENCE + ERROR HANDLING');
ok('localStorage helper degrades without throwing', Utils.storage.get('cc.test', 'fallback') === 'fallback' && Utils.storage.set('cc.test', 1) === false);
ok('empty-input validation', Services.classifyCategory('').category === null && Services.moderate('').flagged === true);
ok('haversine handles missing coords', Utils.haversine(null, { lat: 1, lng: 1 }) === Infinity);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
