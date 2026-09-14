# Development guide

Run commands from the repository root. The [README](../README.md) contains installation and the shortest web and iOS workflows.

## Toolchain

- Node.js **22.22.3**, selected by `.nvmrc`; the package declares Node `>=22.13.0`.
- pnpm **11.9.0**, selected by the `packageManager` field.
- For native iOS: macOS, Xcode compatible with Expo SDK 57, and an installed iOS Simulator. Finish Xcode's first-launch setup before building.
- For native Android: an Android development environment and emulator or device. iOS remains the primary target.

```bash
nvm use
node --version
pnpm --version
pnpm install --frozen-lockfile
```

`npm install --global pnpm@11.9.0` installs the pinned package manager if needed. Corepack is an alternative when it is installed: `corepack enable pnpm` lets the project's `packageManager` field select the version.

## Local configuration

Copy `.env.example` to `.env.local`. The latter is ignored by Git. Keep actual API keys, account configuration, and personal runtime data out of commits and release archives.

| Variable | Read by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Gateway | Your OpenAI API key; needed to create a plan |
| `OPENAI_MODEL` | Gateway | Planning model identifier; the example mirrors the repository configuration |
| `OPENAI_RESEARCH_MODEL` | Gateway | Optional research model override; otherwise uses `OPENAI_MODEL` |
| `ACTUM_AI_HOST` | Gateway | Bind address; defaults to `127.0.0.1` |
| `ACTUM_AI_PORT` | Gateway | Listen port; defaults to `8787` |
| `ACTUM_AI_STATE_FILE` | Gateway | Optional durable-state path; defaults to `.actum/ai-state.json` |
| `EXPO_PUBLIC_ACTUM_AI_URL` | Client | Gateway URL reachable from the browser, simulator, or device |
| `EXPO_PUBLIC_ACTUM_MODE` | Client | `development` enables test controls only when `__DEV__` is also true; other values disable them |
| `ACTUM_EAS_OWNER` | Expo config | Optional Expo account for your own EAS project |
| `ACTUM_EAS_PROJECT_ID` | Expo config | Optional EAS project ID for your own project |

Select model identifiers that your API account can access and that support the gateway's required Responses API features, including structured output, background responses, and research web search. The example configuration is not a guarantee of model availability for every account.

`EXPO_PUBLIC_*` values are public client configuration. They are embedded in the JavaScript bundle and must never contain API keys or other secrets. After changing them, stop and restart Metro. Restart the gateway after changing its server variables.

Planning sends the goal, baseline, and relevant program context to the provider. Accepted plans, sessions, and check-ins remain in the app's local storage. The gateway separately keeps request metadata, research, and completed responses in `.actum/`; this directory can contain personal inputs and must remain private.

The interface and new planning instructions use English. Existing user notes and saved plans keep their original text. Built-in labels from older app state are translated when restored; this does not regenerate a plan. To update a reminder scheduled before the English interface, turn Reminder off and on in Settings.

## Web and native development

The web UI can start without a running gateway:

```bash
pnpm web
```

To create plans, configure `.env.local` and run this in another terminal:

```bash
pnpm ai:server
```

To build and open an iOS development app:

```bash
pnpm ios
```

This is the native workflow; web is useful for UI exploration but does not exercise native haptics, notifications, or iOS presentation. Subsequent development sessions can use `pnpm start`. Run `pnpm ios` again after changing native dependencies or native configuration. `pnpm start:go` is available, but the project's intended native workflow uses its own development client.

### Optional macOS launcher

The helper requires nvm, a configured `.env.local` with a nonempty key, and Xcode's Simulator tools. It opens the AI gateway and Metro in separate Terminal windows, then opens the Simulator.

```bash
pnpm dev:ios --dry-run
pnpm dev:ios --rebuild
pnpm dev:ios
```

Use `--rebuild` for the first native install or after a native dependency change. `--dry-run` checks the setup without launching the environment. The launcher uses ports `8787` and `8081`; it restarts listeners belonging to this checkout and stops with an error if another project owns either port. For custom ports, use the separate gateway and Expo commands.

### Physical iPhone

`127.0.0.1` works for the iOS Simulator on the development Mac. A physical phone needs the Mac's local network address and must share its trusted network. Set these values in `.env.local`, replacing the example address:

```dotenv
EXPO_PUBLIC_ACTUM_AI_URL=http://192.168.1.100:8787
ACTUM_AI_HOST=0.0.0.0
```

Restart both processes. The gateway has no production authentication; use this binding only for development on a trusted network and do not expose its port to the internet. A device build also needs your own Apple signing setup.

