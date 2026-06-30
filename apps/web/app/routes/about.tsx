import type { ActionFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  PublicSiteFooter,
  PublicSiteHeader,
} from '~/components/site/public-shell';
import { getServerEnv } from '~/lib/public-search.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'About - Paillette' },
    {
      name: 'description',
      content:
        'Why Paillette was built and how its routed hybrid search works.',
    },
  ];
};

const searchFlowDiagram = `flowchart LR
  Q["User query"] --> R["<b>Routing</b><br/>choose<br/>search channels"]

  R --> K["<b>Keyword</b><br/>plain text<br/>match"]
  R --> M["<b>Metadata</b><br/>artist, title, date,<br/>accession number"]
  R --> C["<b>Captions</b><br/>semantic / factual context"]
  R --> I["<b>Image<br/>embeddings</b><br/>visual similarity"]
  R --> P["<b>Colour</b><br/>colour terms / palette"]

  K --> F["<b>Reciprocal rank<br/>fusion</b><br/>(RRF)"]
  M --> F
  C --> F
  I --> F
  P --> F

  F --> O["Ranked results"]

  classDef input fill:#111116,stroke:#3f3f46,color:#f8f7f4
  classDef route fill:#1f2937,stroke:#64748b,color:#f8f7f4
  classDef keyword fill:#24213a,stroke:#7c6ee6,color:#f8f7f4
  classDef metadata fill:#223026,stroke:#6aa56f,color:#f8f7f4
  classDef captions fill:#30223b,stroke:#a06ac4,color:#f8f7f4
  classDef image fill:#332821,stroke:#c08a57,color:#f8f7f4
  classDef colour fill:#243238,stroke:#61a4b5,color:#f8f7f4
  classDef fusion fill:#3a2530,stroke:#c4718f,color:#f8f7f4
  class Q,O input
  class R route
  class K keyword
  class M metadata
  class C captions
  class I image
  class P colour
  class F fusion`;

const sectionClassName = 'border-t border-white/[0.08] py-10 md:py-12';
const headingClassName =
  'font-display text-3xl font-semibold tracking-normal text-white md:text-4xl';
const bodyClassName =
  'text-base leading-8 text-white/68 md:text-lg md:leading-9';
const bodyGroupClassName = 'mt-5 max-w-4xl space-y-5';
const inputClassName =
  'w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-cyan-200/40 focus:bg-white/[0.065] focus:ring-2 focus:ring-cyan-200/20';
const fieldLabelClassName =
  'font-mono text-[10px] uppercase tracking-[0.18em] text-white/45';

const PAILLETTE_REPO_URL = 'https://github.com/erniesg/paillette';
const DEFAULT_FEEDBACK_FROM = 'Paillette <noreply@berlayar.ai>';
const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

type FeedbackActionData =
  | {
      status: 'success';
      message: string;
    }
  | {
      status: 'error';
      message: string;
    };

type FeedbackSubmission = {
  name: string;
  email: string;
  message: string;
  pageUrl: string;
  userAgent: string | null;
};

const cleanText = (value: FormDataEntryValue | null, maxLength: number) =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';

const cleanMessage = (value: FormDataEntryValue | null, maxLength: number) =>
  typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim().slice(0, maxLength)
    : '';

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const truncateDiscord = (value: string, maxLength = 950) =>
  value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trim()}...`;

const getDiscordWebhookUrl = (env: Record<string, string | undefined>) =>
  env.PAILLETTE_FEEDBACK_DISCORD_WEBHOOK_URL ||
  env.CODEX_DISCORD_WEBHOOK_URL ||
  env.DISCORD_WEBHOOK_URL ||
  env.DISCORD_WEBHOOK ||
  null;

const getFeedbackFrom = (env: Record<string, string | undefined>) =>
  env.PAILLETTE_FEEDBACK_FROM || DEFAULT_FEEDBACK_FROM;

const buildAcknowledgementText = (
  feedback: FeedbackSubmission
) => `Hi ${feedback.name},

Thanks for sending feedback on Paillette. I read these messages and use them to decide what to improve next.

Paillette is open source, so you are also more than welcome to contribute, file an issue, or follow along in the repo:
${PAILLETTE_REPO_URL}

Your message:
${feedback.message}

Best,
Paillette`;

const buildOwnerEmailText = (
  feedback: FeedbackSubmission
) => `New Paillette feedback

