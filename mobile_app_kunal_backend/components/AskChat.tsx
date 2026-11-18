"use client";

/**
 * A conversation with the historian.
 *
 * Replaces the single-shot search box. The difference that matters is not the
 * bubbles — it is that a turn can modify the last one: "today's power", then
 * "and yesterday?", then "peak?". Each answer keeps the parts the follow-up
 * did not mention and says which ones it carried, because on a follow-up the
 * reader needs to know what is still in force.
 *
 * ── There is no model behind this ─────────────────────────────────────────
 * Every reply is the grammar in gateway/queryParse.ts plus figures the
 * historian measured. It answers instantly, offline, for nothing, and it
 * cannot invent a number because it never writes one — queryAnswer.ts selects
 * and compares, and the app draws.
 *
 * The cost is honest: it converses about seven fields and refuses everything
 * else. It does not chat. When it does not understand, it says so and offers
 * something to tap rather than guessing, and each of those refusals is the
 * evidence for whether a model is worth adding and for what — see the note in
 * queryParse.ts on the residual.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { parseTurn, type HistoryQuery } from "../gateway/queryParse";
import type { Answer } from "../gateway/queryAnswer";
import { useInterpretAvailable, interpretUnparsed } from "../data";
import { FloatingCard } from "./Surfaces";
import { Chip, ChipRow } from "./Feature";

/** Openers, shown once. Real questions rather than placeholder text. */
const OPENERS = [
  "Today's power",
  "SOC on 25 August",
  "When did cell spread exceed 200 mV",
];

/** Offered after a successful answer, to show that follow-ups work at all. */
const FOLLOW_UPS = ["And yesterday?", "Peak?", "What about BESS 2?"];

const time = (t: number) =>
  new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

const dateTime = (t: number) =>
  new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v: number | null, dp = 1) => (v == null ? "—" : v.toFixed(dp));

export interface Turn {
  id: number;
  /** What the person typed. */
  asked: string;
  /**
   * The grammar's phrasing of the question, when a local model had to
   * translate it. Shown on screen, because a reader is entitled to see the
   * question that was actually answered rather than trusting that it matched
   * the one they asked.
   */
  readAs?: string;
  /** Null while the historian is still being read. */
  answer: Answer | null;
  /** Set when the turn resolved to a question; absent on a refusal. */
  query?: HistoryQuery;
  assumptions: string[];
  refusal?: { reason: string; suggestions: string[] };
}

