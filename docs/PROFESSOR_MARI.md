# Professor Mari

<p align="center">
  <img src="../packages/client/public/sprites/mari/Mari_explaining.png" width="320" alt="Professor Mari explaining Marinara Engine" />
</p>

Professor Mari is Marinara Engine's built-in assistant character. She lives in your character library by default, cannot be deleted, and helps you understand the app, set up core features, and create or edit basic content without learning every panel first.

Think of Mari as an in-app guide who can also take a few safe content actions for you. She is best at explaining Marinara, helping you get unstuck, drafting new characters/personas/lorebooks from rough ideas, and making targeted edits after she has fetched the current item.

## What Mari Is For

Use Mari when you want help with:

- Setting up your first connection, character, persona, conversation, roleplay, or Game Mode session.
- Understanding the difference between Conversation, Roleplay, and Game Mode.
- Creating a new character card or persona from a rough description.
- Updating an existing character card or persona.
- Creating a lorebook from worldbuilding notes.
- Opening a specific app panel, such as Characters, Lorebooks, Connections, Agents, Personas, or Settings.
- Reviewing existing characters, personas, lorebooks, chats, or presets after she fetches them into context.
- Explaining common Marinara concepts, such as lorebooks, presets, agents, sprites, selfies, Game Mode, and connected chats.

Mari is a guide and helper, not a replacement for the full documentation. When something is version-specific, security-sensitive, or recently changed, prefer the docs and release notes as the source of truth.

## What Mari Can Do

Mari can talk through most parts of the app, and some requests can become hidden app actions after her message. The command text is hidden from you; you only see the result.

Implemented actions include:

- Create personas.
- Create character cards.
- Update existing character cards.
- Update existing personas.
- Create lorebooks, optionally with starter entries.
- Create new Conversation or Roleplay chats with a selected character.
- Navigate to app panels and settings tabs.
- Fetch existing characters, personas, lorebooks, chats, and presets so she can inspect their details before advising or editing.

When Mari creates something, she should ask for the important details first if your request is vague. When she updates something, she should fetch the current item first and change only the fields you asked her to change.

## How To Ask Mari

You can speak to Mari naturally. For best results, include the thing you want changed, the level of detail you want, and whether she should ask follow-up questions before acting.

Helpful request shapes:

- "Explain what this setting does before I change it."
- "Create a persona for a shy vampire librarian. Ask me for missing details first."
- "Fetch my character Luna and make only her first message less generic."
- "Make a lorebook from these world notes. Keep the entries short."
- "Open the Connections panel and help me set up OpenRouter."

For edits, name the item and the field or behavior you want changed. Requests like "rewrite this whole character" are riskier than "fetch Luna and tighten her greeting while keeping her personality the same."

## Important Safety Notes

Creating new content is usually safe because it does not overwrite anything. Editing existing content deserves more care.

- Character edits keep a recoverable version snapshot that can be rolled back from the character history.
- Persona edits overwrite the persona without a snapshot. Back up a persona first if you want to preserve the old version.
- Mari should fetch an item before updating it so she can see the current values and avoid overwriting unrelated fields.
- If Mari has not fetched the item yet, ask her to fetch it before making the edit.
- Mari cannot reliably know what you meant if you ask for a broad rewrite with no constraints. Give her the specific field, tone, or behavior you want changed.

## What Mari Cannot Do Yet

These are not implemented as dedicated Mari workflows today:

- Submit GitHub bug reports or feature requests from inside the app.
- Draft a GitHub bug report from a dedicated `#bug-report` trigger.
- Create a fully configured Game Mode chat or complete the whole Game Setup Wizard through hidden commands.
- Manage billing, external accounts, sync, or provider dashboards for you.
- Guarantee her built-in app knowledge is newer than the installed version.
- Automatically ingest the latest GitHub docs into her own prompt.

Mari can still talk you through those tasks. For Game Mode, for example, she can help choose the genre, tone, party, persona, GM style, model, and lorebooks, then guide you through the wizard. The wizard remains the source of truth for starting the game.

If Mari says she completed one of these unsupported actions, treat that as guidance rather than confirmation. Use the relevant app panel or docs to finish the task.

## How Mari Knows About Marinara

Mari has a built-in assistant prompt that explains Marinara's major features and command syntax. That prompt is bundled with the app and updated when the app updates.

Marinara also has separate knowledge-source features:

- **Knowledge Sources** let you upload text-based files or PDFs for the Knowledge Retrieval agent.
- **Knowledge Retrieval** scans selected lorebooks and uploaded files, extracts relevant information, and injects it into the prompt.
- **Knowledge Router** selects relevant lorebook entries by ID and injects the selected entries directly.

Those knowledge-source features are general agent tools. They are not the same thing as Mari's built-in app prompt, and the app does not currently maintain an automatic "GitHub docs to Mari knowledge base" pipeline.

## Getting Better Answers From Mari

For setup help, tell Mari what you are trying to do and what provider/model you are using. For content help, tell her what you want to keep, what you want changed, and whether she should ask questions first.

Good examples:

- "Help me set up Game Mode for a dark fantasy campaign. I have Claude Opus for the GM and ComfyUI for images."
- "Create a character card for a cheerful alchemist. Ask me for details one step at a time."
- "Fetch my character Luna and help me make her first message less generic."
- "Explain why my Roleplay HUD keeps showing the wrong time."

If Mari gives an answer that does not match what you see in the app, trust the app, docs, and release notes first. Then report the mismatch in Discord or GitHub.

The most useful report includes:

- What you asked Mari.
- What Mari said or tried to do.
- What the app or docs showed instead.
- Which Marinara version you are running.

## Related Docs

- [Conversation Mode](CONVERSATION.md)
- [Roleplay Mode](ROLEPLAY.md)
- [Game Mode](GAME_MODE.md)
- [FAQ](FAQ.md)
- [Troubleshooting](TROUBLESHOOTING.md)
