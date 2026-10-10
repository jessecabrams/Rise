# Rise

Learn out loud. Rise reads anything to you in natural voices, quizzes you on what it means, lets you answer by talking, and turns it all into a game. Built for Jesse Abrams Coaching.

## What it does

- **Listen.** Paste text, upload PDFs, EPUB ebooks or Word files, or import web articles and Google Docs. Rise reads with word-by-word highlighting, 0.5× to 3× speed, focus mode, and three voice engines: free device voices, OpenAI studio voices (11 voices, with a "how should it sound" style prompt), and ElevenLabs premium voices.
- **Learn.** One tap builds a learning guide: the big idea, an explain-it-like-I'm-12 version, key ideas you can listen to, flashcards, and deep-dive exercises (teach-back, apply it, scenarios, challenge it). "Go deeper" writes harder ones.
- **Quiz.** Questions test understanding, not trivia. Answer out loud or typed. The coach grades the idea, not your wording, tells you what you showed and what to add, and offers bonus follow-up questions. Hands-free mode reads each question, listens, and submits when you pause.
- **Chapters.** Rise finds chapters from ebook files, Word and web headings, Markdown, PDF heading sizes and pasted titles. Jump between them while listening and quiz any one of them.
- **Map.** Each chapter's core ideas become stars on a night-sky map. Quiz a single idea, a chapter, or just the stars that are fading. Answers light stars, fill each chapter's sun with the horizon stripes, and add rays. Light every star and the chapter's sun rises. Raise them all to reach Mastery. Stars fade if you leave them, on a spaced-repetition schedule, so the map tells you what to review.
- **Ask.** Ask your material anything, by voice or text.
- **Level up.** XP, 15 sunrise-themed levels, 37 badges across four tiers, daily streaks and three daily quests.
- **Everywhere.** Installs as an app on iPhone, Android, Mac and Windows. Your library and progress sync between devices.
- **Offline.** Tap the download button on any piece while you have signal. Rise saves its idea map, a bank of offline questions, a search index and (optionally) the studio-voice audio. In Settings › Offline, download "Offline answers" once (about 105 MB) to grade answers and transcribe your voice on the device. The Natural voice (about 95 MB) is a lifelike voice that runs on the device: free, private, and it reads everything offline, including feedback and Ask answers. When you download a piece with studio audio, its offline quiz questions are saved in that voice too. The optional on-device coach (0.9 or 2.3 GB) answers questions in Ask and writes feedback with no connection. Offline answers are re-checked by the full coach automatically when you're back online.

## Setup (about 30 minutes, no coding)

You need four free accounts. Have a notes file open to paste keys into.

### 1. Put the code on GitHub

1. Go to github.com and sign up or sign in.
2. Click **New repository**. Name it `rise`. Choose **Private**. Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Unzip `rise.zip` on your computer. Open the `rise` folder, select everything inside it, and drag it into the GitHub page. Click **Commit changes**.

### 2. Deploy on Vercel

1. Go to vercel.com and choose **Continue with GitHub**.
2. Click **Add New › Project**, find `rise`, click **Import**.
3. Leave every setting as it is. Click **Deploy**. In about a minute you get a web address like `rise-yourname.vercel.app`. Rise already works there with device voices.

### 3. Turn on sync

1. In your Vercel project, open the **Storage** tab.
2. Click **Create Database**, choose **Upstash for Redis** (free plan), and connect it to the `rise` project.

### 4. Add your keys

1. **Anthropic** (the learning coach): console.anthropic.com › API Keys › Create Key. Add $5 of credit under Billing.
2. **OpenAI** (studio voices and voice answers): platform.openai.com › API keys › Create new secret key. Add $5 of credit under Billing.
3. **ElevenLabs** (optional, the most lifelike voices): elevenlabs.io › Profile › API Keys.
4. In Vercel, open **Settings › Environment Variables** and add:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `OPENAI_API_KEY` | your OpenAI key |
| `APP_PASSCODE` | any passcode you'll remember. It keeps strangers off your keys. |
| `ELEVENLABS_API_KEY` | optional |

5. Open the **Deployments** tab, click the three dots on the latest one, and choose **Redeploy**.

### 5. Install it

- **iPhone or iPad:** open your Rise address in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the menu, then **Install app**.
- **Mac or PC:** open it in Chrome or Edge and click the install icon in the address bar. In Safari on a Mac, choose File › **Add to Dock**.

Enter your passcode once on each device. Settings › Sync shows a green dot for everything that's connected.

## What it costs

Hosting, sync storage and device voices are free. For one person learning daily, expect roughly:

- Natural voice: free (runs on your device)
- Learning coach: $1 to $4 a month
- OpenAI studio voices: about $0.015 per minute of listening, so 20 minutes a day is roughly $9 a month. Device voices are free and you can switch any time.
- Spoken answers: well under $1 a month
- ElevenLabs: their plan pricing, starting around $5 a month

Want it cheaper? Use device voices for long reading and switch to studio voices for the stuff you care about most. On iPhone and Mac, download the free "Premium" Siri voices under Settings › Accessibility › Spoken Content › Voices. They are close to studio quality.

## Developing

```bash
npm install
npx vercel dev     # runs the app and the /api functions together
npm run typecheck
npm run build
```

`api/` holds the server functions (AI, voice, transcription, imports, sync). `src/` is the React app. `api/_prompts.ts` holds every coaching prompt, so that is the place to tune how quizzes, grading and guides feel.

## Next steps when you want them

- **App Store and Google Play:** wrap this same app with Capacitor. Needs an Apple Developer account ($99/year).
- **Browse Google Drive inside Rise:** add a Google sign-in and Drive picker. Needs a Google Cloud project.
- **Client accounts:** swap the passcode for real sign-in so clients can have their own libraries.
