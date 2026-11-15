# Security policy

## Report a vulnerability

Report a security problem in Loadout privately, through GitHub's private vulnerability reporting. Do not open a public issue for it.

1. Open the main page of this repository on GitHub.
2. Under the repository name, click the **Security and quality** tab. If you do not see it, open the three-dot menu and click **Security and quality**.
3. Click **Report a vulnerability**.
4. Fill in the form: a summary, the details, the steps to reproduce, and the impact.
5. Click **Submit report**.

Only the maintainer can see the report. The maintainer answers in the report thread.

## Supported versions

Only the latest release gets fixes. A fix ships as a new release; the app's update check offers it.

## Scope

Loadout runs on your Mac with your own user rights. It runs `git`, `tessl` and `curl` as child processes, and it replaces its own app bundle when you accept an update. A problem in one of those paths is in scope. A problem in Tessl, Claude Code, Codex, OpenCode or GitHub belongs to that project.