From: ${feedback.name} <${feedback.email}>
Page: ${feedback.pageUrl}
User agent: ${feedback.userAgent || 'Unknown'}

Message:
${feedback.message}`;

const sendResendEmail = async ({
  env,
  to,
  subject,
  text,
  replyTo,
}: {
  env: Record<string, string | undefined>;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}) => {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  const response = await fetch(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: getFeedbackFrom(env),
      to: [to],
      subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend API error: ${response.status}`);
  }
};

const notifyDiscord = async (
  env: Record<string, string | undefined>,
  feedback: FeedbackSubmission
) => {
  const webhookUrl = getDiscordWebhookUrl(env);
  if (!webhookUrl) return;

  const content = env.PAILLETTE_FEEDBACK_DISCORD_MENTION || '';
  const payload = {
    username: 'Paillette Feedback',
    content,
    embeds: [
      {
        title: 'New Paillette feedback',
        color: 0xa855f7,
        fields: [
          {
            name: 'From',
            value: `${feedback.name} <${feedback.email}>`,
          },
          {
            name: 'Message',
            value: truncateDiscord(feedback.message),
          },
          {
            name: 'Page',
            value: feedback.pageUrl,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn('Discord feedback notification failed:', response.status);
    }
  } catch (error) {
    console.warn('Discord feedback notification failed:', error);
  }
};

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const env = getServerEnv(context);
  const formData = await request.formData();
  const name = cleanText(formData.get('name'), 120);
  const email = cleanText(formData.get('email'), 254).toLowerCase();
  const message = cleanMessage(formData.get('message'), 4000);

  if (!name || !isValidEmail(email) || message.length < 8) {
    return json<FeedbackActionData>(
      {
        status: 'error',
        message: 'Add your name, a valid email, and a short message.',
      },
      { status: 400 }
    );
  }

  if (!env.RESEND_API_KEY) {
    return json<FeedbackActionData>(
      {
        status: 'error',
        message: 'Feedback email is not configured yet.',
      },
      { status: 503 }
    );
  }

  const feedback: FeedbackSubmission = {
    name,
    email,
    message,
    pageUrl: request.url,
    userAgent: request.headers.get('User-Agent'),
  };

  try {
    await sendResendEmail({
      env,
      to: email,
      subject: 'Thanks for your Paillette feedback',
      text: buildAcknowledgementText(feedback),
      replyTo: env.PAILLETTE_FEEDBACK_TO,
    });

    if (env.PAILLETTE_FEEDBACK_TO) {
      await sendResendEmail({
        env,
        to: env.PAILLETTE_FEEDBACK_TO,
        subject: `New Paillette feedback from ${name}`,
        text: buildOwnerEmailText(feedback),
        replyTo: email,
      });
    }

    await notifyDiscord(env, feedback);

    return json<FeedbackActionData>({
      status: 'success',
      message: 'Thanks. Check your email for an acknowledgement.',
    });
  } catch (error) {
    console.error('Failed to send Paillette feedback:', error);

    return json<FeedbackActionData>(
      {
        status: 'error',
        message: 'Feedback could not be sent. Try again later.',
      },
      { status: 502 }
    );
  }
};

function MermaidDiagram({ chart }: { chart: string }) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function renderDiagram() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'dark',
          flowchart: {
            curve: 'basis',
            htmlLabels: true,
            nodeSpacing: 32,
            rankSpacing: 34,
            useMaxWidth: true,
          },
          themeVariables: {
            background: 'transparent',
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: '16px',
            lineColor: 'rgba(255,255,255,0.55)',
            mainBkg: '#17171b',
            primaryBorderColor: 'rgba(255,255,255,0.22)',
            primaryTextColor: '#f8f7f4',
          },
        });

        const { svg } = await mermaid.render(
          `about-search-flow-${renderId}`,
          chart
        );
        if (isMounted && containerRef.current) {
          containerRef.current.innerHTML = svg;
          const renderedSvg = containerRef.current.querySelector('svg');
          if (renderedSvg) {
            renderedSvg.removeAttribute('width');
            renderedSvg.removeAttribute('height');
            renderedSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            renderedSvg.style.display = 'block';
            renderedSvg.style.width = '100%';
            renderedSvg.style.maxWidth = '100%';
            renderedSvg.style.height = 'auto';
          }
          setRenderError(false);
        }
      } catch {
        if (isMounted) {
          setRenderError(true);
        }
      }
    }

    void renderDiagram();

    return () => {
      isMounted = false;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [chart, renderId]);

  return (
    <div className="mt-8 overflow-hidden rounded-lg border border-white/[0.1] bg-white/[0.035] p-4 md:p-6">
      {renderError ? (
        <pre className="whitespace-pre-wrap text-sm leading-6 text-white/70">
          {chart}
        </pre>
      ) : (
        <div
          ref={containerRef}
          className="min-h-[220px] w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full"
        />
      )}
    </div>
  );
}

