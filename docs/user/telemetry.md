# Privacy and diagnostics

This build does not send product usage events, hashed account or device identifiers, relay connection
traces, agent feedback reports, mobile crash reports, or build-task statistics to T3 Code, PostHog,
or Axiom.

Server and desktop logs, along with process/resource monitoring, remain local to the environment and
its authorized clients. Browser spans are no longer sent to the server, and automatic OpenTelemetry
export is unavailable. The mobile Diagnostics screen still lets you inspect and copy startup crash
reports yourself.
Read copied reports before sharing: error messages and stack traces may contain sensitive values.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the T3 Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is a user-enabled feature,
not product analytics.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.
