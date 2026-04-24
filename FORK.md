# Fork Notes — Community Customizations

This is a personal fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) with additional features and bug fixes contributed back to the community.

## Features Added

### Telegram Enhancements
- **Photo support**: Photos sent via Telegram are automatically saved to `/workspace/group/uploads/` and passed to Claude as a readable file path with caption.
- **Message reaction (👀)**: The bot reacts to incoming messages to acknowledge receipt — useful for knowing your message was processed.
- **BiDi text fix**: Fixes right-to-left rendering for Persian/Arabic and other RTL text in responses.

### Container Skills
Two new skills are available in `container/skills/`:

#### `pdf-reader`
Read and extract text from PDF files — either sent as Telegram attachments or fetched from a URL. Uses `pdftotext` (pre-installed in the agent container).

```bash
# PDF from Telegram attachment (saved to uploads/)
pdftotext "/workspace/group/uploads/filename.pdf" -

# PDF from URL
curl -sLo /tmp/doc.pdf "<url>" && pdftotext /tmp/doc.pdf -
```

#### `x-fetch`
Fetch tweet content from X/Twitter links without API keys or login. Uses the public FxTwitter API.

```bash
python3 /home/node/.claude/skills/x-fetch/fetch_tweet.py --url https://x.com/user/status/123456789
```

Returns JSON with author, text, date, engagement stats. No login required.

## Bug Fixes
These fixes from upstream were cherry-picked for stability:
- `047a422` — Forward `ONECLI_API_KEY` to OneCLI SDK for authenticated container config
- `2183a68` — Update config mocks for authenticated gateway compatibility

## Docker Notes
- `docker-compose.yml`: Make sure to set `NANOCLAW_HOST_PROJECT_ROOT` to your actual host project path (see comments in the file).
- See `DOCKER_ISSUE.md` for a detailed breakdown of Docker-in-Docker issues and their fixes when self-hosting on a VPS.
