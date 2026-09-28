# Rollback plan — COGS engine work

The restore point is a TAG, not a branch. That is the whole reason this file
was rewritten on 2026-09-28: the original said `git checkout main` was the
rollback, which was true only while `main` still pointed at the live build. A
fast-forward merge of `cogs-engine` makes `main` *become* the new work, and the
instruction would then restore nothing. A tag cannot drift like that.

## The restore point

| | |
|---|---|
| Tag | `pre-cogs` |
| Commit | `75d1066` |
| Stamp | `app.js?v=20260923a`, `savia-shell-v171` |
| Deployed to production | 2026-09-23 |

Those are the exact bytes serving the eight live shops. Verified against the
served files, not the local ones, on 2026-09-28.

## To roll back

```
git checkout pre-cogs
```

Instant, not destructive, and correct whether or not `cogs-engine` has been
merged. The COGS work stays wherever it already is in case you change your mind.

If the working tree is dirty and you want the live state back exactly:

```
git reset --hard pre-cogs
```

If `main` has already been fast-forwarded and you want it back where it was:

```
git checkout main
git reset --hard pre-cogs
```

That last one rewrites `main`. Only do it if nothing has been pushed and shared,
otherwise move forward with a revert instead.

## If it has already been deployed to production

Git and Firebase Hosting are separate, so restoring the code is only half of it:

```
git checkout pre-cogs
firebase deploy --only hosting
```

Firebase Console → Hosting also keeps a release history and can roll back to a
previous release directly, which is faster in an incident and does not need a
working checkout at all.

**Deploy state as of 2026-09-28.** Production has NOT received any of this work
and is still on `20260923a`. The branch has been deployed repeatedly to the
`cogs-preview` hosting channel, which is a separate URL and separate release
history — rolling that back is never urgent, because no shop points at it.

**Stamp note.** Rolling back to `pre-cogs` restores stamp `20260923a` together
with the exact bytes that stamp was first deployed with, so no stamp is being
reused for different bytes and nothing is burned. If instead you roll *forward*
to fix something, the stamp must move again — never reissue a withdrawn one.
Stamps used so far on this branch, all burned: `20260923b`, `20260923c`,
`20260925a`, `20260926a`, `20260926b`, `20260926c`, `20260926d`.

## What is NOT covered by this rollback

Git restores code. It does not restore data.

The COGS engine itself only reads — it computes from stock movements, purchases
and cost history and writes nothing. But the **testing** has not been against an
emulator, whatever an earlier version of this file claimed: it has run against
real Firestore on the dummy tenant (`robertbahati48@gmail.com`), through the
preview channel, and it has written deliveries, sales, expenses, an invoice and
a stock adjustment there. That data is still in place and a code rollback will
not remove it.

No live shop tenant has been written to at any point.
