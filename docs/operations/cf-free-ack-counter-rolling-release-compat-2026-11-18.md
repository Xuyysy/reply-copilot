# CF Free exact ACK count rolling-release compatibility

Follow-up to PR #194. Worker and Pages are deployed independently, so both
deployment orders may temporarily leave the old API and new UI together.

- New Pages + old Worker: dashboard `view=generations` falls through to the
  original full dashboard shape, so only exact today/month values are
  admitted to the client. User detail `view=generations` falls through to
  full `user.generations`, which is validated before display.
- New Worker + old Pages: legacy overview does not know the new opt-in button,
  so **prefer Pages first** and perform Worker rollout shortly afterward.
- Both new: focused explicit count calls only, dashboard overview and light
  user details skip exact count scans.
- Missing/malformed response is an error, never a fabricated zero.

No remote D1 SQL, migration, payment, password, auth, or Production rollout.
Full exact-source CI, staged release verification and owner approval required.
