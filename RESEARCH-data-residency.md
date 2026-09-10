# Where the books live: s.35(7), the PDPA, and what we can do about it

Researched 2026-09-10, at the owner's request, after the client spec in
`DESIGN-suppliers-purchases.md` drove straight into the blocker
`RESEARCH-accounts.md` §2.3 had already flagged.

**I am not a lawyer and this is not legal advice.** It is a technical and
commercial briefing meant to make a conversation with a Tanzanian tax and data
lawyer short and specific. Every legal statement below is sourced.

---

## 0. The short version

1. **The database is in the United States.** Confirmed, not assumed:
   `projects/sanitaryflow-erp/databases/(default)` is in location **`nam5`**, a
   US multi-region. `RESEARCH-accounts.md` §2.3 flagged this as unchecked; it is
   now checked, and the answer is the least convenient one available.

2. **There are TWO obligations here, not one.** The earlier research found
   s.35(7). It missed the second, which is the one already being enforced:
   the **Personal Data Protection Act 2022** requires registration with the
   PDPC *before* processing personal data, and a **separate permit** to move
   personal data outside Tanzania. Enforcement began **9 April 2026** — five
   months ago.

3. **A Firestore database cannot change region.** The location is fixed at
   creation. "Move it to Tanzania" is not a setting; it is a new database and a
   full migration — and there is no Firestore region in Tanzania to move to.

4. **The two obligations have very different risk profiles.** s.35(7) is
   ambiguous, has no published mechanism for how the Commissioner is granted
   access, and no visible enforcement against SME software. The PDPA obligation
   is concrete, has a registration portal, a permit process, published fines and
   an enforcement date that has already passed.

---

## 1. Obligation one — s.35(7), Tax Administration Act

### What it says

Every taxable or liable person who maintains documents in electronic form must
maintain **in the United Republic a primary data server** for storage of those
documents, accessible by the Commissioner General for tax administration in the
manner and time prescribed under s.42.

The Finance Act 2023 defines a primary data server as *"a physical server in the
country, virtual or any other server which stores data that is created or
collected by a taxable or liable person in the ordinary course of business"* —
the word **virtual** added expressly so cloud storage could not be used to
sidestep it. In force from **1 January 2024**.

### Who it binds

Read plainly, it binds **the taxpayer** — the shop — not their software vendor.
That distinction matters commercially and is the first thing to put to a lawyer.
SaviaSmart is not the taxable person; the duka is. But a shop that keeps its
records *only* in SaviaSmart has, in substance, no server in Tanzania.

### The honest state of it

Both PwC Tanzania and the commentary collected in `RESEARCH-accounts.md` say the
same thing: the requirement is clear in its demand and unclear in its
satisfaction. There is no published guidance on whether a replica, a mirror or a
nightly export in Tanzania discharges it, and none on how the Commissioner is
meant to be given access. PwC has publicly questioned the policy as a
disincentive to cloud adoption.

**What that means for us:** nobody can tell you today, from published sources,
exactly what compliance looks like. That is an argument for asking a Tanzanian
tax lawyer, not for assuming we are fine.

### Why it arrives with the big client

A duka will never ask where the server is. A company above the TZS 100m turnover
threshold files audited financial statements, and its external auditor's job
includes asking. This is precisely the client now on the table.

---

## 2. Obligation two — the PDPA, and this one is live

This is the finding the earlier research did not have.

- The **Personal Data Protection Act 2022** and the 2023 Regulations require
  every data controller and processor to **register with the PDPC before
  collecting or processing personal data**. Registration lasts five years.
- **Enforcement commenced 9 April 2026**, ending the voluntary-registration
  period. The PDPC subsequently issued a 7-working-day ultimatum to unregistered
  entities.
- **Regulation 20** requires a **separate permit** to transfer personal data out
  of Tanzania, supported by an international agreement, a bilateral agreement, or
  contractual safeguards with the recipient — and the transfer must remain
  subject to Tanzanian law.
- Penalties: failure to register attracts **TZS 100,000 – 5,000,000**; general
  contraventions carry **TZS 100,000 – 5,000,000 or up to 5 years' imprisonment**,
  with administrative fines reported **up to TZS 100,000,000** for organisations.

### Does SaviaSmart hold personal data?

Yes, unambiguously. The schema holds customer names and phone numbers
(`/customers`), staff names on every sale (`staffName`), member records, supplier
contacts, and the owner's own name and email. All of it is replicated to `nam5`
in the United States.

So on a plain reading there are two live questions: whether SaviaSmart (and/or
each shop) should be **registered**, and whether the ongoing transfer to the US
needs a **cross-border permit**.

### Why this is the more urgent of the two

s.35(7) is ambiguous and unenforced against software of this size. The PDPA has a
regulator, a portal, a deadline that has passed, and published fines. If only one
of these gets professional attention this month, it should be this one.

---

## 3. The options

Ordered by cost. These are engineering and commercial options; which are legally
sufficient is the lawyer's call.

### A. Change nothing, and be able to say why

Keep Firestore in `nam5`. Argue that the taxpayer is the shop, that shops retain
their own primary records (EFD receipts, cash books, bank statements), and that
SaviaSmart is an operational tool rather than the statutory record.

