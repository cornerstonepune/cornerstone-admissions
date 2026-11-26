// Local seed (ADR 0006: "the first owner is created by a local seed script"). Local Supabase only (ADR 0009).
//
//   npm run db:seed:local -- you@example.com
//
// Creates, or finds: the Cornerstone admissions account, an owner user with that email (confirmed, no password: set one
// through Forgot password; the email lands in local Mailpit), the Admissions pipeline with its six stages, the
// settings the board reads, and 8 obviously fake sample leads. Running it again changes nothing.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const ACCOUNT_NAME = 'Cornerstone admissions';
const PIPELINE_NAME = 'Admissions';
const STAGES = [
  'Enquiry',
  'Visit booked',
  'Visited',
  'Deciding',
  'Applied',
  'Admitted',
]; // GLOSSARY; order is fixed

// Defaults from design/wireframes/S-admissions-settings.html.
const SETTINGS = [
  ['campus', 'neev', 'Neev', { grades: 'Playgroup – Sr KG' }],
  ['campus', 'gurukul', 'Gurukul', { grades: 'Grade 1 – Grade 7' }],
  ...[
    'WhatsApp',
    'Website',
    'Walk-in',
    'Phone call',
    'Gate QR',
    'Instagram',
    'Open-house event',
    'Referral card',
  ].map((label) => [
    'source',
    label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label,
    {},
  ]),
  ...['Distance', 'Fees', 'Chose another school', 'Moved city'].map((label) => [
    'lost_reason',
    label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label,
    {},
  ]),
  ['alert', 'untouched', 'Untouched after (hours)', { threshold: 24 }],
  ...[
    ['Enquiry', 5],
    ['Visit booked', 7],
    ['Visited', 7],
    ['Deciding', 21],
    ['Applied', 10],
  ].map(([stage, days]) => [
    'alert',
    `stuck_${stage.toLowerCase().replace(/ /g, '_')}`,
    `Stuck in ${stage} after (days)`,
    { stage, threshold: days },
  ]),
];

// Made-up families. Phones are +91 90000 000xx: clearly fake.
const LEADS = [
  {
    parent: 'Asha Kulkarni',
    child: 'Ira Kulkarni',
    grade: 'Nursery',
    campus: 'neev',
    source: 'whatsapp',
    stage: 'Enquiry',
    days: 1,
  },
  {
    parent: 'Rohit Deshmukh',
    child: 'Kabir Deshmukh',
    grade: 'Grade 2',
    campus: 'gurukul',
    source: 'instagram',
    stage: 'Enquiry',
    days: 3,
  },
  {
    parent: 'Priya Iyer',
    child: 'Anaya Iyer',
    grade: 'Jr KG',
    campus: 'neev',
    source: 'gate_qr',
    stage: 'Visit booked',
    days: 2,
  },
  {
    parent: 'Sameer Joshi',
    child: 'Vihaan Joshi',
    grade: 'Grade 4',
    campus: 'gurukul',
    source: 'referral_card',
    stage: 'Visited',
    days: 12,
    note: 'stuck',
  },
  {
    parent: 'Neha Patil',
    child: 'Myra Patil',
    grade: 'Sr KG',
    campus: 'neev',
    source: 'website',
    stage: 'Deciding',
    days: 6,
  },
  {
    parent: 'Arjun Mehta',
    child: 'Advait Mehta',
    grade: 'Grade 1',
    campus: 'gurukul',
    source: 'open_house_event',
    stage: 'Applied',
    days: 4,
  },
  {
    parent: 'Kavita Rao',
    child: 'Saanvi Rao',
    grade: 'Playgroup',
    campus: 'neev',
    source: 'walk_in',
    stage: 'Admitted',
    days: 9,
  },
  {
    parent: 'Vikram Shinde',
    child: 'Reyansh Shinde',
    grade: 'Grade 6',
    campus: 'gurukul',
    source: 'phone_call',
    stage: 'Deciding',
    days: 15,
    lost: 'chose_another_school',
  },
].map((l, i) => ({
  ...l,
  phone: `+91 90000 000${String(i + 1).padStart(2, '0')}`,
}));

