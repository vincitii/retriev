# Retriev

A focused PA school study planner built in React with spaced repetition, interleaving, active recall, and content generation powered by Anthropic Claude.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root with your Anthropic key:

```bash
REACT_APP_ANTHROPIC_API_KEY=your_api_key_here
```

3. Start the app locally:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- Upload notes, lecture slides, and textbooks (PDF/text).
- Add exam dates and required topics or chapters.
- Automatically extract high-yield PA topics from uploaded content.
- Generate a full daily study schedule with 90-minute blocks.
- Review due topics using active recall, clinical examples, mnemonics, analogies, and concept maps.
- Track weak spots, confidence, and weekly progress.
- Persist all study data in `localStorage`.

## Notes

- The app uses `pdfjs-dist` to extract text from PDFs in the browser.
- Claude API responses require a valid `REACT_APP_ANTHROPIC_API_KEY` set in `.env`.
- If the API key is missing, you can still upload content and add manual topics, but generated assets will be limited.