## AI pipeline and request recovery

The gateway serves three endpoints:

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Local service health |
| `POST /plan` | Validate input, research if required, and produce a validated plan |
| `GET /saved-plan/latest` | Read and revalidate the latest recoverable completed plan without calling OpenAI |

For a new goal, research produces a structured brief with source citations and the earliest supported target cycle. If that cycle exceeds the selected continuation limit, the gateway stops before the planning request. Otherwise a separate structured-output request produces the roadmap and current 30-day cycle. An independent validator checks executable assignments, arithmetic, daily limits, and assessment consistency before the client maps the result into its domain model.

Changing prompts, parsers, validators, contracts, or models changes the corresponding cache identity. Research is associated with the program's original goal, baseline, and daily budget, allowing later cycles to reuse it. A new cycle still requires an explicit planning action. The research cache lasts 400 days; the final-plan cache lasts 30 minutes; completed stage responses are retained for seven days under the current configuration.

### Preserve durable state

`.actum/ai-state.json` is part of the request-safety mechanism, not a disposable build cache. Before a potentially paid provider POST, the gateway writes a guard to disk; it then saves the response ID and preserves completed raw responses before local validation. This allows process restarts and validation retries to reuse a known response.

- **Known response ID:** poll or resume that response instead of issuing a new POST.
- **`ambiguous_create`:** the provider request may have been accepted before the connection failed. The same request is blocked for two hours to avoid an automatic duplicate.
- **`durable_state_unavailable`:** the state file cannot be safely loaded or written. New paid requests are blocked. Check its location, permissions, and integrity before retrying.
- **Validation failure:** the completed provider response is retained. The UI's reuse-only action can recheck saved work without opening a new paid request.
- **Form lost after app restart:** the goal screen can recover the latest completed current-contract plan through `GET /saved-plan/latest`.

Do not delete `.actum/` to bypass these guards. Preserve the file while diagnosing failures; inspect or share only redacted logs, since local state and provider responses may contain personal goal data. The gateway's request guards reduce accidental duplicate calls but do not remove provider charges for explicitly requested work.

## Reusing a plan while testing

In Settings, **Restart this month** restarts the active 30-day cycle without creating an AI request. It clears that cycle's results, sessions, check-ins, and comments; it retains the program, roadmap, research association, profile, level, and XP, and moves Day 1 to the current date.

To step through days during local development, set:

```dotenv
EXPO_PUBLIC_ACTUM_MODE=development
```

Restart Metro, then use **Settings → Testing → Skip day**. Skipping unlocks the next day without awarding XP or fabricating a measured result. Restarting the month also clears test skips. Test controls require both this exact setting and `__DEV__`; preview and production bundles hide them. Set the variable to `production` or omit it for normal behavior.

Older locally saved plans remain readable through the compatibility layer. They are not silently regenerated or upgraded to the new plan contract; guarantees added by newer contracts require an explicitly requested new plan.

## Verification

```bash
pnpm typecheck
pnpm test:ai
pnpm check
```

`pnpm check` runs TypeScript, the Node test suite, and a production web export to `dist/`. Gateway tests stub the provider and do not use a real API key or paid requests. Coverage includes failure recovery, cache identity and reuse, strict plan validation, server/client contract parity, state migrations, timer behavior, development flags, and architecture boundaries.

For native changes, also walk through onboarding, plan review, mission execution, background/resume, check-in, and the journal on a Simulator or device. Creating a real plan for that walkthrough incurs API usage; automated checks do not require it.

## Optional EAS builds

EAS is optional for local web and Simulator development. The public repository is not bound to the author's Expo account. To use cloud builds, connect a project under your own Expo account and configure your own application identifiers and signing credentials. `app.config.js` reads `ACTUM_EAS_OWNER` and `ACTUM_EAS_PROJECT_ID`; set them in your ignored local environment and configure the same values for the cloud build environment. They are project identifiers, not credentials.

The profiles in `eas.json` are `development`, `preview`, and `production`. Development uses a development client; preview and production set the client mode to `production`. Use an EAS CLI version satisfying the constraint in `eas.json`.

```bash
eas login
eas project:info
eas build --platform ios --profile development
```

Cloud builds do not deploy the AI gateway. A distributed app needs a reachable, secured backend; a developer's loopback URL will not work on another person's device. The current repository does not provide that production deployment.

## Where to make changes

See [ARCHITECTURE.md](ARCHITECTURE.md) for module ownership, allowed dependency directions, compatibility rules, and the feature-extension workflow. See [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md) for the current product boundaries and next validation steps. Both detailed design documents are currently in Russian.