export default function AboutPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <PublicSiteHeader active="about" />

      <main className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20">
        <h1 className="font-display text-6xl font-semibold tracking-normal text-white md:text-7xl">
          About
        </h1>

        <section className="mt-12 py-4 md:mt-16">
          <h2 className={headingClassName}>Why I built this</h2>
          <div className={bodyGroupClassName}>
            <p className={bodyClassName}>
              Cause why not? I basically wanted to maximise token use on my AI
              subscriptions.
            </p>
          </div>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Context</h2>
          <div className={bodyGroupClassName}>
            <p className={bodyClassName}>
              Public art collections are interesting because the data is visual,
              textual, and messy. People search collections in different ways:
              researchers look for names, dates, and accession numbers;
              marketing teams look for themes; artists look for mood, colour,
              and form; casual users ask loose questions.
            </p>
          </div>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Data</h2>
          <div className={bodyGroupClassName}>
            <p className={bodyClassName}>
              To make the index more comprehensive, we gathered publicly
              available data from{' '}
              <a
                href="https://www.nationalgallery.sg/sg/en/our-collections/search-collection.html"
                className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-white/80"
              >
                National Gallery Singapore
              </a>{' '}
              and{' '}
              <a
                href="https://www.roots.gov.sg/Collection-Landing"
                className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-white/80"
              >
                Roots
              </a>
              .
            </p>
          </div>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Approach</h2>
          <div className={bodyGroupClassName}>
            <p className={bodyClassName}>
              In order to support different ways of searching the collection,
              Paillette routes each query to the search channels that make
              sense, then combines their ranked results with reciprocal rank
              fusion (RRF). RRF gives more weight to results that appear near
              the top of one or more relevant channels, so the final ranking is
              not dependent on a single model score.
            </p>
            <p className={bodyClassName}>
              For example, an accession number leans on metadata. "Blue abstract
              painting" leans on colour and image similarity. "Works about
              migration" leans on captions and keywords.
            </p>

            <MermaidDiagram chart={searchFlowDiagram} />
          </div>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Limitations</h2>
          <div className={bodyGroupClassName}>
            <p className={bodyClassName}>
              Paillette can only search what is in the corpus. If there are no
              relevant works for something like "Dragon Boat Festival", the
              results will not magically become correct.
            </p>
            <p className={bodyClassName}>
              Future work could include query expansion, alternative query
              generation, and clearer "no strong match" handling.
            </p>
          </div>
        </section>

        <section className={sectionClassName}>
          <h2 className={headingClassName}>Feedback</h2>
          <div className="mt-5 max-w-3xl space-y-5">
            <p className={bodyClassName}>
              Send bugs, confusing results, missing workflows, or ideas for the
              search. You will get an email acknowledgement.
            </p>

            <Form method="post" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className={fieldLabelClassName}>Name</span>
                  <input
                    className={inputClassName}
                    name="name"
                    type="text"
                    autoComplete="name"
                    maxLength={120}
                    required
                  />
                </label>
                <label className="space-y-2">
                  <span className={fieldLabelClassName}>Email</span>
                  <input
                    className={inputClassName}
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className={fieldLabelClassName}>Message</span>
                <textarea
                  className={`${inputClassName} min-h-36 resize-y leading-6`}
                  name="message"
                  maxLength={4000}
                  required
                />
              </label>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-10 w-fit items-center justify-center rounded-md bg-white px-4 text-sm font-semibold text-[#0b0b0e] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {isSubmitting ? 'Sending' : 'Send feedback'}
                </button>

                {actionData ? (
                  <p
                    className={`text-sm ${
                      actionData.status === 'success'
                        ? 'text-emerald-200/80'
                        : 'text-rose-200/85'
                    }`}
                    role="status"
                  >
                    {actionData.message}
                  </p>
                ) : null}
              </div>
            </Form>
          </div>
        </section>

        <PublicSiteFooter separated />
      </main>
    </div>
  );
}
