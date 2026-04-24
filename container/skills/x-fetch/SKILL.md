---
name: x-fetch
description: Fetch tweet content from X/Twitter URLs without API keys or login. Use whenever the user shares an x.com or twitter.com link and wants to read its content.
allowed-tools: Bash
---

# Fetching Tweets from X/Twitter

Use this skill whenever the user shares an X or Twitter URL and wants to read a tweet.

## Fetch a single tweet

```bash
python3 /home/node/.claude/skills/x-fetch/fetch_tweet.py --url <tweet_url> --lang en
```

Returns JSON with author, text, date, likes, retweets, and views.

## Examples

```bash
# Fetch a tweet
python3 /home/node/.claude/skills/x-fetch/fetch_tweet.py --url https://x.com/user/status/123456789 --lang en

# Twitter.com URLs work too
python3 /home/node/.claude/skills/x-fetch/fetch_tweet.py --url https://twitter.com/user/status/123456789 --lang en
```

## Notes

- Works without login or API keys (uses FxTwitter public API)
- Only `--url` mode is supported — timeline, replies, and search require additional tools not installed here
- If the fetch fails, try `agent-browser` to open the tweet URL directly in the browser
