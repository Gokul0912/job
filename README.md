# Fresher Job Search

A lightweight job-search web app for entry-level candidates. It reads public RSS job feeds through a Netlify Function, scores listings against a user query, and ranks fresher-friendly roles.

## What This Demonstrates

- Static frontend with a serverless backend
- Netlify Functions
- RSS feed parsing
- Search scoring, keyword expansion, and basic ranking logic
- Defensive frontend rendering with HTML escaping

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- Netlify Functions
- Node.js
- `rss-parser`

## Features

- Search by role and optional skills
- Filter by work mode and market
- Fresher-friendly ranking
- Senior-role penalty scoring
- Public RSS source integration
- Client-side rendering with safe escaping

## Run Locally

Install dependencies:

```bash
npm install
```

Run with Netlify CLI:

```bash
netlify dev
```

The frontend is served from `public/`, and the search function is available at:

```text
/.netlify/functions/search
```

## Notes

The app intentionally uses free public sources, so search quality depends on available RSS feeds. The next meaningful upgrade would be adding more verified job sources, deduplication, saved searches, and email alerts.

