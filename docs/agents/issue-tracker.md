# Issue tracker: GitHub

Issues and product requirements for this repository live in GitHub Issues at `theHimanshuShekhar/BhayanakCast`. Use the `gh` CLI for issue and pull-request operations.

## Repository

- Owner: `theHimanshuShekhar`
- Repository: `BhayanakCast`
- Tracker: GitHub Issues
- Remote: `git@github.com:theHimanshuShekhar/BhayanakCast.git`

When running inside this repository, let `gh` infer the repository from the Git remote. Otherwise, pass `--repo theHimanshuShekhar/BhayanakCast`.

## Issue conventions

- **Create:** `gh issue create --title "..." --body "..."`
- **Read:** `gh issue view <number> --comments`
- **List:** `gh issue list --state open`
- **Comment:** `gh issue comment <number> --body "..."`
- **Add a label:** `gh issue edit <number> --add-label "..."`
- **Remove a label:** `gh issue edit <number> --remove-label "..."`
- **Close:** `gh issue close <number> --comment "..."`
- **Reopen:** `gh issue reopen <number>`

Use `--json` and `--jq` when structured issue data is needed. For example:

```sh
gh issue list \
  --state open \
  --json number,title,body,labels,comments \
  --jq '[.[] | {
    number,
    title,
    body,
    labels: [.labels[].name],
    comments: [.comments[].body]
  }]'
```

Use appropriate `--label` and `--state` filters rather than fetching unrelated issues.

## Pull requests as a triage surface

**PRs are a request surface: yes.**

External contributors’ pull requests enter the same triage queue and use the same triage labels and states as issues. Collaborators’ ordinary in-progress pull requests do not enter this request queue.

Use the corresponding `gh pr` operations:

- **Read:** `gh pr view <number> --comments`
- **Inspect changes:** `gh pr diff <number>`
- **List:** `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`
- **Comment:** `gh pr comment <number> --body "..."`
- **Add or remove labels:** `gh pr edit <number> --add-label "..."` or `--remove-label "..."`
- **Close:** `gh pr close <number>`

For the external-PR triage queue, include only pull requests whose `authorAssociation` is:

- `CONTRIBUTOR`
- `FIRST_TIME_CONTRIBUTOR`
- `NONE`

Exclude pull requests whose `authorAssociation` is:

- `OWNER`
- `MEMBER`
- `COLLABORATOR`

GitHub issues and pull requests share one number space. A reference such as `#42` may identify either type; resolve its type before acting.
