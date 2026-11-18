# CF Free exact ACK count Worker-first release compatibility

Follow-up to PRs #194 and #195. Production's guarded deployment workflow
explicitly prescribes **Worker first, verify, then Pages**.

- New Worker + old Pages: old Pages call `?view=overview` without the new
  `generation_counts=lazy` marker; the Worker preserves legacy exact
  today/month numbers (at the old read cost) until Pages is upgraded.
- New Pages + old Worker: the old Worker ignores the marker and returns
  existing exact overview counts. New Pages detects these and treats them
  as loaded. A click on focused user count accepts the legacy full
  `user.generations` form and validates it before display.
- Both new: Pages sends `view=overview&generation_counts=lazy`; exact history
  scans are skipped on routine visits, and count controls explicitly fetch
  unchanged ACK-only data.
- Missing or malformed responses are errors, never fabricated zeros.

The release must follow the trusted Worker-first protected Production
workflow, with separately verified Staging and owner approval. No remotely
executed D1 SQL, schema migrations, payment actions, password-flag changes
or Cloudflare Free plan changes.
