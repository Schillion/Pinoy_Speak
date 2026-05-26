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

PinoySpeak is a full-stack web application that **autonomously discovers, classifies, and defines Filipino slang** from social media. It continuously scrapes 15 Filipino Reddit communities and YouTube comments, trains a FastText embedding model on the collected corpus, and uses a multi-step NLP + LLM pipeline to detect emerging slang in real time.

Unlike static slang dictionaries, PinoySpeak **learns on its own** — new slang terms are detected through temporal burstiness analysis and semantic shift detection, then verified and enriched with definitions via LLM.

**Live at [pinoyspeak.vercel.app](https://pinoyspeak.vercel.app)**

---

## Features

### 🔍 Real-Time Slang Analyzer
Paste any Taglish sentence and instantly see each word classified as **standard**, **slang**, **profane**, or **unknown** — with explanations of *why* the system flagged it. A context-window gate checks surrounding Filipino particles before labeling ambiguous words (e.g. *bet*, *basic*, *solid*) as slang.

### 📖 Living Dictionary
A searchable, server-side-rendered dictionary of all corpus-attested Filipino slang (~79 active entries) with:
- Definitions, example sentences, plain-English glosses, and formation types
- Variant spelling resolution (`chariz` → `charot`, `sanaol` → `sana all`)
- CSV export of the full dictionary
- "What counts as slang?" criteria guide built in

### 📊 Word Trend Dashboard
Interactive Recharts visualizations showing:
- Daily post volume across the scraped corpus
- Language mix breakdown (Tagalog vs English vs code-switched)
- Top trending slang with corpus frequency counts and time-series charts

### 💬 Kuya Slang AI Tutor (`/tutor`)
An AI-powered conversational tutor that teaches Filipino slang through:
- Natural dialogue with context-aware responses grounded in the live lexicon
- Built-in quiz games, flashcards, and word-matching challenges
- RAG-powered lookup so responses are always based on verified dictionary entries
- Auto-learns new slang encountered in conversation

### 🌐 Concordance Search
Search for any word across the entire scraped corpus and see it in context — the actual posts where it appeared, with dates.

### 🔄 Autonomous Learning Pipeline
A background daemon that runs continuously:
1. **Scrapes** 15 Filipino Reddit communities every 10 minutes + YouTube comments hourly
2. **Deduplicates** and stores posts in SQLite (175,000+ posts)
3. **Retrains** the FastText model incrementally when corpus grows ≥ 200 KB
4. **Detects** novel slang via burstiness Z-scores (novel: Z > 2.0, semantic shift: Z > 1.8)
5. **Enriches** candidates with LLM-generated definitions and metadata

---

## What Makes a Word Count as Slang?

A word must pass at least one of three criteria:

| Criterion | Threshold | Example |
|---|---|---|
| **Lexical novelty** — absent from standard dictionaries and tokenizes into 2+ subwords | n/a | *shookt*, *petmalu*, *omsim* |
| **Burstiness** — daily frequency spikes vs. historical average | Z > 2.0 | *awit*, *bet*, *slay* |
| **Semantic shift** — known word used with a new meaning in Filipino context | Z > 1.8 | *ghost* (ignore), *solid* (reliable), *mood* (relatable) |

**False positive guard:** Morphological prefix filter blocks conjugated Tagalog verbs (`naka-`, `napaka-`, `nag-`, `pinaka-`). A context-window gate prevents ambiguous English-borrowed words from being labeled slang in English sentences.

---

## Tech Stack

### Backend (Python)
| Component | Technology |
|---|---|
| API Framework | FastAPI + Uvicorn |
| NLP Model | FastText (Gensim) |
| Language Processing | calamanCy (Tagalog spaCy) + jcblaise/roberta-tagalog-base |
| Database | SQLite |
| LLM — Enrichment pipeline | Google Gemini (primary) → Groq Llama 3.1 8B → Ollama (local) |
| LLM — Tutor chatbot | Groq Llama 3.3 70B (primary) → Gemini 2.0 Flash |
| Scraping | Reddit PRAW + YouTube Data API |
| Vector search | Custom RAG store (lexicon embeddings) |

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
- A [Groq API key](https://console.groq.com) or [Google Gemini API key](https://aistudio.google.com/app/apikey) (free, optional — enables the AI tutor and enrichment)

### 1. Clone the repository
```bash
git clone https://github.com/Schillion/Pinoy_Speak.git
cd Pinoy_Speak
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
│  │ Burstiness│ │ Variant Res. │  │ YouTube Scraper  │  │
│  │ Sem.Shift│  │ RAG Store    │  │ Model Retrainer  │  │
│  │ Ctx.Gate │  │ Multi-word   │  │ LLM Enricher     │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘  │
│       │               │                   │             │
│       └───────────────┼───────────────────┘             │
│                       ▼                                 │
│              ┌─────────────────┐                        │
│              │   SQLite DB     │                        │
│              │   corpus.db     │                        │
│              │  (175K+ posts)  │                        │
│              └─────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

---

## Deployment

PinoySpeak is deployed for free using:
- **Vercel** (frontend) — auto-detects Next.js, zero config, auto-deploys on push to `main`
- **Fly.io** (backend) — persistent volumes for SQLite + ML models, auto-deploys via GitHub Actions on backend file changes

See the [Deployment Guide](DEPLOYMENT_GUIDE.md) for step-by-step instructions.

---

## Project Structure

```
PinoySpeak/
├── api/
│   ├── main.py              # FastAPI app, endpoints, background learner
│   ├── corpus_utils.py      # SQLite corpus queries, top-slang detection
│   ├── rag_store.py         # Vector index for lexicon semantic search
│   └── online_slang_sources.py  # Web scraper for slang lists
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx         # Dashboard (word trends, metrics)
│       │   ├── dictionary/      # SSR dictionary page + CSV export
│       │   ├── tutor/           # Kuya Slang AI tutor chatbot
│       │   ├── translator/      # Sentence analyzer
│       │   ├── concordance/     # Corpus search
│       │   ├── top-slang/       # Trending slang leaderboard
│       │   └── about/           # About + how slang detection works
│       └── components/          # Sidebar, cards, animations
├── data_collection.py       # Reddit scraping engine (15 subreddits)
├── youtube_scraper.py       # YouTube comment scraping (hourly)
├── model_pipeline.py        # FastText training (full + incremental)
├── slang_detector.py        # Classification: burstiness + semantic shift
├── slang_enricher.py        # LLM-powered definition generation
├── dictionary_service.py    # Lexicon, variant resolution, fuzzy search
├── automate.py              # Continuous scrape → train loop
└── data/
    ├── corpus.db            # SQLite database (generated at runtime)
    ├── slang_seeds.json     # 102 manually curated seed entries
    └── discovered_slang.json  # Autonomously discovered entries
```

---

## Presentation Materials

| File | Description |
|------|-------------|
| [sp2_Pinoy_Speak.pdf](presentation/sp2_Pinoy_Speak.pdf) | Manuscript / signed first page |
| [Pinoy_Speak_Poster.png](presentation/Pinoy_Speak_Poster.png) | Symposium poster |
| [Pinoy_Speak_SP_Presentation.pptx](presentation/Pinoy_Speak_SP_Presentation.pptx) | Presentation slides |
| [Demo video](https://drive.google.com/drive/folders/1Yhxc2JjrRZ5tGxGg_YoBJxC0LADxbmuD?usp=drive_link) | Screen recording (Google Drive) |

---

## License

This project was built as an academic/research tool for studying Filipino internet language evolution.

---

<p align="center">
  Built with 💙 for the Filipino internet community
</p>
