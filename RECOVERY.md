# Data Recovery and Continuity

## Recovery objectives

| Scenario | Target recovery point | Target recovery time | Response |
| --- | --- | --- | --- |
| Browser or device loss | Most recent downloaded account backup | Same business day | Sign in on a new device; Firestore synchronizes live data. Use the retained backup to reconcile any missing records. |
| Offline/write-sync interruption | Last acknowledged Firestore write | Minutes after connection returns | Keep the app open until the connection indicator is restored; inspect inventory and sales before resuming. |
| Bad frontend release | Prior Firebase Hosting release | Under 30 minutes | Revert with a new Git commit, deploy Hosting, and verify the live app and proxy health endpoint. |
| Render proxy release failure | Prior live Render deploy | Under 30 minutes | Redeploy the prior healthy Render deployment and verify `/health`. The app continues with local AI recommendations while the proxy is unavailable. |
| Account closure or mistaken data loss | Most recent downloaded account backup | Manual recovery | Preserve the backup and contact the designated system administrator before deleting or recreating an account. |

## Owner backup procedure

1. Sign in and select **Download Backup** in the account area.
2. Keep the downloaded `dukasmart-backup-YYYY-MM-DD.json` in an encrypted device location or approved encrypted drive.
3. Make a backup after major inventory imports, period close, or before account closure.
4. Treat the backup as sensitive business data: it can contain customer, sales, and audit information. Do not send it through unencrypted chat or public links.

## Important Spark-plan limitation

This application deliberately uses Firebase Auth, Firestore, and Hosting only. It does not use Firebase Storage, Cloud Functions, or a privileged server-side Firestore export process. Consequently, a browser-created backup is the portable recovery copy available to each account owner. Cross-account restoration is not automated because allowing a browser to write another user's records would violate the authorization model.

## Incident record

For any production incident, record the detected time, affected service, user impact, deployment/commit ID, mitigation, verification result, and follow-up owner in the team incident tracker.
