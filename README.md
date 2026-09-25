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

`functions/api/cis-verify.ts` and `functions/api/cis-submit.ts` are **structural
scaffolds**, not tested integrations. HMRC's CIS service (subcontractor
verification and CIS300 submission) is one of the older GovTalk/XML government
gateway services — not the newer OAuth/REST APIs used for VAT or Income Tax
MTD. Before either function will actually talk to HMRC, you need to:

1. Get the current CIS Online service documentation and the Government
   Gateway XML submission protocol details (the exact GovTalkMessage
   envelope, IRheader, and CIS body schema) from HMRC's Developer Hub / CIS
   Quality Standard documentation, and confirm the XML shape against it —
   what's in these files is a reasonable approximation, not a verified
   message.
2. Set your agent's Government Gateway credentials as **environment
   secrets** in Cloudflare Pages (never commit them):
   - `HMRC_GATEWAY_URL`
   - `HMRC_SENDER_ID`
   - `HMRC_SENDER_PASSWORD`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Test everything against HMRC's test gateway before it ever reaches the
   live endpoint. `cis_monthly_returns.is_sandbox` defaults to `true` so
   nothing goes live by accident.

Until then, the app is fully usable for tracking subcontractors, payments,
statements and building returns — the "Submit to HMRC" button will report
that the credentials/schema aren't configured yet rather than fail silently.

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
