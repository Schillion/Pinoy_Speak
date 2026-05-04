export interface WordEntry {
  word: string;
  pos: string;
  plain: string;
  def: string;
  example: string;
}

export const FALLBACK_WORDS: WordEntry[] = [
  { word: "lodi",    pos: "noun",                    plain: "idol",         def: "Term of admiration — your idol or role model.",                     example: "Si ate mo talaga ang lodi ko sa coding! (Your older sister is my idol in coding!)" },
  { word: "omsim",   pos: "interjection",             plain: "exactly",      def: "Means 'exactly' or 'that's right'.",                                 example: "—Tama ba ako? —Omsim! (—Am I right? —Exactly!)" },
  { word: "petmalu", pos: "adjective",               plain: "amazing",      def: "Amazing, impressive, or outstanding.",                               example: "Petmalu yung trick shot niya! (His trick shot was amazing!)" },
  { word: "werpa",   pos: "interjection",             plain: "go for it",    def: "Go for it / you can do it — a cheer of encouragement.",             example: "Kaya mo 'yan, werpa! (You got this, go for it!)" },
  { word: "charot",  pos: "interjection",             plain: "just kidding", def: "Just kidding — used to walk back a statement.",                     example: "Mag-aaral na ko bukas... charot! (I'll study tomorrow... just kidding!)" },
  { word: "awit",    pos: "interjection",             plain: "that sucks",   def: "Expression of disappointment or sadness.",                           example: "Awit, wala na kong load. (Sucks, I'm out of credits.)" },
  { word: "shookt",  pos: "adjective",               plain: "shocked",      def: "Shocked or stunned — can't believe what you saw.",                  example: "Shookt ako sa plot twist! (I was shook by the plot twist!)" },
  { word: "kilig",   pos: "noun / adjective",         plain: "giddy",        def: "The giddy, fluttery feeling you get from romance.",                  example: "Super kilig ako nung tumawag siya! (I got so giddy when he called me!)" },
  { word: "gigil",   pos: "noun / verb",              plain: "overwhelmed",  def: "The overwhelming urge to pinch or squeeze something cute.",           example: "Gigil ako sa cute ng baby! (I can't help but want to squeeze the cute baby!)" },
  { word: "grabe",   pos: "interjection / adjective", plain: "intense",      def: "Intense, extreme, or used as 'wow / oh my god'.",                   example: "Grabe ang init ngayon! (It's so hot today!)" },
  { word: "jusko",   pos: "interjection",             plain: "oh my",        def: "Exclamation of surprise — like 'oh my God'.",                       example: "Jusko, hindi ko inaasahan 'yan! (Oh my, I didn't expect that!)" },
  { word: "keri",    pos: "verb / adjective",         plain: "manageable",   def: "Can handle it / it's okay / no problem.",                           example: "Maraming trabaho pero keri naman. (Lots of work but it's manageable.)" },
  { word: "epal",    pos: "noun / adjective",         plain: "show-off",     def: "Someone who inserts themselves uninvited or seeks attention.",        example: "Ang epal niya, palaging nasa picture! (What a show-off!)" },
  { word: "chika",   pos: "noun / verb",              plain: "gossip",       def: "Gossip or the latest news / to share gossip.",                      example: "May bagong chika ba? (Any new gossip?)" },
  { word: "beshie",  pos: "noun",                    plain: "bestie",       def: "Best friend — warm term of address.",                               example: "Ikaw talaga ang beshie ko! (You're really my best friend!)" },
  { word: "jowa",    pos: "noun",                    plain: "partner",      def: "Boyfriend or girlfriend / romantic partner.",                        example: "Sino na jowa mo ngayon? (Who's your partner now?)" },
  { word: "tropa",   pos: "noun",                    plain: "squad",        def: "A close group of friends — your squad.",                            example: "Sama-sama tayong tropa mamaya. (We'll all hang out as a squad later.)" },
  { word: "solid",   pos: "adjective",               plain: "reliable",     def: "Reliable, dependable, or showing strong support.",                  example: "Solid ang suporta ng tropa ko! (My squad's support is solid!)" },
  { word: "bet",     pos: "interjection",             plain: "agreed",       def: "Agreed / I'm down for it / sure.",                                  example: "—Kain tayo mamaya? —Bet! (—Eat later? —Agreed!)" },
  { word: "sus",     pos: "adjective",               plain: "suspicious",   def: "Suspicious or sketchy — something feels off.",                      example: "Sus yung gawi niya lately. (He's been acting suspicious lately.)" },
  { word: "ghost",   pos: "verb",                    plain: "ignored",      def: "To suddenly stop replying and disappear.",                           example: "Ginhost niya ako after ng date. (She ghosted me after our date.)" },
  { word: "slay",    pos: "verb / interjection",      plain: "nailed it",    def: "To do something impressively / you looked amazing.",                 example: "Slay ng outfit mo ngayon! (You're slaying your outfit today!)" },
  { word: "lowkey",  pos: "adverb",                  plain: "quietly",      def: "Secretly / subtly / without making a big deal.",                   example: "Lowkey gusto ko siya. (I quietly like him.)" },
  { word: "highkey", pos: "adverb",                  plain: "obviously",    def: "Obviously / very much so / not hiding it at all.",                  example: "Highkey miss na miss na kita! (I obviously miss you so much!)" },
  { word: "mood",    pos: "noun / interjection",      plain: "relatable",    def: "A relatable feeling or situation — 'same'.",                        example: "—Ayaw ko nang pumasok. —Mood. (—I don't want to go. —Mood.)" },
  { word: "dead",    pos: "adjective",               plain: "laughing hard", def: "Dying of laughter — incredibly funny.",                             example: "Dead na dead ako sa joke mo! (I'm dying at your joke!)" },
  { word: "legit",   pos: "adverb / adjective",       plain: "genuinely",    def: "Genuinely / for real / not joking.",                                example: "Legit masarap yung kain doon! (The food there is genuinely delicious!)" },
  { word: "extra",   pos: "adjective",               plain: "overdramatic",  def: "Overdramatic or over-the-top — doing too much.",                   example: "Ang extra niya, may makeup pa sa beach! (So extra — makeup at the beach!)" },
  { word: "salty",   pos: "adjective",               plain: "bitter",       def: "Bitter, resentful, or sore about something.",                       example: "Salty pa rin siya kahit matagal na. (She's still bitter after a long time.)" },
  { word: "feels",   pos: "noun",                    plain: "emotions",     def: "Strong emotions — hitting you in the feelings.",                    example: "Ang daming feels ng kanta na 'to! (This song gives so many feels!)" },
  { word: "savage",  pos: "adjective",               plain: "ruthless",     def: "Impressively blunt, ruthless, or brutally honest.",                 example: "Savage ng comeback niya! (Her comeback was ruthless!)" },
  { word: "luh",     pos: "interjection",             plain: "seriously",    def: "Expression of disbelief, side-eye, or mild shade.",                 example: "Luh, 'di ba sabi mo absent ka? (Seriously, didn't you say absent?)" },
  { word: "chill",   pos: "verb / adjective",         plain: "relax",        def: "Relax / hang out / calm down.",                                     example: "Mag-chill muna tayo sa bahay. (Let's just chill at home.)" },
  { word: "cancel",  pos: "verb",                    plain: "boycott",      def: "To publicly boycott or call out someone for bad behavior.",          example: "Cancel na siya ng lahat. (Everyone cancelled him.)" },
  { word: "basic",   pos: "adjective",               plain: "unoriginal",   def: "Unoriginal, mainstream, or lacking personality.",                   example: "Basic lang ang taste niya sa music. (Her music taste is just basic.)" },
  { word: "paasa",   pos: "noun / verb",              plain: "false hope",   def: "Someone who gives false hope — leads you on without intention.",    example: "Paasa ka talaga! (You really give false hope!)" },
  { word: "beh",     pos: "noun",                    plain: "friend",       def: "Casual term of endearment for a close friend.",                    example: "Tara na beh, hintay ka pa dyan! (Come on friend, you're still waiting there!)" },
];

export function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}
