/**
 * "The same painting in an exhibition about weather and one about grief gets a
 *  different label. That contextual difference is the whole point; if the label
 *  reads the same regardless of the statement, this lane has failed."
 *
 * The loop check (`verify-theme-correction.mjs`) shows that beat inside a real
 * agent run, where a dozen other things also move. This isolates it: the same
 * works, the same call, twice, changing **only** the statement. Nothing else
 * differs, so any difference in the labels is attributable to the theme and to
 * nothing else.
 *
 *   node apps/web/scripts/verify-contextual-labels.mjs [apiBase] [webBase]
 *
 * Two origins, because the two routes live on different ones: the labels are
 * written by the API worker, and `browse` is the web app's own proxy.
 *
 * Everything here is real: the deployed route, the real catalogue rows and the
 * persisted vision captions out of D1, and the real model. Two calls, which is
 * inside the ten-per-hour budget the route allows an anonymous caller.
 */

const API = process.argv[2] ?? 'https://paillette-api-stg.berlayar.ai';
const WEB = process.argv[3] ?? 'https://paillette-stg.berlayar.ai';

const SHOWS = [
  {
    title: 'Weather at Sea',
    statement:
      'At sea, weather is not background but a force that measures human ' +
      'vulnerability. Mist obscures direction, wind tests vessels and bodies, ' +
      'and changing light turns the horizon into a promise or a warning. These ' +
      'works follow sailors and onlookers through uncertain conditions, where ' +
      'the visible world narrows to water, sky, and the decision to continue.',
  },
  {
    title: 'Leaving',
    statement:
      'It is not about weather. It is about leaving — the hour before someone ' +
      'goes, and the room that keeps their shape after they have gone. These ' +
      'works sit in that hour: the promise made at the door, the record altered ' +
      'once a person is out of it, the pair of faces held apart. What they share ' +
      'is not a subject but a moment, just before or just after a departure.',
  },
];

const label = async (artworkIds, show) => {
  const response = await fetch(`${API}/api/public-labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collectionId: 'nga', artworkIds, ...show }),
  });
  const body = await response.json();
  if (!body?.success) {
    throw new Error(`${response.status} ${JSON.stringify(body?.error)}`);
  }
  return new Map(body.data.labels.map((entry) => [entry.artworkId, entry]));
};

/** Real works, taken from the credential-free browse endpoint. */
const response = await fetch(`${WEB}/api/public-search/nga/browse?limit=6`);
const works = (await response.json())?.data?.results ?? [];
if (works.length < 3) throw new Error('browse returned too few works');
const chosen = works.slice(0, 3);
const ids = chosen.map((work) => work.id);

const [weather, leaving] = [await label(ids, SHOWS[0]), await label(ids, SHOWS[1])];

let differed = 0;
for (const work of chosen) {
  const a = weather.get(work.id);
  const b = leaving.get(work.id);
  if (a && b && a.label !== b.label) differed += 1;
  console.log(`\n${'─'.repeat(76)}\n${work.title}\n   (${work.artist ?? 'unknown'})`);
  console.log(`\n   under “${SHOWS[0].title}”  [${a?.source ?? '—'}]`);
  console.log(`   ${a?.label ?? '(none)'}`);
  console.log(`\n   under “${SHOWS[1].title}”  [${b?.source ?? '—'}]`);
  console.log(`   ${b?.label ?? '(none)'}`);
}

console.log(
  `\n${'═'.repeat(76)}\n${differed}/${chosen.length} works got a different label under the two statements.`
);
// Identical prose under two different themes is the stated failure of this
// lane, so it exits non-zero rather than printing a pass nobody reads.
process.exit(differed === chosen.length ? 0 : 1);
