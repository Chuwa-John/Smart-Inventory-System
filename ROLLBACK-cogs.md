# Rollback plan — COGS engine work

This file exists only on the `cogs-engine` branch. If you are reading it on
`main`, something went wrong.

## The restore point

| | |
|---|---|
| Tag | `pre-cogs` |
| Commit | `75d1066` |
| Stamp | `app.js?v=20260923a`, `savia-shell-v171` |
| Deployed to production | 2026-09-23 |

`main` has not been touched. It still points at exactly the bytes that are live
on https://sanitaryflow-erp.web.app right now. All COGS work happens on the
`cogs-engine` branch.

## To roll back

```
git checkout main
```

That is the whole rollback. It is instant, it is not destructive, and the COGS
work stays on the `cogs-engine` branch in case you change your mind.

If you want the branch gone as well:

```
git checkout main
git branch -D cogs-engine
```

If the working tree is somehow dirty and you want the live state back exactly:

```
git checkout main
git reset --hard pre-cogs
```

## If it has already been deployed to production

Nothing here has been deployed. If that changes, rolling production back is a
second step, because git and Firebase Hosting are separate:

```
git checkout main
firebase deploy --only hosting
```

Firebase Console → Hosting also keeps a release history and can roll back to a
previous release directly, which is faster in an incident.

**Stamp note.** Rolling back to `main` restores stamp `20260923a` together with
the exact bytes that stamp was first deployed with, so no stamp is being reused
for different bytes and nothing is burned. If instead you roll *forward* to fix
something, the stamp must move again — never reissue a withdrawn one.

## What is NOT covered by this rollback

Git restores code. It does not restore data. If the COGS work is ever pointed at
production and writes anything (it is designed not to — the engine only reads),
that data would need separate attention. During testing it runs against the
local emulator, which holds no live shop data.
