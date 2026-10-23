# Provider-specific Alipay release migration review

The shared `payment_alipay_released` setting introduced by 0013 did not record
which protocol, application, or trade scope had been confirmed. Historical policy
used it for both RSA2 and Epay; this behavior is not evidence that the merchant's
platform approvals apply to both interfaces.

0014 copied that value into both independent Alipay release settings. If the old
value was `1`, enabling the second interface could expose a method without its own
approval. RSA2 route priority merely delayed this risk; it did not remove it.

## Forward-only correction

- Keep the already-applied 0014 file unchanged.
- Apply 0015 after 0014, including on fresh databases. It sets only auto-inherited
  Alipay release values to `0` (`value='1' AND updated_by IS NULL`). Admin saves
  populate `updated_by`; their settings, timestamps, operation IDs and audit
  records remain unchanged. Missing or false confirmations remain closed.
- Keep provider enable switches, channel enable switches, global purchases,
  WeChat settings, historical orders, callbacks and financial records unchanged.
- Runtime policy never falls back to the shared Alipay release value when an
  independent key is missing.
- Legacy admin payloads can still update operation switches, but their ambiguous
  `alipayReleased` field cannot grant provider-specific approval. Independent
  Alipay confirmations are preserved; changes require the existing explicit
  provider fields and audited administrator save.

This preserves saved administrator decisions; it does not independently verify
platform approval. Automatically inherited values require separate confirmation
through the existing admin interface. No merchant credential or payment request
is needed to apply or test this correction.

Regression tests cover legacy values `0` and `1`, all RSA2/Epay enable combinations,
mixed confirmed/inherited settings, admin saves, safe re-execution, missing keys,
legacy payloads, unchanged financial data and checkout rejection without outbound
provider requests. Production migration and payment enablement remain separate
release operations.