export function AskChat({
  turns, pending, onAsk, onClear, now,
}: {
  turns: Turn[];
  /** The turn currently awaiting the historian, if any. */
  pending: boolean;
  onAsk: (q: HistoryQuery, asked: string, assumptions: string[], readAs?: string) => void;
  onClear: () => void;
  now: number;
}) {
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<Turn | null>(null);
  /* A question in the hands of the model. Held separately so its bubble can
     say what is happening — several seconds of silence on a local model reads
     as a broken box otherwise. */
  const [interpreting, setInterpreting] = useState<string | null>(null);
  const canInterpret = useInterpretAvailable();
  const endRef = useRef<HTMLDivElement>(null);

  /* Follow the conversation as it grows, but never on first paint — an empty
     thread scrolling itself would move the page under someone who has not
     asked anything. */
  useEffect(() => {
    if (turns.length || refusal) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns.length, refusal, pending]);

  async function submit(raw: string) {
    const asked = raw.trim();
    if (!asked) return;
    setText("");

    /* The last ANSWERED question is the context, not the last turn — a refusal
       must not become the thing a follow-up modifies. */
    const previous = [...turns].reverse().find((t) => t.query)?.query ?? null;
    const r = parseTurn(asked, previous, now);

    if (r.ok) {
      setRefusal(null);
      onAsk(r.query, asked, r.assumptions);
      return;
    }

    /* The grammar did not recognise it. If this deployment has a local model,
       it gets one attempt to rewrite the question into the grammar's own
       vocabulary — and the rewrite is then parsed by exactly this code path,
       so nothing downstream can receive a query the grammar could not have
       produced itself. */
    if (!canInterpret) {
      setRefusal({ id: Date.now(), asked, answer: null, assumptions: [], refusal: r });
      return;
    }

    setRefusal(null);
    setInterpreting(asked);
    const rewritten = await interpretUnparsed(asked);
    setInterpreting(null);

    const second = rewritten ? parseTurn(rewritten, previous, now) : null;
    if (!second || !second.ok) {
      /* The model declined, was unreachable, or produced something the grammar
         still cannot read. All three are the same answer to a reader, and the
         grammar's own refusal is the better message — it names what the
         historian holds rather than discussing the model. */
      setRefusal({ id: Date.now(), asked, answer: null, assumptions: [], refusal: r });
      return;
    }
    onAsk(second.query, asked, second.assumptions, rewritten!);
  }

  function clear() {
    setText("");
    setRefusal(null);
    onClear();
  }

  const empty = turns.length === 0 && !refusal;

  return (
    <FloatingCard style={{ marginBottom: 16 }}>
      <div className="m-spread" style={{ alignItems: "center", marginBottom: 12 }}>
        <span className="m-eyebrow">Ask the history</span>
        {!empty && (
          <button
            type="button"
            onClick={clear}
            className="m-label m-ink3"
            style={{ background: "none", border: 0, padding: 4, cursor: "pointer" }}
          >
            Clear
          </button>
        )}
      </div>

      {empty ? (
        <div className="m-stack" style={{ gap: 12 }}>
          <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
            Ask about this unit's recorded history. Answers come from the plant's own
            readings — nothing here is generated.
          </span>
          <ChipRow>
            {OPENERS.map((o) => (
              <button key={o} type="button" onClick={() => submit(o)}
                style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                <Chip>{o}</Chip>
              </button>
            ))}
          </ChipRow>
        </div>
      ) : (
        /* Capped and scrollable: a long conversation must not push the chart —
           the thing this screen exists to show — off the bottom of the phone. */
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 14,
            maxHeight: "46vh", overflowY: "auto", paddingRight: 2,
          }}
        >
          {/* The waiting state belongs to the turn that is waiting — TurnView
              renders it from `answer === null`. A second bubble here showed
              "Reading the historian…" twice for one question. `pending` is
              still used below, to hold the follow-up chips back until there
              is an answer to follow up on. */}
          {turns.map((t) => <TurnView key={t.id} turn={t} />)}
          {refusal && <TurnView turn={refusal} onSuggest={submit} />}
          {interpreting && (
            <div className="m-stack" style={{ gap: 8 }}>
              <Bubble side="you">
                <span className="m-body" style={{ lineHeight: 1.45 }}>{interpreting}</span>
              </Bubble>
              <Bubble side="bot">
                <span className="m-body m-ink3">Working out what you mean…</span>
              </Bubble>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {!empty && turns.some((t) => t.query) && !pending && (
        <ChipRow>
          {FOLLOW_UPS.map((f) => (
            <button key={f} type="button" onClick={() => submit(f)}
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
              <Chip>{f}</Chip>
            </button>
          ))}
        </ChipRow>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); submit(text); }}
        className="m-search"
        style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}
      >
        <Search size={15} className="m-ink3" />
        <input
          className="m-search-input"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={turns.length ? "Ask a follow-up" : "Ask about this plant's history"}
          aria-label="Ask about this plant's history"
          enterKeyHint="send"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {text && (
          <button type="button" onClick={() => setText("")} aria-label="Clear the box"
            style={{ background: "none", border: 0, padding: 4, cursor: "pointer", color: "var(--m-ink-3)", display: "flex" }}>
            <X size={16} />
          </button>
        )}
      </form>
    </FloatingCard>
  );
}

/* ── One exchange ──────────────────────────────────────────────────────── */

