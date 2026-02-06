# Genesis 2 — Prose Studio

An iPad-centric writing studio for crafting world-class, best-seller prose. Genesis 2 is a Progressive Web App designed for serious fiction and non-fiction writers who demand professional-grade tools in a distraction-free environment.

## Features

### Writing Editor
- Distraction-free, iPad-optimized contentEditable editor
- Rich text formatting (bold, italic, headings, blockquotes)
- Scene break insertion
- Auto-save with 2-second debounce
- Focus mode that hides all UI chrome
- Dark, light, and sepia themes
- Touch-optimized with 44px+ tap targets throughout

### Manuscript Management
- Project-based organization with chapters and scenes
- Drag-friendly sidebar tree navigation
- Per-scene and per-chapter word counts
- Scene status tracking (draft, revised, final)
- Point-of-view and location metadata per scene

### Prose Analysis Engine
- **Prose Score** (0-100) — composite quality metric
- **Readability** — Flesch-Kincaid score and grade level
- **Sentence Variety** — length distribution visualization with variety score
- **Weak/Filler Words** — flags diluting words (very, really, just, etc.)
- **Filter Words** — "show don't tell" indicators (felt, noticed, saw, etc.)
- **Passive Voice** — detection with percentage and examples
- **Adverb Frequency** — -ly word tracking
- **Cliche Detection** — common phrases that weaken prose
- **Word Repetition** — flags overused words beyond common articles
- **Sentence Opening Analysis** — catches repeated sentence starters
- **Dialogue Ratio** — balance between dialogue and narrative
- **Lexical Diversity** — unique word ratio for vocabulary richness

### Story Structure
- **Three-Act Structure** — 15-beat breakdown with word position mapping
- **Hero's Journey** — Campbell's monomyth adapted for modern fiction
- **Seven-Point Structure** — Dan Wells' streamlined plot framework
- **Kishoutenketsu** — East Asian four-act structure
- Beat-to-word-count mapping with progress tracking
- Current beat identification and next-beat guidance

### Character Management
- Character profiles with name, role, description
- Motivation and character arc tracking
- Role classification (protagonist, antagonist, supporting, minor)
- Per-character notes

### Notes & World Building
- Project-linked notes organized by type
- Categories: General, World Building, Research, Plot

### Export
- **Standard Manuscript Format** — Shunn-style HTML (Courier 12pt, double-spaced)
- **Styled HTML** — beautiful reading format
- **Plain Text** — universal .txt export
- **JSON Backup** — complete project backup with all metadata
- Print stylesheet for direct browser printing

### iPad Optimization
- Progressive Web App — installable to home screen
- Offline-first with Service Worker caching
- `viewport-fit=cover` for edge-to-edge iPad display
- Safe area inset support
- Touch target minimums (44-48px)
- Responsive grid adapts to iPad split view
- `-webkit-overflow-scrolling: touch` for smooth scrolling
- Virtual keyboard awareness

## Tech Stack

- Vanilla JavaScript (ES modules)
- IndexedDB for persistent local storage
- Service Worker for offline caching
- CSS Grid + Flexbox layout
- No build step, no dependencies — loads directly in the browser

## Getting Started

1. Serve the project directory with any HTTP server:
   ```
   npx serve .
   ```
   Or open `index.html` in any modern browser.

2. On iPad: navigate to the URL in Safari, then use **Share > Add to Home Screen** to install as a standalone app.

3. Create a new project and start writing.

## Project Structure

```
Genesis/
├── index.html          App shell
├── manifest.json       PWA manifest
├── sw.js               Service worker (offline support)
├── css/
│   ├── main.css        Core layout and component styles
│   └── themes.css      Dark, light, and sepia themes
├── js/
│   ├── app.js          Main application controller
│   ├── editor.js       ContentEditable rich text editor
│   ├── storage.js      IndexedDB persistence layer
│   ├── manuscript.js   Project/chapter/scene management
│   ├── prose.js        Prose analysis engine
│   ├── structure.js    Story structure beat sheets
│   └── export.js       Multi-format export
└── icons/
    ├── icon-192.svg    PWA icon (192x192)
    └── icon-512.svg    PWA icon (512x512)
```

## Writing with Genesis 2

Genesis 2 analyzes your prose against patterns found in best-selling fiction:

- **Readability**: Best sellers typically score 60-80 on the Flesch scale (grade 5-9)
- **Sentence variety**: Mix short punchy sentences with longer flowing ones
- **Active voice**: Keep passive voice under 15% of sentences
- **Word choice**: Replace weak fillers with precise, evocative language
- **Show don't tell**: Minimize filter words that create narrative distance
- **Dialogue balance**: 20-50% dialogue is typical for commercial fiction
