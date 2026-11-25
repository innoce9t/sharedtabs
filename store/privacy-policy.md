# SharedTabs privacy policy

Effective: 25 November 2026

SharedTabs is a Chrome extension and a small bridge app that let AI agent software on your own computer use Chrome tabs you choose. This policy covers both.

## The short version

We receive none of your data. There is no account, server, analytics or advertising. What agents read goes from your Chrome to the agent on your computer. Your agent may then send it elsewhere under its own terms.

## What SharedTabs handles

SharedTabs does nothing until you agree on its setup page. After that, and only for tabs you share or an agent opens, on sites you allow, an agent can ask for:

- Page text, page outlines, form contents and screenshots, which can include personal, financial, health, location, sign-in or other sensitive information shown on the page, and your communications
- Titles and addresses of those tabs
- Console messages, and addresses of network requests with query values removed
- Recordings of its own steps, as images of the page

If you turn on file uploads, the bridge app reads files you allow, when an agent asks, and places them in the page the agent is using.

Fields that a page marks as passwords, payment cards or one-time codes are left out of page outlines, and typing in them is refused. This depends on how the page is built, so it can't be guaranteed. Screenshots and page text show whatever is visible.

## How it is used

Only to carry out what your agent asks, so that it can work in your tabs. It is not used for anything else.

## Who receives it

- **The agent software on your computer** that you connected. It may send what it receives to an AI provider or other services. Its own terms and privacy policy apply, and we don't control them.
- **GitHub**, only when you run "Update SharedTabs". The bridge app then downloads the newest version from GitHub, which sees your IP address like any website. Nothing about your browsing or settings is sent, and nothing is checked in the background.
- **The websites you allow**, which receive what an agent types, clicks and uploads, as if you had done it.

Nobody else. We do not receive, sell, share or transfer your data, or use it for advertising, for credit decisions, or to train AI models. No person at SharedTabs can see it.

## What is stored, and where

Everything stays on your device:

- Your settings, in Chrome's extension storage
- Which tabs are shared, until Chrome closes
- A list of recent agent actions (tool, site, time and result, without page content or typed text), in memory until the extension restarts
- Recordings you or an agent save, in your Downloads folder
- The bridge app's connection file and a log of when it started and any errors, in a folder in your user profile

## Security

The extension talks to the bridge app through Chrome's native messaging. The bridge app talks to agents through a local connection that only your Windows account can open. Neither opens a network port. Other programs running under your account could connect, so run only software you trust.

## Your choices

You can stop sharing a tab, change allowed sites, turn off uploads, press Stop, or withdraw your agreement at any time. Removing the extension deletes its settings. Running the bridge app's uninstall command removes its files. Recordings stay until you delete them.

## Limited Use

The use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Children

SharedTabs is not directed at children.

## Changes

If what SharedTabs handles or who receives it changes, we will update this page and ask for your agreement again in the extension.

## Contact

[hello@ahsan.live](mailto:hello@ahsan.live), [ahsan.live](https://ahsan.live)