function Bubble({ side, children }: { side: "you" | "bot"; children: React.ReactNode }) {
  const you = side === "you";
  return (
    <div style={{ display: "flex", justifyContent: you ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "86%",
          padding: "10px 14px",
          borderRadius: 16,
          /* The asker's own words sit on the accent; the answer sits on the
             app's own glass, so a reply never looks like a claim the person
             made themselves. */
          background: you ? "var(--m-primary)" : "var(--m-glass)",
          border: you ? "0" : "1px solid var(--m-border)",
          color: you ? "#fff" : undefined,
          borderBottomRightRadius: you ? 5 : 16,
          borderBottomLeftRadius: you ? 16 : 5,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TurnView({ turn, onSuggest }: { turn: Turn; onSuggest?: (s: string) => void }) {
  return (
    <div className="m-stack" style={{ gap: 8 }}>
      <Bubble side="you">
        <span className="m-body" style={{ lineHeight: 1.45 }}>{turn.asked}</span>
      </Bubble>

      {turn.refusal ? (
        <Bubble side="bot">
          <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>{turn.refusal.reason}</span>
          <ChipRow>
            {turn.refusal.suggestions.map((s) => (
              <button key={s} type="button" onClick={() => onSuggest?.(s)}
                style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                <Chip>{s}</Chip>
              </button>
            ))}
          </ChipRow>
        </Bubble>
      ) : turn.answer === null ? (
        <Bubble side="bot"><span className="m-body m-ink3">Reading the historian…</span></Bubble>
      ) : (
        <Bubble side="bot">
          <AnswerView answer={turn.answer} />
          {/* What the model turned the question into. First, and plainly: if
              it misunderstood, this is the line that shows it, and a reader
              who never sees it has no way to tell. */}
          {turn.readAs && (
            <div className="m-label m-ink3" style={{ marginTop: 8, fontStyle: "italic" }}>
              Read as “{turn.readAs}”
            </div>
          )}
          {turn.query && (
            <div className="m-label m-ink3" style={{ marginTop: 8 }}>
              {turn.query.range.label}
              {turn.query.unit ? ` · ${turn.query.unit.replace("bess_", "BESS ")}` : ""}
            </div>
          )}
          {/* Plain lines, not chips. A chip is one unwrapped row by design, and
              these sentences are longer than a bubble is wide — inside a
              bubble capped at 86% they ran straight out of it. */}
          {turn.assumptions.map((a) => (
            <div key={a} className="m-label m-ink3" style={{ marginTop: 4, lineHeight: 1.45 }}>
              {a}
            </div>
          ))}
        </Bubble>
      )}
    </div>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  if (answer.kind === "unanswerable" || answer.kind === "series") {
    return (
      <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
        {answer.kind === "series"
          ? `${sentence(answer.label)} for this period is on the chart below.`
          : sentence(answer.reason)}
      </span>
    );
  }

  if (answer.kind === "value") {
    return (
      <div className="m-stack" style={{ gap: 4 }}>
        <span>
          <span className="m-h2 m-ink">{num(answer.value)}</span>
          <span className="m-body m-ink3" style={{ marginLeft: 5 }}>{answer.unit}</span>
        </span>
        <span className="m-label m-ink3">{sentence(answer.label)}</span>
        {answer.note && <span className="m-label m-ink3" style={{ lineHeight: 1.5 }}>{answer.note}</span>}
      </div>
    );
  }

  if (answer.kind === "range") {
    return (
      <div className="m-stack" style={{ gap: 4 }}>
        <span>
          <span className="m-h2 m-ink">{num(answer.low)}</span>
          <span className="m-body m-ink3" style={{ margin: "0 5px" }}>to</span>
          <span className="m-h2 m-ink">{num(answer.high)}</span>
          <span className="m-body m-ink3" style={{ marginLeft: 5 }}>{answer.unit}</span>
        </span>
        <span className="m-label m-ink3">{sentence(answer.label)}</span>
        <span className="m-label m-ink3" style={{ lineHeight: 1.5 }}>{answer.note}</span>
      </div>
    );
  }

  /* Crossings. An empty list is a real answer and says so — rendering nothing
     would read as the question having failed. */
  if (!answer.crossings.length) {
    return (
      <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
        {sentence(answer.label)} did not cross that level at any point in this period.
      </span>
    );
  }

  const shown = answer.crossings.slice(0, 5);
  return (
    <div className="m-stack" style={{ gap: 6 }}>
      <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
        {answer.crossings.length === 1 ? "Once:" : `${answer.crossings.length} times:`}
      </span>
      {shown.map((c) => (
        <span key={c.from} className="m-label m-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
          {new Date(c.from).toDateString() === new Date(c.to).toDateString()
            ? `${time(c.from)}–${time(c.to)}`
            : `${dateTime(c.from)} – ${dateTime(c.to)}`}
          <span className="m-ink3"> · peak {num(c.peak)} {answer.unit}</span>
        </span>
      ))}
      {answer.crossings.length > shown.length && (
        <span className="m-label m-ink3">
          and {answer.crossings.length - shown.length} more
        </span>
      )}
    </div>
  );
}
