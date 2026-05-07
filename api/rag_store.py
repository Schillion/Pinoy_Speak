"""
Lightweight in-memory RAG store for slang entries.

Uses sentence-transformers all-MiniLM-L6-v2 (22 MB) to encode each
dictionary entry once at startup, then answers semantic nearest-neighbour
queries in microseconds via numpy dot-product.  The store is thread-safe
and supports incremental updates (single-word inserts) so new tutor-learned
words are immediately searchable without a full rebuild.
"""

from __future__ import annotations
import threading
from typing import Optional
import numpy as np

_model = None
_embeddings: Optional[np.ndarray] = None
_words:  list[str] = []
_texts:  list[str] = []
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def _entry_to_text(word: str, entry: dict) -> str:
    parts = [f"{word}: {entry.get('definition', '')}"]
    if entry.get("plain"):
        parts.append(f"Plain English: {entry['plain']}.")
    if entry.get("origin"):
        parts.append(f"Origin: {entry['origin']}.")
    return " ".join(parts)


def build_index(lexicon: dict) -> None:
    """Encode all entries and store embeddings in memory.  Called once at startup."""
    global _embeddings, _words, _texts
    if not lexicon:
        return
    model = _get_model()
    words, texts = zip(*[
        (w, _entry_to_text(w, e)) for w, e in lexicon.items()
    ])
    embs = model.encode(list(texts), show_progress_bar=False, batch_size=64)
    with _lock:
        _words      = list(words)
        _texts      = list(texts)
        _embeddings = np.array(embs, dtype="float32")
    print(f"[rag_store] indexed {len(_words)} entries")


def add_entry(word: str, entry: dict) -> None:
    """Incrementally add one word without a full rebuild."""
    global _embeddings, _words, _texts
    text = _entry_to_text(word, entry)
    emb  = _get_model().encode([text], show_progress_bar=False).astype("float32")
    with _lock:
        _words.append(word)
        _texts.append(text)
        _embeddings = np.vstack([_embeddings, emb]) if _embeddings is not None else emb


def query(user_message: str, top_k: int = 5) -> list[dict]:
    """Return up to top_k most semantically relevant entries for user_message."""
    with _lock:
        if _embeddings is None or not _words:
            return []
        embs  = _embeddings
        words = list(_words)
        texts = list(_texts)

    q_emb  = _get_model().encode([user_message], show_progress_bar=False).astype("float32")
    scores = (embs @ q_emb.T).squeeze()
    if scores.ndim == 0:
        scores = np.array([float(scores)])
    k = min(top_k, len(words))
    top_idx = np.argsort(scores)[-k:][::-1]
    return [
        {"word": words[i], "context": texts[i], "score": round(float(scores[i]), 3)}
        for i in top_idx
        if scores[i] > 0.15  # filter out noise
    ]
