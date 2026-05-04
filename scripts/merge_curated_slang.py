"""
One-shot script: merges a curated list of well-known Filipino internet slang
into data/slang_seeds.json. Idempotent — re-running skips entries that are
already present so it won't clobber any user/LLM-discovered tweaks.

Run from the project root:
    python scripts/merge_curated_slang.py
"""
from __future__ import annotations
import json
from pathlib import Path

SEEDS_PATH = Path(__file__).resolve().parent.parent / "data" / "slang_seeds.json"

# Curated additions — broad but conservative coverage of Filipino internet
# slang that's been stable in online speech for 5+ years. Where a word is
# ambiguous (real Tagalog with shifted slang meaning), is_ambiguous=true.
CURATED: dict[str, dict] = {
    "naks": {
        "definition": "exclamation of admiration / approval — nice! / look at you!",
        "formation_type": "native", "plain": "nice", "pos": "interjection",
        "origin": "Native Filipino interjection, evolved into a common online compliment.",
        "example": "Naks, ang ganda ng bagong sapatos mo!",
        "is_ambiguous": False,
    },
    "naks naman": {
        "definition": "stronger 'naks' — well done / impressive",
        "formation_type": "native", "plain": "impressive", "pos": "interjection",
        "origin": "Naks + naman intensifier.",
        "example": "Naks naman, na-promote ka!",
        "is_ambiguous": False,
    },
    "tara": {
        "definition": "let's go / come on — invitation to do something",
        "formation_type": "native", "plain": "let's go", "pos": "interjection",
        "origin": "Filipino youth slang shortened from 'tara na' or 'sige na'.",
        "example": "Tara, kain tayo!",
        "is_ambiguous": False,
    },
    "yoko": {
        "definition": "contraction of 'ayaw ko' — I don't want to",
        "formation_type": "contraction", "plain": "I don't want", "pos": "verb",
        "origin": "Casual contraction of 'ayoko' / 'ayaw ko'.",
        "example": "Yoko na mag-aral, tamad na ako.",
        "is_ambiguous": False,
    },
    "chos": {
        "definition": "just kidding — variant of charot",
        "formation_type": "native", "plain": "just kidding", "pos": "interjection",
        "origin": "Younger sibling of 'charot'; popularized on Twitter and TikTok.",
        "example": "Mukha kang manok. Chos!",
        "is_ambiguous": False,
    },
    "lutang": {
        "definition": "spaced out / not paying attention / floating",
        "formation_type": "semantic_shift", "plain": "spaced out", "pos": "adjective",
        "origin": "Tagalog 'lutang' (to float) shifted to mean mentally disconnected.",
        "example": "Lutang na lutang ako sa class kanina.",
        "is_ambiguous": True,
    },
    "atat": {
        "definition": "impatient / overly eager",
        "formation_type": "native", "plain": "impatient", "pos": "adjective",
        "origin": "Reduplication-style coinage from 'atat na atat'.",
        "example": "Atat na atat ka sa results!",
        "is_ambiguous": False,
    },
    "kebs": {
        "definition": "don't care / whatever — short for 'kebs ko sa'yo'",
        "formation_type": "clipping", "plain": "whatever", "pos": "interjection",
        "origin": "Clipped from 'kebs ko sa'yo' (don't care about you).",
        "example": "Kebs lang sa drama nila.",
        "is_ambiguous": False,
    },
    "hugot": {
        "definition": "drawing on deep personal emotion (esp. about relationships)",
        "formation_type": "semantic_shift", "plain": "deep feels", "pos": "noun / adjective",
        "origin": "Tagalog 'hugot' (to pull) shifted to 'pulled-from-the-heart' meaning.",
        "example": "Ang lalim ng hugot ng caption niya.",
        "is_ambiguous": True,
    },
    "chibog": {
        "definition": "food / to eat",
        "formation_type": "native", "plain": "food", "pos": "noun / verb",
        "origin": "Filipino slang for food, possibly from 'pang-chibogan'.",
        "example": "Tara, chibog tayo!",
        "is_ambiguous": False,
    },
    "shet": {
        "definition": "mild expletive — frustration / surprise",
        "formation_type": "borrowing", "plain": "shoot", "pos": "interjection",
        "origin": "Softened phonetic of English 'shit'.",
        "example": "Shet, na-late ako!",
        "is_ambiguous": False,
    },
    "bagets": {
        "definition": "young person / kid / teen",
        "formation_type": "native", "plain": "youngster", "pos": "noun",
        "origin": "Popularized by the 1984 Filipino film 'Bagets'.",
        "example": "Mga bagets pa lang sila, daldal na.",
        "is_ambiguous": False,
    },
    "bagay": {
        "definition": "matches / suits / looks good together",
        "formation_type": "semantic_shift", "plain": "suits", "pos": "verb / adjective",
        "origin": "Tagalog 'bagay' (thing) shifted to mean 'a good fit'.",
        "example": "Sobrang bagay niyo!",
        "is_ambiguous": True,
    },
    "bawi": {
        "definition": "make up for it / get even / try again",
        "formation_type": "semantic_shift", "plain": "make up for it", "pos": "verb",
        "origin": "Tagalog 'bawi' (to take back) used in casual rematch contexts.",
        "example": "Bawi tayo bukas!",
        "is_ambiguous": True,
    },
    "dyahe": {
        "definition": "embarrassing / awkward",
        "formation_type": "phonetic", "plain": "embarrassing", "pos": "adjective",
        "origin": "Phonetic Filipino spelling of 'jaha' / from 'kahihiyan'.",
        "example": "Sobrang dyahe na lumayo na lang ako.",
        "is_ambiguous": False,
    },
    "fafa": {
        "definition": "papa / attractive older guy",
        "formation_type": "native", "plain": "handsome guy", "pos": "noun",
        "origin": "Affectionate slang form of 'papa', popularized by Filipino gay lingo.",
        "example": "Si kuya, fafa material talaga.",
        "is_ambiguous": False,
    },
    "hayss": {
        "definition": "tired sigh / exasperation",
        "formation_type": "native", "plain": "sigh", "pos": "interjection",
        "origin": "Lengthened spelling of 'hay' as a sigh, common in Filipino tweets.",
        "example": "Hayss, ang dami ko pa pong gagawin.",
        "is_ambiguous": False,
    },
    "kembot": {
        "definition": "sashay / hip-shake / strut",
        "formation_type": "native", "plain": "sashay", "pos": "verb / noun",
        "origin": "Tagalog onomatopoeia for hip-swaying motion.",
        "example": "Kembot na dahil pasok ka sa shortlist!",
        "is_ambiguous": False,
    },
    "lafang": {
        "definition": "eat heartily / pig out",
        "formation_type": "native", "plain": "feast", "pos": "verb",
        "origin": "Filipino youth slang for hearty eating.",
        "example": "Tara lafang sa kanto!",
        "is_ambiguous": False,
    },
    "macho": {
        "definition": "masculine / muscular guy",
        "formation_type": "borrowing", "plain": "muscular", "pos": "adjective / noun",
        "origin": "Borrowed from Spanish, common in Filipino media.",
        "example": "Macho talaga ang dating ni kuya.",
        "is_ambiguous": False,
    },
    "mumshie": {
        "definition": "mommy / used affectionately for older female friend",
        "formation_type": "native", "plain": "mommy", "pos": "noun",
        "origin": "Affectionate variant of 'mommy'.",
        "example": "Salamat, mumshie!",
        "is_ambiguous": False,
    },
    "petiks": {
        "definition": "to relax / chill / take it easy",
        "formation_type": "native", "plain": "chill", "pos": "verb",
        "origin": "Filipino slang for downtime / hanging out.",
        "example": "Petiks lang muna bago bumalik sa work.",
        "is_ambiguous": False,
    },
    "repapips": {
        "definition": "friends / buddies / squad",
        "formation_type": "native", "plain": "friends", "pos": "noun",
        "origin": "Filipino youth slang of unclear origin, used since the 80s.",
        "example": "Lakad mga repapips!",
        "is_ambiguous": False,
    },
    "sosyal": {
        "definition": "high-class / fancy / sophisticated",
        "formation_type": "borrowing", "plain": "fancy", "pos": "adjective",
        "origin": "From English 'social' / Spanish 'social'.",
        "example": "Ang sosyal naman ng bagong sasakyan mo!",
        "is_ambiguous": False,
    },
    "soshal": {
        "definition": "variant spelling of sosyal — fancy / high-class",
        "formation_type": "borrowing", "plain": "fancy", "pos": "adjective",
        "origin": "Phonetic re-spelling of 'sosyal'.",
        "example": "Ang soshal ng kainan!",
        "is_ambiguous": False,
    },
    "syota": {
        "definition": "short-time / boyfriend or girlfriend (often casual)",
        "formation_type": "native", "plain": "partner", "pos": "noun",
        "origin": "Filipino slang from 'short time' (from English).",
        "example": "Syota mo na ba si kuya?",
        "is_ambiguous": False,
    },
    "tampo": {
        "definition": "sulk / quiet displeasure (Filipino emotional concept)",
        "formation_type": "native", "plain": "sulk", "pos": "noun / verb",
        "origin": "Distinctly Filipino emotional concept — passive emotional withdrawal.",
        "example": "Nagtatampo siya kasi nakalimutan ko ang anniversary.",
        "is_ambiguous": False,
    },
    "ulol": {
        "definition": "crazy / silly (mild, friendly use among friends)",
        "formation_type": "native", "plain": "crazy", "pos": "adjective",
        "origin": "Tagalog for crazy/rabid; widely used as friendly banter.",
        "example": "Ulol ka, sino magsasabi sa kanya?",
        "is_ambiguous": True,
    },
    "wapakels": {
        "definition": "I don't care / not my problem",
        "formation_type": "native", "plain": "not my problem", "pos": "interjection",
        "origin": "Filipino youth slang from 'wala akong pakialam'.",
        "example": "Wapakels ako sa drama nila.",
        "is_ambiguous": False,
    },
    "yas": {
        "definition": "excited 'yes' — enthusiastic affirmation",
        "formation_type": "borrowing", "plain": "yes", "pos": "interjection",
        "origin": "From English LGBT slang 'yass'.",
        "example": "Yas! Sa wakas!",
        "is_ambiguous": False,
    },
    "yass": {
        "definition": "stronger variant of 'yas' — excited yes",
        "formation_type": "borrowing", "plain": "yes!", "pos": "interjection",
        "origin": "Drag/LGBT slang now common in Filipino tweets.",
        "example": "Yass queen!",
        "is_ambiguous": False,
    },
    "ek-ek": {
        "definition": "annoying drama / overreacting",
        "formation_type": "native", "plain": "drama", "pos": "noun",
        "origin": "Filipino slang for drawn-out drama.",
        "example": "Tigil-tigilan mo na ang ek-ek mo.",
        "is_ambiguous": False,
    },
    "eklavu": {
        "definition": "fancy variant of 'ek-ek' — drama / making a scene",
        "formation_type": "native", "plain": "drama", "pos": "noun",
        "origin": "Filipino gay-lingo style elongation of 'ek-ek'.",
        "example": "Sinuko ko na ang eklavu niya.",
        "is_ambiguous": False,
    },
    "eksena": {
        "definition": "scene / dramatic situation",
        "formation_type": "borrowing", "plain": "scene", "pos": "noun",
        "origin": "From Spanish/English 'scene' — used for any dramatic happening.",
        "example": "Anong eksena diyan?",
        "is_ambiguous": False,
    },
    "eksenado": {
        "definition": "person making a scene / drama maker",
        "formation_type": "borrowing", "plain": "drama maker", "pos": "noun / adjective",
        "origin": "Filipinized form of 'eksena' with -ado suffix.",
        "example": "Mga eksenado talaga sa group chat.",
        "is_ambiguous": False,
    },
    "karir": {
        "definition": "to take seriously / pursue (esp. relationships)",
        "formation_type": "borrowing", "plain": "pursue seriously", "pos": "verb",
        "origin": "Phonetic Filipino respelling of English 'career'.",
        "example": "Kakaririn ko na siya.",
        "is_ambiguous": False,
    },
    "lagot": {
        "definition": "in trouble / about to get caught",
        "formation_type": "semantic_shift", "plain": "in trouble", "pos": "adjective",
        "origin": "Tagalog 'lagot' (snapped/broken) shifted to 'caught/in trouble'.",
        "example": "Lagot, nahuli ako!",
        "is_ambiguous": True,
    },
    "lit": {
        "definition": "fun / exciting / hyped",
        "formation_type": "borrowing", "plain": "exciting", "pos": "adjective",
        "origin": "Borrowed from English youth slang.",
        "example": "Lit yung party kagabi.",
        "is_ambiguous": False,
    },
    "promotega": {
        "definition": "to promote / hype up",
        "formation_type": "native", "plain": "promote", "pos": "verb",
        "origin": "Filipino verbal coinage 'promote + -tega' suffix.",
        "example": "Promotega na natin yung bagong song.",
        "is_ambiguous": False,
    },
    "sana ol": {
        "definition": "variant spelling of 'sana all' — wishing everyone had it",
        "formation_type": "phonetic", "plain": "wish for all", "pos": "interjection",
        "origin": "Casual respelling of 'sana all'.",
        "example": "May pa-trip pa siya, sana ol!",
        "is_ambiguous": False,
    },
    "broski": {
        "definition": "bro / close friend",
        "formation_type": "borrowing", "plain": "bro", "pos": "noun",
        "origin": "Borrowed from English youth slang.",
        "example": "Salamat broski!",
        "is_ambiguous": False,
    },
    "sis": {
        "definition": "sister / female friend / general friendly address",
        "formation_type": "borrowing", "plain": "sister", "pos": "noun",
        "origin": "Borrowed from English; often used among Filipina friends.",
        "example": "Sis, kumusta ka na?",
        "is_ambiguous": False,
    },
    "huehue": {
        "definition": "smug / sneaky laugh",
        "formation_type": "native", "plain": "snicker", "pos": "interjection",
        "origin": "Brazilian-origin online laugh, adopted by Filipino netizens.",
        "example": "Hindi ko sasabihin huehue.",
        "is_ambiguous": False,
    },
    "fyi": {
        "definition": "for your information",
        "formation_type": "borrowing", "plain": "fyi", "pos": "interjection",
        "origin": "Internet acronym borrowed wholesale.",
        "example": "Fyi, may meeting tayo bukas.",
        "is_ambiguous": False,
    },
    "swerte": {
        "definition": "lucky / fortunate",
        "formation_type": "borrowing", "plain": "lucky", "pos": "adjective",
        "origin": "From Spanish 'suerte'.",
        "example": "Ang swerte mo, nakuha mo agad!",
        "is_ambiguous": False,
    },
    "malas": {
        "definition": "unlucky / bad luck",
        "formation_type": "native", "plain": "unlucky", "pos": "adjective / noun",
        "origin": "Tagalog for misfortune, common in everyday slang.",
        "example": "Sobrang malas ko ngayon.",
        "is_ambiguous": False,
    },
    "tanga": {
        "definition": "silly / dumb (used playfully among friends, can be rude)",
        "formation_type": "native", "plain": "silly", "pos": "adjective",
        "origin": "Tagalog for foolish/dumb, omnipresent in informal speech.",
        "example": "Tanga, hindi mo nakita?",
        "is_ambiguous": True,
    },
    "lodicent": {
        "definition": "extra-fancy variant of 'lodi' — super idol",
        "formation_type": "native", "plain": "super idol", "pos": "noun",
        "origin": "Lodi + nonsense '-cent' suffix for emphasis (gay-lingo style).",
        "example": "Lodicent ko si direk!",
        "is_ambiguous": False,
    },
    "petmaluuu": {
        "definition": "elongated 'petmalu' — extra amazing",
        "formation_type": "native", "plain": "amazing", "pos": "adjective",
        "origin": "Drawn-out form of petmalu for emphasis.",
        "example": "Petmaluuu yung effects!",
        "is_ambiguous": False,
    },
    "hayop": {
        "definition": "beast / used to mean amazingly skilled",
        "formation_type": "semantic_shift", "plain": "amazing", "pos": "adjective",
        "origin": "Tagalog 'hayop' (animal) shifted to mean impressive/beast-mode.",
        "example": "Hayop sa galing!",
        "is_ambiguous": True,
    },
    "wagi": {
        "definition": "winning / triumphant",
        "formation_type": "native", "plain": "winning", "pos": "adjective",
        "origin": "Tagalog 'magwagi' (to win), used as adjective in slang.",
        "example": "Wagi ang outfit mo today!",
        "is_ambiguous": False,
    },
    "shookt na shookt": {
        "definition": "very shocked / utterly surprised",
        "formation_type": "native", "plain": "very shocked", "pos": "adjective",
        "origin": "Reduplication of shookt for emphasis.",
        "example": "Shookt na shookt ako sa twist!",
        "is_ambiguous": False,
    },
    "biggie": {
        "definition": "big deal / important",
        "formation_type": "borrowing", "plain": "big deal", "pos": "noun / adjective",
        "origin": "From English youth slang.",
        "example": "Walang biggie kahit hindi ka makapunta.",
        "is_ambiguous": False,
    },
    "yarn": {
        "definition": "expression of doubt / 'is that so?'",
        "formation_type": "native", "plain": "really?", "pos": "interjection",
        "origin": "Filipino gay-lingo coinage.",
        "example": "Sigurado ka? Yarn?",
        "is_ambiguous": False,
    },
    "char": {
        "definition": "just kidding — short variant of charot",
        "formation_type": "clipping", "plain": "just kidding", "pos": "interjection",
        "origin": "Clipped from 'charot'.",
        "example": "Galit ka? Char!",
        "is_ambiguous": False,
    },
    "chariz": {
        "definition": "playful variant of charot — just kidding",
        "formation_type": "native", "plain": "just kidding", "pos": "interjection",
        "origin": "Variant of charot, popular on Twitter.",
        "example": "Pagod ka na ba? Chariz!",
        "is_ambiguous": False,
    },
    "edi wow": {
        "definition": "sarcastic 'good for you' / dismissive congrats",
        "formation_type": "native", "plain": "good for you (sarcastic)", "pos": "interjection",
        "origin": "Filipino sarcastic catchphrase from internet culture.",
        "example": "Pinost niya ulit, edi wow.",
        "is_ambiguous": False,
    },
    "bes": {
        "definition": "best friend (clipping of bestie)",
        "formation_type": "clipping", "plain": "bestie", "pos": "noun",
        "origin": "Already a seed; included here for safety.",
        "example": "Salamat bes!",
        "is_ambiguous": False,
    },
}


def main() -> None:
    if not SEEDS_PATH.exists():
        raise SystemExit(f"slang_seeds.json not found at {SEEDS_PATH}")

    raw = SEEDS_PATH.read_text(encoding="utf-8")
    existing: dict = json.loads(raw)

    added: list[str] = []
    for word, meta in CURATED.items():
        if word in existing:
            continue
        existing[word] = meta
        added.append(word)

    if not added:
        print("Nothing to add — all curated entries already present.")
        return

    SEEDS_PATH.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Added {len(added)} entries:")
    for w in added:
        print(f"  • {w}")


if __name__ == "__main__":
    main()
