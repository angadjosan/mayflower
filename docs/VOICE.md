# Voice notes in iMessage (ElevenLabs)

People can talk to Mayflower instead of typing: hold the mic button in iMessage and send a voice memo. This is the street-interview path.

- **In:** a voice memo is transcribed with ElevenLabs speech-to-text (`scribe_v2`) and handled exactly like a typed text.
- **Out:** a reply to a voice memo comes back as a voice note (ElevenLabs text-to-speech, `eleven_flash_v2_5`) when it is a real conversational answer. Quick acks ("got it", under ~90 spoken characters) stay as texts. Links and `APPROVE` codes are never read out; they follow the voice note as texts, and the voice says "the link's in the next text".
- Typing "send me a voice memo", "say it out loud" or "read it to me" also gets a spoken answer. A typed conversation stays typed.
- A spoken reply is capped at ~320 characters (~20 s) of whole lines; anything past that follows as texts ("i texted you the rest"). A reply with more than one link (a list of trade ideas) stays all text so each link keeps its label. Voice memos over 6 MB get "mind sending a shorter one?". Voice memos in group chats are never transcribed (they are between friends, not to us).
- **Use a paid ElevenLabs key and test it from the deployed server.** The free tier can answer 401 "unusual activity" from cloud IPs like Vercel's. A 401/402/429 tells the user "my ears are down for a sec, mind typing that one?" instead of asking them to re-record.
- **Fallbacks:** no `ELEVENLABS_API_KEY` means voice memos get "i can't listen to voice memos yet, mind typing that one?" and every reply is text. Any text-to-speech or send failure falls back to the normal texts.

| Piece | File |
|---|---|
| When to speak, what to say (pure, tested) | `src/lib/voiceNotes.ts` + `voiceNotes.test.ts` |
| ElevenLabs STT / TTS calls | `src/lib/elevenlabs.ts` |
| Download a voice memo, send an audio file | `src/lib/bluebubbles.ts` (`downloadAttachment`, `sendAudio`) |
| Voice memo detection + transcription | `src/app/api/bluebubbles/webhook/route.ts` |
| Voice note vs texts at send time | `src/lib/notify.ts` (`sendToUser`) |

Measured on the bridge Mac (BlueBubbles 1.9.9, macOS 26.5.2, 2026-10-11):
- A voice memo arrives with empty `text`, `isAudioMessage: true`, and an attachment with uti `com.apple.coreaudio-format`. BlueBubbles labels it `audio/mp3`, but the default download is the CAF converted to AAC in an `.m4a` container, which speech-to-text accepts. No ffmpeg needed.
- Our replies go out as a playable audio attachment (`mayflower.mp3`), not iMessage's native voice-memo bubble. The native bubble needs BlueBubbles' Private API, which is off on that Mac (it needs SIP disabled).
- Sending an attachment to the `any;-;<handle>` chat delivered in about 1.4 s.

Env: `ELEVENLABS_API_KEY` (required), optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`.

# Phone calls with Mayflower (ElevenLabs, P3 stretch)

Users can call Mayflower and talk to the same agent they text. The rules don't change:

- **No trades by voice.** The call can explain, summarize and research. To trade, the agent texts the signed approval link, and the user approves from their phone.
- **Inbound calls only.** Mayflower never places outbound calls.
- **No always-on recording.** The only audio is a call the user chose to make. Turn off ElevenLabs call-recording/audio retention in the agent's privacy settings if you don't need it.

## How it works

```
caller ──phone──> Twilio number ──(ElevenLabs native Twilio integration)──> ElevenLabs Conversational AI agent
                                                                                  │ server tools (webhooks)
                                                                                  ▼
                                               POST {APP_URL}/api/voice/tools/<tool>
                                               header x-mayflower-voice-secret: <ELEVENLABS_TOOL_SECRET>
                                               body { caller: "{{system__caller_id}}", ... }
```

The caller is identified by phone number. ElevenLabs fills the `system__caller_id` dynamic variable on Twilio calls, and we normalize it (US numbers become `+1XXXXXXXXXX`) and match it against the user's iMessage handle. If the number is unknown, the tools return a polite refusal and share no account data.

| Tool | Body | Does |
|---|---|---|
| `portfolio` | `{caller}` | At-risk amount, room left, P&L, open positions, paused state |
| `pending_proposals` | `{caller}` | Pending ideas, each with a `proposalId` |
| `explain` | `{caller, question}` | Runs the same grounded chat agent (`handleMessage`). URLs are stripped from the spoken answer |
| `find_opportunities` | `{caller, focus?}` | Runs discovery (up to 2 ideas), texts the details and approval links, and speaks a summary |
| `send_approval_link` | `{caller, proposalId?}` | Texts the signed approval link for one pending idea and returns "Sent to your phone" |

Every tool response is `{ ok, say, ... }`, and the agent reads `say` aloud. Each tool call is written to the audit log as `voice.tool.<name>`.

## Setup

1. **Env** (in the app's environment):
   - `ELEVENLABS_TOOL_SECRET`: a long random string. If it's unset, `/api/voice/tools/*` returns 503.
   - `ELEVENLABS_AGENT_ID`: the agent's id, for reference and ops.
   - `ELEVENLABS_API_KEY`: optional, only needed if you script agent updates through the ElevenLabs API.
   - `APP_URL` must be the public HTTPS URL, because ElevenLabs calls the tool URLs built from it.
2. **Create the agent.** In ElevenLabs, go to Conversational AI → Agents → New agent (blank).
   - Open `GET {APP_URL}/api/voice/agent-config` and copy its `system_prompt` and `first_message` into the agent.
   - Pick a voice and an LLM. Keep responses short.
3. **Add the tools.** For each entry in `tools` from agent-config, add a **Webhook** tool with the same name, description, URL, method `POST`, and body schema:
   - `caller`: set the value type to **Dynamic variable** `system__caller_id`. (The JSON includes `"dynamic_variable": "system__caller_id"` for exactly this.)
   - Header `x-mayflower-voice-secret`: create a workspace **secret** holding your `ELEVENLABS_TOOL_SECRET` and reference that secret. Never paste the secret into the prompt.
   - Timeouts: about 20s for most tools, 45s for `explain`, 90s for `find_opportunities`.
4. **Connect a phone number.** In ElevenLabs → Phone Numbers → Import from Twilio, enter your Twilio number, Account SID and Auth Token, then assign the number to the Mayflower agent. ElevenLabs configures the Twilio voice webhook for **inbound** calls. Don't set up outbound or batch calling.
5. **Test.** Call the number from the phone that matches a user's iMessage handle and ask "what's my portfolio?" or "text me the approval link". Then call from a different number and confirm you get the refusal.

Local tool test:

```bash
curl -s -X POST http://localhost:3000/api/voice/tools/portfolio \
  -H "x-mayflower-voice-secret: $ELEVENLABS_TOOL_SECRET" -H 'content-type: application/json' \
  -d '{"caller":"+14155550123"}'
```

## Caveats

- Caller ID can be spoofed. That's why the call is limited to read-only answers and to texting links to the number already on file. Possessing the phone (and the link) is still required to trade.
- `explain` goes through the full chat agent, so profile edits ("lower my max per trade to $10"), pause/resume and rejecting an idea also work by voice, exactly as they do over iMessage. Approvals never do.
- Untested end-to-end: calling through ElevenLabs/Twilio hasn't been exercised. Only the tool endpoints were tested locally.
