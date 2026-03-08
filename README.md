# WebLens

WebLens is an AI Website Reverse-Engineer.
Paste any URL and it returns:

- website purpose
- target audience
- business model
- likely features
- likely tech stack
- improvement ideas
- marketing ideas
- SEO strategy cues
- competitor opportunities
- startup idea inspired by the site
- estimated traffic source mix
- clone blueprint (frontend, backend, monetization)

## Features

- Landing page with instant URL input (`/`)
- Analyzer dashboard with history + result cards (`/analyze`)
- About and docs pages (`/about`, `/docs`)
- Scraping extraction: title, headings, text, images, links
- AI analysis via Gemini (preferred) with OpenAI optional fallback
- Firecrawl scraping path (optional; native fallback included)
- Follow-up Ask AI panel
- Copy analysis / copy blueprint actions

## Project Structure

```text
WebLens/
  server.js
  package.json
  .env.example
  public/
    index.html
    analyze.html
    about.html
    docs.html
    app.js
    styles.css
    favicon.svg
```

## Run Locally

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Fill `GEMINI_API_KEY` (recommended). `OPENAI_API_KEY` is optional fallback. `FIRECRAWL_API_KEY` is optional.

3. Start the server:

```bash
npm run dev
```

4. Open:

```text
http://localhost:8787
```

## API

### `POST /api/analyze`

Request:

```json
{ "url": "https://example.com" }
```

Response includes `scraped`, `analysis`, and `blueprint` objects.

### `POST /api/ask`

Request:

```json
{
  "question": "How does this site likely make money?",
  "context": {
    "analysis": {},
    "blueprint": {},
    "scraped": {}
  }
}
```

## Notes

- WebLens uses `GEMINI_API_KEY` first if available, then `OPENAI_API_KEY` fallback.
- Without either AI key, WebLens uses deterministic heuristic analysis.\n- With `FIRECRAWL_API_KEY`, WebLens attempts Firecrawl first; if unavailable, it falls back to native fetch scraping.
- Private/local network URLs are blocked for safety.

