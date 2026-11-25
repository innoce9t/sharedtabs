# SharedTabs Bridge {{VERSION}}

SharedTabs lets AI agents on your computer use **only the Chrome tabs you share**, on sites you allow.

It has two parts. The **extension** lives in Chrome and is in charge of what agents may do. This **bridge** connects it to your agent. You need both.

## What you need

- Windows 10 or 11, and Google Chrome
- [Node.js](https://nodejs.org) 20 or newer (choose the LTS version)
- An AI agent that supports MCP and runs on this computer, such as Hermes, Claude Desktop, Claude Code, Cursor or Codex

You don't need administrator rights.

## Install it yourself

1. **Unzip** this folder somewhere permanent, such as `C:\Users\you\SharedTabs`. Don't run it from inside the zip. If you move it later, do step 2 again.
2. Double-click **Set up SharedTabs**, and answer **y** for each agent to connect.
   Windows may warn that the file is from the internet. Check that you downloaded it from `ahsan.live` or the project's GitHub page before you continue.
3. Install the **SharedTabs** extension from the Chrome Web Store (the link is on [ahsan.live/sharedtabs](https://ahsan.live/sharedtabs)). Its popup should say **Connected**.
4. Read the page that opens, and choose **I agree** if you're happy with it.
5. In **Settings**, choose which sites agents may use.
6. **Restart your agent.**
7. Open a page, click the SharedTabs icon and choose **Share this tab**. Then ask your agent: *"List my shared tabs and summarise the page."*

Something not right? Double-click **Check SharedTabs**. It says what's left to do and changes nothing.

## Or ask your AI to install it

Give your agent this:

```text
Install the SharedTabs bridge for me on this PC.
Download https://ahsan.live/sharedtabs/sharedtabs-bridge.zip and unzip it into a permanent folder in my user folder.
Then read INSTALL-WITH-AI.md inside it and follow it.
Tell me what you are about to do, and ask me before you run setup or change any settings.
```

If the zip is already unzipped, say where:

```text
Install the SharedTabs bridge from C:\Users\me\SharedTabs. Read INSTALL-WITH-AI.md there and follow it. Ask me before you run setup or change any settings.
```

Your agent needs to be able to run commands on this PC. It can set up the bridge and connect itself. **A few steps stay yours**, because they decide what agents may do: adding the extension, agreeing to its terms, choosing sites, and sharing tabs.

## Connect another agent

Run **Set up SharedTabs** again, or add this to the agent's MCP settings, with your own paths. Setup prints it with the right paths filled in.

```json
{
  "mcpServers": {
    "shared-tabs": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\SharedTabs\\mcp\\server.mjs"]
    }
  }
}
```

## Update

Chrome updates the extension by itself. When the bridge should be updated too, the popup says so.

Double-click **Update SharedTabs**. It shows what's new and asks before changing anything. It installs only versions signed by the makers of SharedTabs, keeps a backup, and puts the old version back if something goes wrong. You can also ask your agent to do it.

If it says *"This copy has no update address"*, download the newest zip and unzip it over this folder, then run **Set up SharedTabs**.

## Stop or remove it

- **Stop right now:** SharedTabs popup → **Stop agents**.
- **Remove:** double-click **Remove SharedTabs**, remove the extension in `chrome://extensions`, remove `shared-tabs` from your agent, and delete this folder.

## Stay safe

- Agents can make mistakes, and web pages can try to trick them. Watch them with anything important.
- Anyone who can message your agent, for example through Telegram or Slack, can ask it to use the tabs you share.
- **Allow specific** sites is safer than **Allow all**. Leave file uploads off until you need them.
- What an agent reads may be sent to its AI provider.

## Problems

| What you see | What to do |
|---|---|
| "Node.js 20 or newer is needed" | Install Node.js, then run setup again |
| Popup says the bridge app is not installed | Run **Set up SharedTabs** from File Explorer, then turn the extension off and on in `chrome://extensions` |
| "Windows hides settings made from here from Chrome" | You're inside another app's terminal. Double-click **Set up SharedTabs** in File Explorer |
| Agent doesn't show the tools | Restart the agent completely |
| "Chrome is not connected" | Open Chrome, and check that the SharedTabs popup says Connected |
| A site is refused | Check **Site permission** and **Blocked sites** in SharedTabs settings |

Help: [ahsan.live/sharedtabs](https://ahsan.live/sharedtabs) · hello@ahsan.live

Built by [Ahsan Nawazish](https://ahsan.live/). Open source under the GNU AGPL 3.0, with credit terms: see `LICENSE.txt`. Source: [github.com/innoce9t/sharedtabs](https://github.com/innoce9t/sharedtabs)

SharedTabs is an independent project. It is not made or endorsed by Google or by the makers of any AI agent.
