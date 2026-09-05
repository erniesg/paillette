import { useEffect, useRef, useState } from 'react';

/**
 * Reads a description aloud with the browser's own speech synthesis.
 *
 * `describe_artwork` generates the words; this is what makes them reach someone
 * who cannot see the painting. It deliberately does not depend on the agent
 * host: an agent reading its own reply aloud only helps a visitor who brought
 * one, whereas this works for anybody who opens the page.
 *
 * Feature-detected, because `speechSynthesis` is absent in some browsers and in
 * the jsdom the tests run under — where it must render nothing rather than
 * throw. Rendering nothing is also what makes the surfaces that use it work
 * completely without speech: there is no dead control and no path that needs a
 * voice to finish.
 *
 * `mark` drops the word and the box and leaves the glyph.
 *
 * The exhibition room uses it that way. A wall label in a gallery does not say
 * "read aloud" — it carries an audio-guide number, or a small symbol, and the
 * position on the label is what tells you what it reads. A bordered button
 * captioned READ ALOUD next to two sentences of curatorial prose is a second
 * visual layer on a page whose argument is that the pictures are the only
 * marks. The accessible name is unchanged either way, so nothing is lost for
 * anyone who is not looking at it.
 */
export function SpeakButton({
  text,
  label = 'Read aloud',
  className = '',
  mark = false,
}: {
  text: string;
  label?: string;
  className?: string;
  /** Glyph only: no word, no border, no box. */
  mark?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
        typeof window.speechSynthesis !== 'undefined' &&
        typeof window.SpeechSynthesisUtterance !== 'undefined'
    );
  }, []);

  // A page navigated away from should not keep talking.
  useEffect(
    () => () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    },
    []
  );

  if (!supported || !text.trim()) return null;

  const stop = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const speak = () => {
    // Chrome queues rather than replaces, so an un-cancelled previous run would
    // play both.
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.96;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const chrome = mark
    ? 'inline-flex items-center'
    : 'inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-primary-400 hover:text-white';

  return (
    <button
      type="button"
      onClick={speaking ? stop : speak}
      aria-label={speaking ? 'Stop reading' : label}
      className={`${chrome} ${className}`}
    >
      <span aria-hidden="true">{speaking ? '■' : '▶'}</span>
      {!mark && (speaking ? 'Stop' : label)}
    </button>
  );
}
