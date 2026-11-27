# SharedTabs

**Lets AI agents on your computer use only the Chrome tabs you share, on sites you allow, signed in as you.**

Built by [Ahsan Nawazish](https://ahsan.live/) · [Website and download](https://ahsan.live/sharedtabs/) · [Privacy](https://ahsan.live/sharedtabs/privacy/) · [Buy me a coffee](https://ahsan.live/sharedtabs/#coffee)

Works with agents that can run a local [MCP](https://modelcontextprotocol.io) server. Tested with [Hermes Agent](https://github.com/NousResearch/hermes-agent). Windows only for now. No npm dependencies, no open ports, no token to paste.

This is an independent project, not made or endorsed by Google, Nous Research or the makers of any agent. Some internal names still say "hermes-chrome", so existing installs keep working.

```
agent  --MCP (stdio)-->  mcp/server.mjs  --named pipe-->  host/host.mjs  --native messaging-->  extension  --chrome.debugger-->  tabs
```

## Install

Most people should follow the steps at [ahsan.live/sharedtabs](https://ahsan.live/sharedtabs/). To run it from this source instead:

1. In an ordinary PowerShell or Windows Terminal window (**not** a terminal inside a packaged app such as the Claude app, whose registry changes Chrome can't see; the installer checks), run this in the project folder:

   ```powershell
   npm run setup
   ```

2. In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick the `extension` folder.
3. Agree on the page that opens, then choose allowed sites in Settings.
4. Restart your agent. For an agent that setup didn't connect, add the server it printed.

If you move this folder or update Node to a new location, run step 1 again.

## Use

- Click the SharedTabs toolbar button and choose **Share this tab**, or drag a tab into the blue **SharedTabs** tab group. Drag it out to stop sharing. Agents can also open their own tabs in the group.
- Choose which sites agents may use in the extension's **Settings**, under **Site permission**. It starts as Not allowed. Agents never ask; if the setting doesn't cover a site, the action is refused.

  | Permission | Sites agents can use in shared tabs and tabs they open |
  |---|---|
  | Allow all | Every site except the blocked list |
  | Allow specific | Only sites you list (the popup can add the current one) |
  | Allow until Chrome closes | Every site except the blocked list, then back to Not allowed. Reloading the extension also ends it |
  | Not allowed | None |

- Choose what they may upload under **File uploads**. It starts as Off. Uploads go only to sites your Site permission covers, up to 20 MB per call.

  | File uploads | Files agents can upload |
  |---|---|
  | Off | None |
  | Only from these folders | Any type of file in the folders you list, and their subfolders |
  | Any file | Any file on this PC except the protected ones |

  Keys, password files and account tokens are always refused, recognised by name. System, app data and account settings folders are refused unless you list a folder inside them. Network paths are refused.

- **Embedded forms** work when the embedded site is covered by Site permission too. For example, a company page with a Greenhouse form needs both sites. The agent is told which embedded sites were left out.

- **Side panel** (from the popup): live activity with the name each agent gives itself, sharing, Stop and recording.
- **MCP context and activity**: `get_shared_context` reads an allowed shared tab as visible text or an outline with element references. `get_activity` returns recent SharedTabs actions across connected agents with tool names, timestamps, tab IDs when available, duration, and success or failure.
- **Recording:** ask the agent, or use the side panel. Each action adds a frame (up to 80). GIFs are saved in your Downloads folder and are limited to pages agents may use. They show whatever is on the page.
- **Indicator:** tabs show a border and pointer while an agent uses them. Turn it off in Settings.
- **Other agents:** any local agent that runs MCP servers over stdio can use `mcp/server.mjs`. All agents share one set of permissions.
- **Stop agents** in the popup, or **Cancel** on Chrome's debugging banner, halts everything at once.

## Protections

| Risk | What limits it |
|---|---|
| Other extensions using the bridge | Chrome only starts the host for this extension's fixed ID |
| Other Windows users or the network | The pipe has a random name and an access list with only your account; network logons are denied. If that can't be set, the host refuses to run |
| Agents seeing your other tabs | Only tabs in the SharedTabs group are visible. Incognito is off |
| Agents reaching sensitive sites | The Site permission setting, plus a blocked list that always wins |
| Files leaving your PC | Off by default, folder limits, protected files. The bridge resolves links and junctions before deciding |
| A click landing in an embedded site that isn't allowed | The target is rechecked just before each click; frames that can't be checked are refused |
| Passwords, cards, one-time codes | These fields aren't read, and typing in them is refused (best effort, based on how the field is marked up) |
| A page redirecting to another site | The site is checked again before every action, and again before results are returned |
| Instructions hidden in pages | Page text is marked untrusted. This lowers the risk but does not remove it |

Not covered:

- Programs running under your own Windows account can connect to the pipe.
- **Anyone who can message your agent over Telegram, WhatsApp or another channel can ask it to use the tabs you share, or to open tabs on any site your Site permission covers. With Allow all, that is every site except the blocked list, signed in as you, with no prompt.** In Hermes, to keep these tools off a channel, list only the MCP servers you want there in `platform_toolsets` (or `no_mcp` for none).
- Screenshots show whatever is visible on the page, including embedded frames that aren't allowed.
- Folder limits stop mistakes and simple tricks, not a determined agent: if an agent has terminal or file tools, it could copy a file into an upload folder or use another way to send it.
- The starting blocked list can't include every bank. Add yours.
- Recordings and the activity list are not sent anywhere, but agents can ask for a recording's path.
- Agents choose their own name, so the name in the activity list is not proof of who acted.
- `evaluate` (off by default) bypasses the field protections.

## Limits

- Inside embedded frames, uploads need a real file input or a drop area, not a button that opens the picker.
- Dragging works within one document.
- Tabs in the background are slower, because Chrome draws them less often.
- Rotated or scaled embedded frames can't be clicked.
- Chrome pages (`chrome://`) and the Chrome Web Store can't be used.
- If two Chrome profiles have the extension, agents use the one that connected last.

## Test

```powershell
npm test
```

The end-to-end test needs Chrome for Testing. It uses a throwaway profile and its own registry key, and cleans both up:

```powershell
$env:CHROME_FOR_TESTING = 'C:\path\to\chrome.exe'; npm run test:e2e
```

## Update

After changing files in `extension` or `host`, press the reload button on the SharedTabs card in `chrome://extensions`, with Developer mode on (Chrome disables unpacked extensions on reload when it is off). Then share your tabs again. After changing files in `mcp`, restart your agent (in Hermes, `/reload-mcp`).

## Bridge releases

The store updates the extension by itself. The bridge is updated only when the user runs **Update SharedTabs**, which fetches the newest GitHub Release, checks its signature, keeps a backup, and puts the old version back if anything fails. The popup suggests it when the bridge is older than `WANT_BRIDGE` in `extension/config.js`. The tool list comes from the extension, so most new features need no new bridge.

Once, before the first release:

1. Put the repository in `store/config.json` as `"repo": "owner/name"`.
2. In an ordinary terminal, run `npm run release:key`. Keep the private key and passphrase in a password manager with an offline copy, never on GitHub. If it is lost, people must reinstall to get updates. If it is stolen, replace it and tell everyone to reinstall.

For each release:

1. Raise `version` in `package.json` (and `WANT_BRIDGE`, if people should be told to update). Put a few plain lines in `store/release-notes.txt`.
2. `npm test`, then `npm run build:bridge`, then `npm run release:sign`.
3. Create the GitHub release `v<version>`, marked as latest, with the three files in `dist/release`. Pushing code publishes nothing; only a signed release does.
4. Keep each new extension working with the previous bridge, and each new bridge with the previous extension.

## Chrome Web Store package

`npm run build:store` writes `dist/sharedtabs-<version>.zip`. It leaves out the manifest key and the tool for running JavaScript. The listing text, privacy policy and images are in `store/`.

1. Put the bridge app's download address in `store/config.json`, then build.
2. Upload the zip as a new item. The store shows its item ID.
3. Done for this item: the ID is in `extension-id.txt` and `store/config.json`. After changing it, run `npm run setup` again so the bridge accepts it. Publish the bridge app with that file.

`npm run demo` tries an installation without an agent.

## Uninstall

```powershell
npm run uninstall-host
```

```powershell
hermes mcp remove shared-tabs
```

Then remove the extension in `chrome://extensions`.

## Troubleshooting

- **"The bridge app is not installed"**: run `npm run setup` in an ordinary terminal.
- **Popup says Not connected**: look at `%USERPROFILE%\.hermes-chrome\host.log`.
- **Your agent doesn't list the tools**: restart it completely. In Hermes, run `hermes mcp test shared-tabs`.

## Licence

Copyright (C) 2026 [Ahsan Nawazish](https://ahsan.live/). Open source under the [GNU AGPL 3.0](LICENSE), with [additional terms](ADDITIONAL-TERMS.md). In short:

| | |
|---|---|
| Use it, at home or at work | Yes |
| Change it and share it, including commercially | Yes, if you give people the source under the same licence |
| Make a closed-source version and distribute it, or offer it over a network | No. Ask about a commercial licence: hello@ahsan.live |
| Credit | Keep the notices, and show "SharedTabs, built by Ahsan Nawazish (https://ahsan.live)" in anything that contains it and has an interface |
| Name and logo | Changed versions must be marked as changed, and not called the official SharedTabs |

The files are the licence; this table only summarises them. GSAP in `site/vendor` is not covered; it has [its own terms](https://gsap.com/standard-license).

By sending code, you agree that Ahsan Nawazish may publish it under this licence and under other licences too.

## Security and help

Found a security problem? Email hello@ahsan.live instead of opening a public issue. For anything else, open an issue. Please open one before sending code.