function die(msg) {
  console.error(`\nseed-local: ${msg}\n`);
  process.exit(1);
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  die("pass the owner's email: npm run db:seed:local -- you@example.com");

// Read .env.local ourselves: `node --env-file` never overrides variables already in the shell, so a hosted key
// exported in a shell profile would silently win over the local one.
let env;
try {
  env = parseEnv(readFileSync('.env.local', 'utf8'));
} catch {
  die(
    'no .env.local here. Run from the repo root; copy .env.local.example and fill it from `supabase status`.'
  );
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  die(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local'
  );
let host;
try {
  host = new URL(url).hostname;
} catch {
  die(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`);
}
if (host !== '127.0.0.1' && host !== 'localhost') {
  die(
    `refusing to run: ${url} is not local Supabase. This seed only runs against 127.0.0.1 or localhost (ADR 0009).`
  );
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Throws on a Supabase error, returns data otherwise. */
function ok({ data, error }, what) {
  if (error) die(`${what}: ${error.message}`);
  return data;
}

async function findUser() {
  for (let page = 1; ; page++) {
    const { users } = ok(
      await db.auth.admin.listUsers({ page, perPage: 1000 }),
      'list users'
    );
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit || users.length < 1000) return hit;
  }
}

// 1. Owner user: confirmed, no password.
let user = await findUser();
if (!user)
  user = ok(
    await db.auth.admin.createUser({ email, email_confirm: true }),
    'create user'
  ).user;

// 2. Account. Upstream has no callable "create account" function (handle_new_user was a sign-up trigger, dropped in
//    102), so this does its two inserts: the account, then the owner's profile.
let account = ok(
  await db
    .from('accounts')
    .select('id, owner_user_id')
    .eq('name', ACCOUNT_NAME)
    .maybeSingle(),
  'find account'
);
if (account && account.owner_user_id !== user.id) {
  die(
    `"${ACCOUNT_NAME}" already exists with another owner. Invite ${email} from Settings → Team instead.`
  );
}
if (!account) {
  account = ok(
    await db
      .from('accounts')
      .insert({
        name: ACCOUNT_NAME,
        owner_user_id: user.id,
        default_currency: 'INR',
      })
      .select('id, owner_user_id')
      .single(),
    'create account'
  );
}
const accountId = account.id;

// 3. Owner profile, as redeem_invitation (102) makes one: user_id, full_name, email, account_id, account_role.
const profile = ok(
  await db
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle(),
  'find profile'
);
if (!profile) {
  ok(
    await db
      .from('profiles')
      .insert({
        user_id: user.id,
        full_name: '',
        email,
        account_id: accountId,
        account_role: 'owner',
      }),
    'create profile'
  );
} else if (
  profile.account_id !== accountId ||
  profile.account_role !== 'owner'
) {
  die(
    `${email} already has a profile in another account or role (${profile.account_role}); not touching it.`
  );
}

// 4. Admissions pipeline and its six stages. Created before anyone opens the board, so the board's
//    "seed a default pipeline when there is none" never runs.
let pipeline = ok(
  await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', PIPELINE_NAME)
    .maybeSingle(),
  'find pipeline'
);
if (!pipeline) {
  pipeline = ok(
    await db
      .from('pipelines')
      .insert({ user_id: user.id, account_id: accountId, name: PIPELINE_NAME })
      .select('id')
      .single(),
    'create pipeline'
  );
}
const existingStages = ok(
  await db
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', pipeline.id),
  'list stages'
);
const stageId = {};
for (const [position, name] of STAGES.entries()) {
  stageId[name] =
    existingStages.find((s) => s.name === name)?.id ??
    ok(
      await db
        .from('pipeline_stages')
        .insert({ pipeline_id: pipeline.id, name, position })
        .select('id')
        .single(),
      `create stage ${name}`
    ).id;
}

// 5. Settings. ON CONFLICT DO NOTHING: an existing row (maybe edited by an admin) is left alone.
ok(
  await db.from('admissions_settings').upsert(
    SETTINGS.map(([kind, key, label, value], sort_order) => ({
      account_id: accountId,
      kind,
      key,
      label,
      value,
      sort_order,
    })),
    { onConflict: 'account_id,kind,key', ignoreDuplicates: true }
  ),
  'create settings'
);
const settingId = {};
for (const s of ok(
  await db
    .from('admissions_settings')
    .select('id, kind, key')
    .eq('account_id', accountId),
  'list settings'
)) {
  settingId[`${s.kind}:${s.key}`] = s.id;
}

// 6. Sample leads: contact → deal → lead. A contact that already has a lead is skipped whole.
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
let added = 0;
for (const l of LEADS) {
  let contact = ok(
    await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', l.phone)
      .maybeSingle(),
    `find contact ${l.phone}`
  );
  if (!contact) {
    contact = ok(
      await db
        .from('contacts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          phone: l.phone,
          name: l.parent,
        })
        .select('id')
        .single(),
      `create contact ${l.phone}`
    );
  }
  const hasLead =
    ok(
      await db.from('leads').select('id').eq('contact_id', contact.id).limit(1),
      'find lead'
    ).length > 0;
  if (hasLead) continue;

  const deal = ok(
    await db
      .from('deals')
      .insert({
        user_id: user.id,
        account_id: accountId,
        pipeline_id: pipeline.id,
        stage_id: stageId[l.stage],
        contact_id: contact.id,
        title: l.child,
        currency: 'INR',
      })
      .select('id')
      .single(),
    `create deal ${l.child}`
  );
  const lead = ok(
    await db
      .from('leads')
      .insert({
        account_id: accountId,
        deal_id: deal.id,
        contact_id: contact.id,
        child_name: l.child,
        grade: l.grade,
        campus_id: settingId[`campus:${l.campus}`],
        source_id: settingId[`source:${l.source}`],
        // Entering the last stage admits a lead (move_lead, 113).
        admitted_at: l.stage === STAGES.at(-1) ? daysAgo(l.days) : null,
        exit: l.lost ? 'lost' : null,
        exited_at: l.lost ? daysAgo(1) : null,
        lost_reason_id: l.lost ? settingId[`lost_reason:${l.lost}`] : null,
      })
      .select('id')
      .single(),
    `create lead ${l.child}`
  );
  // 104's trigger wrote one history row at now(); backdate it so days in stage varies.
  ok(
    await db
      .from('lead_stage_history')
      .update({ entered_at: daysAgo(l.days) })
      .eq('lead_id', lead.id),
    'backdate stage entry'
  );
  added++;
}

// 7. What exists now.
const countIn = async (table) => {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (error) die(`count ${table}: ${error.message}`);
  return count;
};
const leads = await countIn('leads');
const settings = await countIn('admissions_settings');
// shortcut: Mailpit's port is the Supabase CLI default (54324); supabase/config.toml doesn't override it.
const mailpit = `http://${host}:54324`;

console.log(`
Local seed done (${added} new sample lead${added === 1 ? '' : 's'} this run).
  Account   ${ACCOUNT_NAME} (${accountId})
  Owner     ${email} — profile role owner, no password yet
  Pipeline  ${PIPELINE_NAME}: ${STAGES.join(' → ')}
  Settings  ${settings} rows (campuses, sources, lost reasons, untouched + stuck alerts)
  Leads     ${leads} in this account

Next: run \`npm run dev\`, open http://127.0.0.1:3000/forgot-password, enter ${email}, then open the email at
${mailpit} and follow its link to set a password.
(Use 127.0.0.1, not localhost: local Supabase only lets the reset link come back to its site URL, http://127.0.0.1:3000.)
`);
