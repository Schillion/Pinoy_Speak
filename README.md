<p align="center">
  <h1 align="center">🇵🇭 PinoySpeak</h1>
  <p align="center">
    <strong>An intelligent, self-learning Filipino slang dictionary powered by NLP and machine learning.</strong>
  </p>
  <p align="center">
    <a href="#features">Features</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#deployment">Deployment</a>
  </p>
</p>

---

## What is PinoySpeak?

PinoySpeak is a full-stack web application that **autonomously discovers, classifies, and defines Filipino slang** from social media. It continuously scrapes Reddit communities, trains a FastText embedding model on the collected corpus, and uses heuristic + LLM pipelines to detect emerging slang in real time.

Unlike static slang dictionaries, PinoySpeak **learns on its own** — new slang terms are detected through temporal burstiness analysis and semantic shift detection, then verified and enriched with definitions via Google Gemini.

---

## Features

### 🔍 Real-Time Slang Analyzer
Paste any Taglish sentence and instantly see each word classified as **standard**, **slang**, **profane**, or **unknown** — with explanations of *why* the system flagged it (e.g., "Novel word with high trend score Z=3.42").

### 📖 Living Dictionary
A searchable, server-side-rendered dictionary of all known Filipino slang with:
- Definitions, example sentences, and formation types (Binaliktad, Jejemon, abbreviation, etc.)
- Variant spelling resolution (`chariz` → `charot`, `sanaol` → `sana all`)
- Fuzzy search for misspellings

### 📊 Word Trend Dashboard
Interactive Recharts-powered visualizations showing:
- Daily post volume across the scraped corpus
- Language mix breakdown (Tagalog vs English vs code-switched)
- Top trending slang with corpus frequency counts

### 💬 Slang Tutor Chatbot
An AI-powered conversational tutor that teaches Filipino slang through:
- Natural dialogue with context-aware responses
- Built-in quiz games, flashcards, and word-matching challenges
- Powered by Google Gemini (free tier) with a rule-based fallback

### 🌐 Concordance Search
Search for any word across the entire scraped corpus and see it in context — the actual Reddit posts where it appeared, with dates and engagement metrics.

### 🔄 Autonomous Learning Pipeline
A background daemon that runs continuously:
1. **Scrapes** 40+ Filipino subreddits (new, hot, rising, top)
2. **Deduplicates** and stores posts in SQLite
3. **Retrains** the FastText model incrementally every 300 new posts
4. **Detects** novel slang via burstiness Z-scores + semantic shift analysis
5. **Enriches** candidates with LLM-generated definitions and metadata

---

## Tech Stack

### Backend (Python)
| Component | Technology |
|---|---|
| API Framework | FastAPI + Uvicorn |
| NLP Model | FastText (Gensim) |
| Language Processing | calamanCy (Filipino spaCy) |
| Database | SQLite |
| LLM Integration | Google Gemini API |
| Scraping | Reddit JSON API + ThreadPoolExecutor |

### Frontend (TypeScript)
| Component | Technology |
|---|---|
| Framework | Next.js 14 (App Router, SSR) |
| Styling | Tailwind CSS + custom glassmorphism design system |
| Animations | Framer Motion |
| Charts | Recharts |
| Typography | Outfit (Google Fonts) |

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) (free, optional — enables the AI tutor)

### 1. Clone the repository
```bash
git clone https://github.com/Schillion/PinoySpeak.git
cd PinoySpeak
```

### 2. Set up the backend
```bash
pip install -r requirements.txt
python -m spacy download en_core_web_sm
python -m calamancy download tl_calamancy_md-0.1.0
```

### 3. Set up the frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
# Edit .env.local → set PYTHON_API_URL=http://localhost:8000
cd ..
```

### 4. Seed the corpus (first run only)
```bash
python automate.py
# Let it run for 1–2 rounds to collect initial data and train the model.
# Press Ctrl+C when you see "Model updated."
```

### 5. Start both servers
```bash
# Terminal 1 — Backend
uvicorn api.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start exploring Filipino slang! 🎉

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                      │
│  Dashboard │ Dictionary │ Analyzer │ Tutor │ Concordance │
│                  (SSR + Client Components)               │
└────────────────────────┬────────────────────────────────┘
                         │  /api/* proxy routes
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   FastAPI Backend                        │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Slang    │  │ Dictionary   │  │ Background       │  │
│  │ Detector │  │ Service      │  │ Learner Daemon   │  │
│  │          │  │              │  │                  │  │
│  │ FastText │  │ Fuzzy Match  │  │ Reddit Scraper   │  │
│  │ Burstiness│ │ Variant Res. │  │ Model Retrainer  │  │
│  │ Sem.Shift│  │ Multi-word   │  │ LLM Enricher    │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘  │
│       │               │                   │             │
│       └───────────────┼───────────────────┘             │
│                       ▼                                 │
│              ┌─────────────────┐                        │
│              │   SQLite DB     │                        │
│              │   corpus.db     │                        │
│              │   (32K+ posts)  │                        │
│              └─────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

---

## Deployment

PinoySpeak can be deployed for free using:
- **Vercel** (frontend) — auto-detects Next.js, zero config
- **Fly.io** (backend) — persistent volumes for SQLite + ML models

See the [Deployment Guide](DEPLOYMENT_GUIDE.md) for step-by-step instructions.

---

## Project Structure

```
PinoySpeak/
├── api/
│   ├── main.py              # FastAPI app, endpoints, background learner
│   ├── corpus_utils.py      # SQLite corpus queries, top-slang detection
│   └── online_slang_sources.py  # Web scraper for slang lists
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx         # Dashboard (word trends, metrics)
│       │   ├── dictionary/      # SSR dictionary page
│       │   ├── chat/            # Slang tutor chatbot
│       │   ├── translator/      # Sentence analyzer
│       │   ├── concordance/     # Corpus search
│       │   └── top-slang/       # Trending slang leaderboard
│       └── components/          # Sidebar, cards, animations
├── data_collection.py       # Reddit scraping engine
├── model_pipeline.py        # FastText training (full + incremental)
├── slang_detector.py        # Classification: burstiness + semantic shift
├── slang_enricher.py        # LLM-powered definition generation
├── dictionary_service.py    # Lexicon, variant resolution, fuzzy search
├── automate.py              # Continuous scrape → train loop
└── data/
    └── corpus.db            # SQLite database (generated at runtime)
```

---

## License

This project was built as an academic/research tool for studying Filipino internet language evolution.

---

<p align="center">
  Built with 💙 for the Filipino internet community
</p>
