# 08 — Public AI Assistants TRD

## Purpose

Allow CarUp users to interact with the referral system through CarUp web chat, mobile chat, WhatsApp, Telegram, and future assistants on ChatGPT, Claude, and Gemini.

## Design principle

Do not build separate business logic for every model. Build one CarUp Agent Gateway and connect each assistant to that gateway.

## Assistant surfaces

- CarUp web assistant.
- CarUp mobile assistant.
- WhatsApp assistant.
- Telegram assistant.
- Admin copilot.
- Future custom assistant for ChatGPT.
- Future Claude integration through MCP-style tools.
- Future Gemini integration through function calling.

## Gateway tools

- Validate referral code.
- Create lead.
- Create listing draft.
- Reserve container interest.
- Request quote.
- Generate share card.
- Draft social copy.
- Check campaign status.
- Explain wallet state.
- Open support ticket.

## Safety model

External assistants only receive approved tool access. They cannot directly change balances, approve restricted actions, or bypass CarUp review rules.

## Acceptance criteria

- Same user can start on WhatsApp and continue on web.
- Same referral attribution follows the user across surfaces.
- External assistants call the same audited APIs as internal assistants.
