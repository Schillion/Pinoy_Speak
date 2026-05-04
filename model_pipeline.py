import pandas as pd
import re
import os
from gensim.models import FastText
from rich.console import Console

console = Console()

_RE_URL     = re.compile(r'http\S+|www\S+')
_RE_REPEAT  = re.compile(r'(.)\1{2,}')
_RE_NONWORD = re.compile(r'[^\w\s]')


class PinoySpeakPipeline:
    def preprocess(self, text: str) -> list[str]:
        """Lightweight tokenization — no external NLP needed for embedding training."""
        text = text.lower()
        text = _RE_URL.sub('', text)
        text = _RE_REPEAT.sub(r'\1', text)   # sobraaa → sobra
        text = _RE_NONWORD.sub('', text)
        tokens = text.split()
        return [t for t in tokens if t]

    def _tokenize_df(self, df: pd.DataFrame) -> list[list[str]]:
        sentences = [self.preprocess(str(t)) for t in df['text']]
        return [s for s in sentences if s]

    def train(self, data_path: str = "data/corpus.db",
              model_path: str = "data/social_model.model") -> bool:
        """
        Smart trainer:
        - First run → full train on all data (10 epochs)
        - Subsequent runs → incremental update on NEW posts only (3 epochs)

        Tracks which posts have already been trained via `data/trained_offset.txt`.
        """
        if not os.path.exists(data_path):
            console.print("[red]Data file not found.[/red]")
            return False

        try:
            import sqlite3
            conn = sqlite3.connect(data_path)
            df = pd.read_sql("SELECT text FROM posts", conn)
            conn.close()
        except Exception as e:
            console.print(f"[red]Failed to read data: {e}[/red]")
            return False

        total = len(df)
        offset_file = data_path.replace('.db', '_trained_offset.txt')
        trained_offset = 0
        if os.path.exists(offset_file):
            try:
                with open(offset_file) as f:
                    trained_offset = int(f.read().strip())
            except Exception:
                pass

        model_exists = os.path.exists(model_path)

        # Offset beyond current file means data was rebuilt — force full retrain
        if trained_offset > total:
            console.print(f"[yellow]Offset {trained_offset} > total {total}; resetting for full retrain.[/yellow]")
            trained_offset = 0

        if not model_exists or trained_offset == 0:
            # --- Full train ---
            console.print(f"[cyan]Full train on {total} posts...[/cyan]")
            sentences = self._tokenize_df(df)
            if not sentences:
                console.print("[red]No sentences after tokenization.[/red]")
                return False
            try:
                model = FastText(vector_size=100, window=3, min_count=3, epochs=10)
                model.build_vocab(corpus_iterable=sentences)
                model.train(corpus_iterable=sentences,
                            total_examples=len(sentences), epochs=model.epochs)
                model.save(model_path)
                with open(offset_file, "w") as f:
                    f.write(str(total))
                console.print(f"[bold green]Full train done — vocab: {len(model.wv)} words[/bold green]")
                return True
            except Exception as e:
                console.print(f"[red]Training failed: {e}[/red]")
                return False

        else:
            # --- Incremental update on new posts only ---
            new_df = df.iloc[trained_offset:]
            if new_df.empty:
                console.print("[yellow]No new posts to train on.[/yellow]")
                return True

            console.print(
                f"[cyan]Incremental update: {len(new_df)} new posts "
                f"(+{len(new_df)} of {total} total)...[/cyan]"
            )
            new_sentences = self._tokenize_df(new_df)
            if not new_sentences:
                console.print("[yellow]No new sentences after tokenization.[/yellow]")
                return True

            try:
                model = FastText.load(model_path)
                model.build_vocab(corpus_iterable=new_sentences, update=True)
                model.train(corpus_iterable=new_sentences,
                            total_examples=len(new_sentences), epochs=5)
                model.save(model_path)
                with open(offset_file, "w") as f:
                    f.write(str(total))
                console.print(
                    f"[bold green]Incremental update done — vocab: {len(model.wv)} words[/bold green]"
                )
                return True
            except Exception as e:
                console.print(f"[red]Incremental update failed: {e}[/red]")
                return False


if __name__ == "__main__":
    PinoySpeakPipeline().train()
