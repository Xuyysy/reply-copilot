# Staging Pages release control Issue

The manual `workflow_dispatch` entry remains available on main. The optional comment entry requests the same protected Staging deployment job. GitHub evaluates issue_comment workflows from the default branch, so a pull request alone cannot enable this feature.

## Enable once

1. Review and merge this change to the default branch through the normal repository review process.
2. Create one dedicated Issue for Staging Pages deployment requests. Keep the Issue accessible only according to the repository's existing settings and set the repository Actions variable `STAGING_RELEASE_CONTROL_ISSUE` to its numeric Issue number. An unset variable keeps the comment entry inactive.
3. Keep the existing `staging` Environment, reviewers, branch rules and secrets. Scope the Cloudflare credentials to Pages deployments and reads. Do not grant the comment mechanism credentials or permissions for Worker, D1 or Production.
4. Verify the identity used by the ChatGPT GitHub connection to post comments. The workflow checks effective repository permission using GitHub's collaborator API and requires write/maintain/admin. A connection that posts as an app or bot without such permission fails closed. In that case use an authorized account or the original manual workflow. Do not bypass the check or use a temporary key.
5. After an explicit deployment approval, create a fresh top-level comment in the control Issue using one line exactly:

   ```text
   /deploy-staging <40 lowercase hex source SHA> <numeric successful CI Run ID>
   ```

   Replace both placeholders. Editing a previous comment does not dispatch another request. Environment approval still applies.

## Enforcement and records

Only the configured Issue, original comment creation and the trusted main revision can authorize the deployment job. GitHub permissions are queried live. The command is parsed as data, with only its validated SHA and run ID exported. The deployment checks same-repository push CI, exact source SHA and success, downloads each immutable artifact by ID, verifies its original GitHub SHA-256 before extraction, and rechecks every Pages file against the CI manifest. The target and branch are fixed and verified against Cloudflare. Candidate source scripts are never executed by this deployment workflow.

Authorized requests share one concurrency group. A source already deployed successfully on the Staging project's production branch is rejected, including a repeated comment with another CI run ID. Failed deployments can be retried after reviewing their state. The workflow records the prior canonical deployment before upload and records the new canonical deployment, source, CI run, actor and comment ID in the job summary.

For rollback, use the recorded prior deployment ID in the Staging Pages project through the approved Cloudflare rollback process. Do not re-submit a deployment comment to roll back. To disable comments, remove the Actions variable. Manual dispatch remains available.

## Isolation checks

Run `python3 -B -m unittest discover -s .github/tests -v`. CI also checks whether its workflow token can read effective GitHub repository permissions. The branch tests never enter the staging Environment or upload a deployment.
