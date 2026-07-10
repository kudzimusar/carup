# CarUp Command Center Claude Launcher

Run from the repository root in Claude Code:

```text
/carup-command-center start
```

Then copy the exact `/goal` command from:

`docs/agent-8-omnichannel/ENTERPRISE_COMMUNICATION_COMMAND_CENTER_GOAL_LOOP.md`

Start the follow-up loop:

```text
/loop 10m /carup-command-center continue implementation, verification, CI, review feedback, deployment checks, and staging UAT until the active goal is achieved
```

The authoritative plan controls every phase, route, test, staging gate, and stop condition. Do not merge main or modify production resources without explicit approval.