- **Cost:** nil.
- **Holds for:** dukas, today.
- **Fails when:** we ship the double-entry ledger. The moment the pitch is "we
  hold your books", the argument above collapses — which is exactly why the
  ledger is held.
- **Does nothing about the PDPA**, which is the enforced obligation.

### B. Do the PDPA work now, decide s.35(7) later — *the floor, not an option*

Register with the PDPC as a data controller/processor and apply for a
cross-border transfer permit for the US transfer. Add a privacy notice and a
lawful basis for the personal data already held.

- **Cost:** small — filing fees and a few hours of counsel.
- **Buys:** removal of the only exposure with a passed enforcement date, and a
  concrete answer for an auditor's first question.
- **Do this regardless of which option below is chosen.**

### C. A Tanzania-resident replica

Keep Firestore as the operational database; continuously mirror each tenant's
records into a server in a Tanzanian data centre (NIDC, Wingu Africa, or Raxio
when it opens), and give TRA a route to it.

- **Cost:** moderate — colocation or a VPS, plus a sync worker and its monitoring.
- **Buys:** a defensible answer to "where is your primary data server", and one
  that fits the statute's own word *virtual*.
- **Risk:** whether a replica counts as the *primary* server is exactly the
  ambiguity nobody has resolved. Ask before building.
- **Bonus:** it is also a real backup. We currently have **point-in-time recovery
  disabled** and one hour of version retention (see §4).

### D. Move the system of record to Tanzania

Make a Tanzanian-hosted database authoritative and demote Firestore to a cache,
or drop it.

- **Cost:** high. Firestore is not just storage here — it is the offline sync
  engine the whole POS depends on. `reliability-over-elegance` applies with
  force: this is the sale path.
- **Buys:** the least arguable compliance position.
- **Honest assessment:** disproportionate for eight dukas. Only worth it if
  large clients become the business.

### E. Per-tenant residency — the commercially interesting one

Keep the dukas on Firestore. Put large clients on Tanzanian infrastructure, as a
paid tier.

- **Cost:** high but *deferred and funded* — it is built when a client pays for
  it, not speculatively.
- **Buys:** the ability to answer the big client's auditor with "yes, your data
  is resident in Tanzania" without re-platforming eight shops that never asked.
- **Prerequisite:** the storage layer must be swappable per tenant. It is not
  today — Firestore is assumed throughout `app.js`.

---

## 4. Two things found on the way that are not about residency

- **Point-in-time recovery is DISABLED** on the production database, with a
  version retention period of **one hour**. For a system holding eight
  businesses' books, that means an accidental mass delete older than an hour is
  unrecoverable. This is cheap to turn on and is worth doing this week,
  independently of everything above.
- **Delete protection is DISABLED** on the database.

---

## 5. What I would put to a lawyer, in this order

1. Under s.35(7), is the obligated person the **shop** or its **software
   vendor**? (Everything else follows from this.)
2. Does a **continuously synchronised replica** inside Tanzania satisfy "primary
   data server", given the statute's inclusion of *virtual* servers?
3. What does "accessible by the Commissioner General" require in practice —
   credentials, an export on demand, a standing connection?
4. Must **SaviaSmart** register with the PDPC, must **each shop**, or both?
5. Does the ongoing replication to `nam5` require a **Regulation 20 permit**, and
   what safeguards would support the application?
6. Is there exposure for the **period already elapsed** — since 1 January 2024
   for s.35(7), and since 9 April 2026 for PDPA enforcement?

---

## Sources

- [Tax Administration Act (TRA official text)](https://www.tra.go.tz/images/uploads/acts/Tax_Administration_Act.pdf)
- [Bowmans — Tanzania: Finance Act 2023 Highlights](https://bowmanslaw.com/insights/tanzania-finance-act-2023-highlights/)
- [PwC Tanzania — Local primary data server requirement](https://www.pwc.co.tz/press-room/local-primary-data-server-requirement.html)
- [The Citizen — Local primary data server requirement: a disincentive to Industry 4.0?](https://www.thecitizen.co.tz/tanzania/oped/local-primary-data-server-requirement-a-disincentive-to-industry-4-0--3805304)
- [PDPC — Registration of Data Controller / Processor](https://www.pdpc.go.tz/en/registration-data-controller-processor/)
- [PDPC — Cross-Border Data Transfer Permit](https://pdpc.go.tz/services/cross-border-data-transfer-permit/)
- [Clyde & Co — Key obligations for data controllers and processors under Tanzania's PDPA](https://www.clydeco.com/en/insights/2025/02/key-obligations-for-data-controllers-and-processor)
- [Rex Attorneys — PDPC registration deadline, 8 April 2026](https://rexattorneys.co.tz/portfolio/reminder-to-clients-final-deadline-for-registration-with-the-personal-data-protection-commission-pdpc/)
- [DLA Piper — Data protection laws in Tanzania](https://www.dlapiperdataprotection.com/?t=law&c=TZ)
- [NIDC — National Internet Data Centre, Dar es Salaam](https://nidc.co.tz/)
- [Wingu Africa — Tier III data centres, East Africa](https://www.wingu.africa/)
- [Raxio Tanzania — launching 2026](https://www.raxiogroup.com/data-centres/tanzania/)
