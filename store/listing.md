# Chrome Web Store listing

Copy each block into the matching field of the developer dashboard.

## Store listing tab

**Name** (from the package): SharedTabs

**Summary** (from the package): Let AI agents on your computer use only the Chrome tabs you share, on sites you allow. Works with any local MCP agent.

**Category:** Developer Tools

**Language:** English

**Detailed description:**

```
SharedTabs lets an AI agent on your own computer work in the Chrome tabs you choose, signed in as you, and nothing else.

It works with agents that support MCP (Model Context Protocol) and run on your computer, such as coding agents and personal assistants.

YOU STAY IN CONTROL
• Agents see only tabs you share, or tabs they open
• Choose which sites they may use: all, only those you list, until Chrome closes, or none
• Many banks, password managers and similar sites are blocked by default, and you can add more
• Password, card and one-time code fields are not read, and typing in them is refused (best effort, based on how a page marks its fields)
• File uploads are off until you choose folders
• A border shows when an agent is using a tab, and the side panel lists what agents did
• Stop halts everything at once

WHAT AGENTS CAN DO
Read pages, take screenshots, find elements, click, type, hover, drag, scroll, fill in forms, upload files you allow, read console messages and network addresses, and record their steps as a GIF.

WHERE YOUR DATA GOES
Page content goes straight from Chrome to the agent on your computer. We have no account, server, analytics or ads, and receive nothing. Your agent may send what it reads to its AI provider, under that agent's own terms.

WHAT YOU NEED
• Windows 10 or 11
• Node.js 20 or newer
• The free SharedTabs bridge app (link in the extension). It updates only when you choose
• An agent that can run a local MCP server

GOOD TO KNOW
Chrome shows a "started debugging this browser" banner while an agent is clicking, typing or taking screenshots. AI agents can make mistakes, and web pages can try to mislead them, so watch them with anything important. Some websites restrict automated use; check their terms.

SharedTabs is an independent project. It is not made or endorsed by Google or by the makers of any AI agent.
```

## Privacy tab

**Single purpose:**

```
SharedTabs lets AI agent software running on the user's own computer view and operate the Chrome tabs the user has shared with it, on sites the user has allowed.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `tabs` | To list the shared tabs with their titles and addresses, open and navigate tabs for the agent, and check each tab's address against the user's allowed and blocked sites before every action. |
| `tabGroups` | The SharedTabs tab group is how the user sees and controls which tabs are shared. Moving a tab out of the group stops sharing it. |
| `scripting` | To read the page outline and text, locate elements, check that a field is not a password or payment field, and place files the user allowed into a page's upload field. |
| `webNavigation` | To identify embedded frames and their addresses, so frames on sites the user has not allowed are neither read nor clicked. |
| `debugger` | To send real mouse and keyboard input, take screenshots of background tabs, answer JavaScript dialogs, and read console messages and network request addresses. It attaches only to a shared tab on an allowed site, when an agent acts, and detaches after five idle minutes or when the user presses Stop. |
| `nativeMessaging` | To exchange requests and results with the SharedTabs bridge app on the same computer. This is the extension's only connection; it contacts no server. |
| `storage` | To keep the user's settings on this device: allowed and blocked sites, upload folders, and on/off choices. |
| `alarms` | To reconnect to the bridge app and detach the debugger from idle tabs. |
| `sidePanel` | To show current activity, shared tabs, recording and Stop beside the page. |
| Host permissions (`http://*/*`, `https://*/*`) | The user decides which sites agents may use, so the sites cannot be known in advance. No site is allowed until the user chooses one, and every action checks that choice first. |

**Remote code:** No, I am not using remote code.

**Data usage.** Tick these, because agents can read them from pages the user shares:

- [x] Personally identifiable information
- [x] Health information
- [x] Financial and payment information
- [x] Authentication information
- [x] Personal communications
- [x] Location
- [x] Web history
- [x] User activity
- [x] Website content

The developer receives none of it. The dashboard asks what the extension *handles*, so a full declaration is the safe answer, and it must match the privacy policy.

**Certifications:** all three apply:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes unrelated to the item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://ahsan.live/sharedtabs/privacy/ (text from `store/privacy-policy.md`)

## Distribution tab

- Visibility: **Unlisted** for the first version (only people with the link can install it), then Public once it has been used for a while
- Regions: all, or those you can support

## Test instructions for reviewers

Up to 500 characters.

```
No login. Windows only.
1. Install Node.js 20+. Download the bridge at ahsan.live/sharedtabs, unzip, double-click "Set up SharedTabs".
2. Install extension, choose "I agree, turn it on". Popup should say Connected.
3. Settings > Allow specific: add example.com and en.wikipedia.org, Save lists.
4. Open https://example.com, popup > Share this tab.
5. In PowerShell in the bridge folder: node scripts/demo.mjs
debugger: sends real input and screenshots, only in shared tabs on allowed sites.
```
