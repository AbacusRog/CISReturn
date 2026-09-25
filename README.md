# CIS Monthly Return

Multi-client tool for managing Construction Industry Scheme (CIS) subcontractors,
monthly payments, Payment & Deduction Statements, and CIS300 monthly returns —
built on React/Vite + Supabase + Cloudflare Pages, matching the stack used across
the other Abacus internal apps.

## What's built

- **Contractors** — the contractor clients Abacus acts as agent for
- **Subcontractors** — per contractor, with registered details and a "Verify
  with HMRC" action
- **Payments** — monthly gross/materials/deduction entry per subcontractor,
  with the tax-month-based due dates CIS uses (6th–5th)
- **Monthly Returns** — builds a CIS300 from finalised payments for a tax
  month (including nil returns), tracks status through draft → ready →
  submitted
- **Payment & Deduction Statements** — once a payment is finalised, generate
  the statement PDF client-side (stored in Supabase Storage under
  `cis-statements`), download it, or email it to the subcontractor via
  Resend (needs `RESEND_API_KEY` / `RESEND_FROM_EMAIL` set — see Setup)

## What is NOT yet working: the actual HMRC submission

`functions/api/cis-verify.ts` and `functions/api/cis-submit.ts` build and
send a real GovTalk XML envelope now (confirmed against HMRC's public
"Transaction Engine: Document Submission Protocol"), but the **body content
specific to CIS** (the actual verification/CIS300 fields) is still a
placeholder, because HMRC does not publish that schema openly.

**Confirmed facts** (from HMRC's public documentation):
- Submission endpoints: test
  `https://test-transaction-engine.tax.service.gov.uk/submission`, live
  `https://transaction-engine.tax.service.gov.uk/submission`.
- Credentials are a Government Gateway SenderID + password, sent inside the
  GovTalkMessage envelope (not OAuth, unlike VAT/MTD).
- A `GatewayTest` flag distinguishes test traffic from live.
- An older CIS "Electronic Data Interchange" (EDI) spec was withdrawn by
  HMRC in 2019 — that's a different, older technology than the GovTalk/XML
  gateway used here, so it doesn't mean this route is dead, but it's a sign
  these things move and are worth confirming directly with HMRC rather than
  trusting an old PDF.

**What you actually need to do next** — this isn't a "read more docs"
problem, the remaining piece isn't publicly published:
1. Register as a software developer with HMRC's **Software Developer
   Support (SDS)** team (via the Developer Hub, or by contacting them
   directly) to get a Vendor ID.
2. They'll issue test Government Gateway credentials, the real CIS
   verification/CIS300 request-response schema, and sample test-scenario
   files.
3. Build against those, submit the test scenarios, and HMRC confirms your
   software as "recognised" — normally about 10 working days once your test
   files are valid.
4. Only then switch `HMRC_GATEWAY_URL` to the live endpoint and drop
   `HMRC_GATEWAY_TEST`.

Set your agent's credentials as **environment secrets** in Cloudflare Pages
(never commit them):
- `HMRC_GATEWAY_URL` (test or live URL above)
- `HMRC_SENDER_ID`
- `HMRC_SENDER_PASSWORD`
- `HMRC_GATEWAY_TEST` (`1` while testing; unset once live)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`cis_monthly_returns.is_sandbox` defaults to `true` so nothing is flagged as
a live submission by accident even once this is wired up. Until SDS
registration is done, the app is fully usable for tracking subcontractors,
payments, statements and building returns — the "Submit to HMRC" button
will report plainly that credentials aren't configured yet.

## Setup

1. Copy `.env.example` to `.env` and fill in the Supabase project URL/anon
   key (already pointing at the TeamSpirits Supabase project, where the
   `cis_*` tables live).
2. `npm install`
3. `npm run dev` to run locally, or `npm run build` then upload the
   contents of `dist/` (plus the `functions/` folder) via Cloudflare
   Pages, same as your other apps.
4. Create your own Supabase Auth user(s) to sign in with, and add a row to
   `cis_user_roles` for each (role `staff` or `admin`).
5. To enable emailing statements, set these as environment secrets in
   Cloudflare Pages:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL` (e.g. `Abacus Consultancy <cis@abacusconsultancy.co.uk>`)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   Without these, "Generate statement" and "Download" still work — only
   "Email" needs them.

## Database

All tables are prefixed `cis_` in the TeamSpirits Supabase project:
`cis_contractors`, `cis_subcontractors`, `cis_verification_requests`,
`cis_payments`, `cis_statements`, `cis_monthly_returns`, `cis_return_lines`,
`cis_user_roles`.

## Not yet built

- CSV import for subcontractors
- Corrections/reopening a finalised month
