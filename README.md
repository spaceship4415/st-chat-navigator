# Chat Navigator

[한국어 가이드](README.ko.md)

Find your way around a long SillyTavern chat from one entry in the wand menu.
Search the open chat, jump to a message by number, bookmark the moments you want to come back to,
and hide or delete a range of messages — all with buttons sized for a phone.

## Features

- **One menu** — the wand menu gets a single **Chat Navigator** entry that opens a panel of large buttons, so it does not crowd the menu.
- **Search this chat** — type words separated by spaces; a message must contain all of them, case does not matter.
  Results come newest first, 100 at a time with a **Show more** button, each with its `#number`, sender and the matched words highlighted.
  Tap a result to jump there. The search box stays put while the list scrolls.
- **Jump to a number** — the same `#number` SillyTavern shows on each message. Older messages are loaded for you.
- **Bookmarks** — tap ☆ in a message's `⋯` menu. Bookmarked messages get a ★ next to the name, and the bookmark list jumps to them.
  The mark is stored on the message itself, so it follows the message when earlier ones are deleted.
  Give a bookmark a short note such as a scene name; it shows next to the name in the chat, so the list reads like a table of contents.
- **Chat info** — everything attached to the open chat on one screen, instead of scattered across SillyTavern's menus:
  - a summary: file name, message count (and how many are hidden), an approximate token count, and the first and last message dates;
  - the **persona** — switch it, or lock it to the chat (SillyTavern's *lock to chat*); switching while locked moves the lock along;
  - the **Author's Note** — its text, position (before/after the scenario, or in-chat at a depth and role) and interval;
  - **chat overrides** — whether this chat replaces the card's scenario, example messages or system prompt, with a preview; *Edit* opens SillyTavern's own override editor;
  - **lorebooks** — change or unbind the chat lorebook (✎ opens it in the editor; ＋ creates a new one, binds it and opens the editor — it never overwrites an existing name), and see every lorebook in effect: chat, character (each member in a group), persona and global. Missing files are struck through.
  The Author's Note and chat overrides start folded, with a light by the title: green when in use, amber when the note has text but its interval is 0, grey when empty.
- **Hide a range** — keep messages on screen but leave them out of what the AI sees, to save tokens. Undo the same way.
  The range starts out leaving the latest 20 messages untouched.
- **Delete a range** — starts empty and asks twice, saying how many messages will go.
  If bookmarked messages are among them, it lists them first and offers to delete everything else instead (the default) or everything.
- **Pick messages to hide or delete** — tap messages to tick them, or switch on *Range* and tap the first and the last.
  Scattered picks like `#3, #4, #5, #9` are handled in one go.
- **Top / bottom** — one tap to either end of the chat, from the panel or, if you switch them on, as floating buttons above the message box.
- **Pick up where you left off** — optional: reopen a chat and a *Continue reading #120* chip takes you back to where you were. Kept per device in the browser.
- **Where am I** — optional: while you scroll, `#120 / #450` shows briefly at the top.
- **Read replies from the start** — optional: when a long reply arrives, stop at its first line instead of following it to the bottom.
- **A clear "hidden" badge** next to the name of every hidden message, beside SillyTavern's own small ghost icon.
- **Turn and token alerts** — optional: a notice every N AI replies, or every time the chat passes another N tokens.
- **Careful with big chats** — jumping or going to the top asks first when it would load more than 300 messages, since drawing that many at once can freeze a phone for a moment.

## Install

1. Open **Extensions** (the puzzle icon) in SillyTavern.
2. Click **Install Extension**.
3. Paste this repository's URL and press **Install**.

## Use

Wand menu → **Chat Navigator**.

| Button | What it does |
| --- | --- |
| Search | Search the open chat and jump to a result |
| Jump to number | Enter a message number (`12` or `#12`) |
| Bookmarks (N) | List bookmarked messages; tap to jump, ✎ to add a note, ✕ to remove |
| Chat info | Summary, persona, Author's Note, chat overrides and lorebooks of the open chat |
| Hide range | Leave messages `#from ~ #to` out of the prompt, or bring them back |
| Delete range | Delete messages `#from ~ #to` — this cannot be undone |
| Pick to hide/delete | Tap messages to select them, then hide, unhide or delete the selection |
| Top / Bottom | Scroll to the first or the last message |

Add a bookmark from the message itself: tap `⋯` on a message, then ☆. Tap ★ again to remove it.
The same `⋯` menu also gets a 🗑 button that deletes just that message, without going into edit mode first.
It asks before deleting, and asks separately if the message is bookmarked.

Bookmarks are not SillyTavern's own *Branch* or *Checkpoint*:

| | Bookmark (this extension) | Branch (SillyTavern) | Checkpoint (SillyTavern) |
| --- | --- | --- | --- |
| What it does | **Marks** a message in the current chat | **Copies** the chat up to that message into a new chat | **Copies** the chat up to that message into a new chat |
| Afterwards | Nothing changes | **Switches to the new chat** | **Stays in the current chat**; the message gets a flag |
| Going back | Tap it in the bookmark list to scroll there | Open `… - Branch #1` from the chat list | Tap the flag to open that chat |
| Use it to | Mark scenes to revisit, like a table of contents | Try a different turn of events right away | Save this point and keep going in the original |

In pick mode the message box is replaced by a bar with the count and the actions.
Tapping a message only ticks it — editing, swiping and links are paused until you press **Done**.
Pick mode ends by itself when a reply starts generating or you switch chats.

## What are the Author's Note and chat overrides?

Both are notes slipped to the AI behind the scenes, but they work differently.

**Author's Note** — something you want the AI to keep in mind for this chat. It never shows on screen; it is only inserted into the prompt.
Use it to pin down the current situation (`[Location: a train station on a rainy night. They have just had a fight]`),
to steer the style (`[Short, dry sentences. Keep emotions understated]`), or when a long story makes the AI forget details.
It applies to this chat only, without touching the character card — change it whenever the scene changes.

| Setting | Meaning |
| --- | --- |
| Before / after scenario | Inserted near the top of the prompt, next to the character definition — reads like background |
| In-chat at depth | Inserted between messages; depth 4 means above the latest 4 messages. **The closer to the latest messages, the more strongly the AI follows it** |
| Role | Who the note appears to come from (system / user / AI). System is usually right |
| Interval | 1 = every time, 3 = once every 3 messages, 0 = never |

*In-chat, depth 2–4, interval 1* is a good default.

**Chat overrides** — replace parts of the character card for this chat only; the card itself is untouched.
Override the *scenario* (the card says "first meeting at school", this chat is "reunion ten years later"),
the *example messages* (a different speaking style), or the *system prompt* (different base instructions).
Handy for running several alternate-universe chats with one character without copying the card.

In short: the Author's Note **adds** to the prompt and suits the ever-changing "current situation";
overrides **replace** card content and suit the "world of this chat" that rarely changes.
Both are easy to switch on and forget, which is why they get a light — if the AI keeps bringing up odd details, check whether one is lit.

## Settings

Extensions → **Chat Navigator**.

| Setting | What it does |
| --- | --- |
| Pick up where you left off | Remembers the message at the top of the screen as you read. Reopening the chat shows a chip that jumps back there; it disappears after 15 seconds. Nothing is kept when you leave at the bottom. Stored in this browser only, so a phone and a PC each keep their own place |
| Show position while scrolling | Shows `#current / #last` at the top of the chat while you scroll |
| Stop at the start of a new reply | While a reply streams in, SillyTavern follows it to the bottom. With this on, once the reply grows past the screen its first line is held at the top and SillyTavern stops following; a reply that arrives all at once is scrolled back to its first line. Short replies and *Continue* are left alone, and scrolling down yourself is never undone. Unlike SillyTavern's own *Auto-scroll Chat* (User Settings), which when off also stops scrolling down after you send a message or open a chat, this only affects reading a reply — so keep that one on and use this. With *Auto-scroll Chat* off this option has nothing to do |
| Float a scroll-to-bottom button | Shows ⇊ at the bottom centre of the chat whenever you are not at the bottom |
| Float a scroll-to-top button | Shows ⇈ next to it whenever you are not at the top. Both are off by default; turn on either or both |
| Turn alert, every N turns | Shows a notice each time the number of AI replies reaches another multiple of N |
| Token alert, every N tokens | Shows a notice each time the whole chat passes another multiple of N tokens |

Tokens are counted with the current tokenizer, leaving out hidden messages.
Each alert fires once per step and remembers it per chat, so reloading does not repeat it.
Turning an alert on, or changing N, starts counting from where the chat is now.

## Notes

- The interface text is in Korean for now; the button and setting names above are translations.
- Jumping and deleting use SillyTavern's own `/chat-jump` and `/cut`. Deleting hundreds of messages removes them one at a time and can take a few seconds on a phone.
- Deleting a message that is part of an AI tool call also deletes the linked tool-call messages, as `/cut` does.

## License

MIT
